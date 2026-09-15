/**
 * A minimal XLSX reader — enough of the format to read one exported sheet, and
 * nothing more.
 *
 * ## Why not a library
 *
 * This runs server-side in one API route, on files an admin uploads a few times
 * a week. SheetJS's npm distribution is no longer published to the registry and
 * `exceljs` pulls a large dependency tree for a parse we can do in a page of
 * code. An `.xlsx` is a ZIP of XML: Node's `zlib` already does the hard half,
 * and the XML we need is a flat table.
 *
 * ## What it supports
 *
 * Stored and deflated ZIP entries; shared strings (including rich-text runs);
 * inline strings; numbers; booleans; formula cells (the cached value); and
 * date-formatted numeric cells, resolved through `styles.xml` and returned as
 * an ISO string. Blank cells are skipped by the writer, so rows are keyed by
 * column letter rather than by position.
 *
 * ## What it does not
 *
 * Zip64 (a spreadsheet over 4GB), encrypted workbooks, and the legacy `.xls`
 * binary format. Each throws a named error the import route surfaces verbatim,
 * because "your file is the wrong format" is a fixable problem and a stack
 * trace is not.
 */

import { inflateRawSync } from 'node:zlib';

export class XlsxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XlsxError';
  }
}

// ─── ZIP ─────────────────────────────────────────────────────────────

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

/**
 * Read the ZIP central directory.
 *
 * The end-of-central-directory record is located by scanning backwards, because
 * it sits after a variable-length comment field and has no other anchor. The
 * scan is bounded to the last 64KB + 22 bytes, which is the maximum a legal
 * comment can push it.
 */
function readCentralDirectory(buf: Buffer): Map<string, ZipEntry> {
  const maxCommentLen = 0xffff;
  const minEocd = 22;
  const scanFrom = Math.max(0, buf.length - maxCommentLen - minEocd);

  let eocd = -1;
  for (let i = buf.length - minEocd; i >= scanFrom; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new XlsxError('Not a valid .xlsx file — no ZIP directory found. If this is an .xls or .csv, re-export it as .xlsx.');
  }

  const entryCount = buf.readUInt16LE(eocd + 10);
  const dirOffset = buf.readUInt32LE(eocd + 16);

  if (dirOffset === 0xffffffff || entryCount === 0xffff) {
    throw new XlsxError('This workbook uses the Zip64 format, which is not supported. Re-export it, or split it into smaller files.');
  }

  const entries = new Map<string, ZipEntry>();
  let p = dirOffset;

  for (let i = 0; i < entryCount && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) break;

    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    entries.set(name, { name, method, compressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

/**
 * Decompress one entry.
 *
 * The local header's name and extra-field lengths are read rather than the
 * central directory's: the two are allowed to differ, and trusting the wrong one
 * silently offsets the data stream.
 */
function readEntry(buf: Buffer, entry: ZipEntry): Buffer {
  const off = entry.localHeaderOffset;
  if (off + 30 > buf.length || buf.readUInt32LE(off) !== SIG_LOCAL) {
    throw new XlsxError(`Corrupt archive — bad local header for "${entry.name}".`);
  }

  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const dataStart = off + 30 + nameLen + extraLen;

  // A streaming writer sets sizes to 0 in the local header and defers them to a
  // data descriptor, so the central directory's size is the reliable one. When
  // it is 0 too, inflate to the end of the buffer and let zlib stop at the
  // stream's own terminator.
  const end = entry.compressedSize > 0 ? dataStart + entry.compressedSize : buf.length;
  const slice = buf.subarray(dataStart, end);

  if (entry.method === 0) return Buffer.from(slice);
  if (entry.method === 8) {
    try {
      return inflateRawSync(slice);
    } catch {
      throw new XlsxError(`Could not decompress "${entry.name}". The file may be corrupt or password-protected.`);
    }
  }
  throw new XlsxError(`Unsupported compression in "${entry.name}". Re-save the workbook from Excel or Google Sheets.`);
}

// ─── XML ─────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeXml(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

/** Concatenate every `<t>` inside a fragment — rich-text runs split one string across several. */
function collectText(fragment: string): string {
  let out = '';
  for (const m of fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) {
    out += decodeXml(m[1]);
  }
  return out;
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) {
    out.push(collectText(m[1]));
  }
  return out;
}

// ─── Dates ───────────────────────────────────────────────────────────

/** Built-in `numFmtId`s that denote a date or time. */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

/** True when a format code contains date/time tokens outside quoted literals. */
function isDateFormatCode(code: string): boolean {
  const stripped = code
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\./g, '');
  return /[ymdhs]/i.test(stripped);
}

/**
 * Style index → "is this cell a date".
 *
 * Excel stores a date as a plain number and only the *format* says otherwise, so
 * without this a date column silently imports as `45901`.
 */
function parseDateStyles(stylesXml: string | null): Set<number> {
  const dateStyles = new Set<number>();
  if (!stylesXml) return dateStyles;

  const customDateFormats = new Set<number>();
  for (const m of stylesXml.matchAll(/<numFmt\s[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"[^>]*\/>/g)) {
    if (isDateFormatCode(decodeXml(m[2]))) customDateFormats.add(Number(m[1]));
  }

  const cellXfsBlock = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
  if (!cellXfsBlock) return dateStyles;

  let index = 0;
  for (const m of cellXfsBlock[1].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)) {
    const idMatch = /numFmtId="(\d+)"/.exec(m[0]);
    const numFmtId = idMatch ? Number(idMatch[1]) : 0;
    if (BUILTIN_DATE_FORMATS.has(numFmtId) || customDateFormats.has(numFmtId)) {
      dateStyles.add(index);
    }
    index++;
  }

  return dateStyles;
}

/**
 * Excel serial → ISO `YYYY-MM-DD HH:mm:ss`, with **no timezone applied**.
 *
 * A serial carries wall-clock time and no zone, which is exactly what the sales
 * export's text dates carry too — so both paths hand the caller the same kind of
 * string, and the salary timezone is applied once, downstream.
 *
 * Day 60 is Excel's phantom 29 Feb 1900, kept for Lotus compatibility. Serials
 * above it are one day ahead of reality, which is why the epoch below is 30 Dec
 * 1899 rather than 31 Dec.
 */
function serialToDateString(serial: number, date1904: boolean): string {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const ms = epoch + Math.round(serial * 86400000);
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}

// ─── Public API ──────────────────────────────────────────────────────

export interface XlsxSheet {
  name: string;
  /** Row objects keyed by trimmed header text. Header row excluded. */
  rows: Array<Record<string, string>>;
  /** Header labels, in column order. */
  headers: string[];
  /** 1-based worksheet row number for each entry in `rows`, for error reporting. */
  rowNumbers: number[];
}

function columnLetters(ref: string): string {
  const m = /^([A-Z]+)/.exec(ref);
  return m ? m[1] : '';
}

/**
 * Read the first worksheet of an `.xlsx` buffer into header-keyed rows.
 *
 * Reads the *first* sheet deliberately: the export is one sheet per file, and
 * silently picking a different one because a name matched would be worse than
 * failing. Duplicate header labels are suffixed (`Email`, `Email (2)`) so a
 * column can never be shadowed and silently lost.
 */
export function readXlsxSheet(data: Buffer): XlsxSheet {
  if (data.length < 22) throw new XlsxError('The uploaded file is empty or truncated.');
  if (data[0] === 0xd0 && data[1] === 0xcf) {
    throw new XlsxError('This is a legacy .xls file. Open it and use "Save As → .xlsx", then upload again.');
  }
  if (data[0] !== 0x50 || data[1] !== 0x4b) {
    throw new XlsxError('This is not an .xlsx workbook. Export the sales report as .xlsx and upload that.');
  }

  const entries = readCentralDirectory(data);
  const text = (name: string): string | null => {
    const entry = entries.get(name);
    return entry ? readEntry(data, entry).toString('utf8') : null;
  };

  const workbookXml = text('xl/workbook.xml');
  if (!workbookXml) throw new XlsxError('The workbook is missing its index (xl/workbook.xml).');

  const date1904 = /date1904="(1|true)"/i.test(workbookXml);

  // Resolve the first sheet's part name through the relationship id, falling
  // back to the conventional path when the rels part is absent.
  const firstSheet = /<sheet\b[^>]*\/>/.exec(workbookXml);
  const sheetName = firstSheet ? decodeXml(/name="([^"]*)"/.exec(firstSheet[0])?.[1] ?? 'Sheet1') : 'Sheet1';
  const relId = firstSheet ? /r:id="([^"]*)"/.exec(firstSheet[0])?.[1] : undefined;

  let sheetPath = 'xl/worksheets/sheet1.xml';
  const relsXml = text('xl/_rels/workbook.xml.rels');
  if (relId && relsXml) {
    const rel = new RegExp(`<Relationship\\b[^>]*Id="${relId}"[^>]*>`).exec(relsXml);
    const target = rel ? /Target="([^"]*)"/.exec(rel[0])?.[1] : undefined;
    if (target) {
      const clean = decodeXml(target).replace(/^\/?(xl\/)?/, '');
      sheetPath = `xl/${clean}`;
    }
  }

  const sheetXml = text(sheetPath) ?? text('xl/worksheets/sheet1.xml');
  if (!sheetXml) throw new XlsxError('Could not find a worksheet inside the workbook.');

  const sharedStrings = parseSharedStrings(text('xl/sharedStrings.xml') ?? '');
  const dateStyles = parseDateStyles(text('xl/styles.xml'));

  // ── Cells ──
  const rawRows: Array<{ rowNumber: number; cells: Map<string, string> }> = [];

  for (const rowMatch of sheetXml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(/\br="(\d+)"/.exec(rowMatch[1])?.[1] ?? 0);
    const cells = new Map<string, string>();

    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2] ?? '';

      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      if (!ref) continue;
      const col = columnLetters(ref);

      const type = /\bt="([^"]*)"/.exec(attrs)?.[1] ?? 'n';
      const styleIndex = Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? -1);

      let value = '';

      if (type === 'inlineStr') {
        value = collectText(body);
      } else if (type === 's') {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        const index = raw !== undefined ? Number(decodeXml(raw)) : NaN;
        value = Number.isInteger(index) && index >= 0 && index < sharedStrings.length ? sharedStrings[index] : '';
      } else if (type === 'str') {
        // Formula result that is text.
        value = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
      } else if (type === 'b') {
        value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] === '1' ? 'TRUE' : 'FALSE';
      } else if (type === 'e') {
        value = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '#ERROR');
      } else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (raw !== undefined && raw !== '') {
          const num = Number(decodeXml(raw));
          value =
            Number.isFinite(num) && styleIndex >= 0 && dateStyles.has(styleIndex)
              ? serialToDateString(num, date1904)
              : decodeXml(raw);
        }
      }

      if (value !== '') cells.set(col, value);
    }

    if (cells.size > 0) rawRows.push({ rowNumber, cells });
  }

  if (rawRows.length === 0) throw new XlsxError('The worksheet has no rows.');

  // ── Headers ──
  const headerRow = rawRows[0];
  const headerByColumn = new Map<string, string>();
  const headers: string[] = [];
  const used = new Map<string, number>();

  for (const [col, raw] of [...headerRow.cells.entries()].sort((a, b) => compareColumns(a[0], b[0]))) {
    const base = raw.trim();
    if (!base) continue;
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    const label = seen === 0 ? base : `${base} (${seen + 1})`;
    headerByColumn.set(col, label);
    headers.push(label);
  }

  if (headers.length === 0) throw new XlsxError('The first row of the worksheet is empty — it must hold the column headers.');

  // ── Body ──
  const rows: Array<Record<string, string>> = [];
  const rowNumbers: number[] = [];

  for (const row of rawRows.slice(1)) {
    const record: Record<string, string> = {};
    let hasValue = false;
    for (const [col, label] of headerByColumn) {
      const value = row.cells.get(col) ?? '';
      record[label] = value;
      if (value !== '') hasValue = true;
    }
    if (!hasValue) continue;
    rows.push(record);
    rowNumbers.push(row.rowNumber);
  }

  return { name: sheetName, headers, rows, rowNumbers };
}

/** Spreadsheet column order: AA sorts after Z, not between A and B. */
function compareColumns(a: string, b: string): number {
  return a.length !== b.length ? a.length - b.length : a.localeCompare(b);
}
