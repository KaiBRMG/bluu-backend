/**
 * Prompt rich text: a deliberately tiny HTML dialect.
 *
 * The prompt library stores TWO representations of a prompt body:
 *
 *   `text`      the plain-text projection. Canonical — it is what Copy puts on
 *               the clipboard, what the search index tokenises, and what the
 *               version diff compares. Every prompt has it, including the ones
 *               written before formatting existed.
 *   `textHtml`  the presentation layer. `null` for a plain-text prompt, so
 *               nothing stored before this feature needs migrating.
 *
 * The dialect is five marks and two lists — bold, italic, underline, highlight,
 * bullets — and NOTHING else.
 *
 * EXACTLY ONE attribute survives sanitisation, and only in one place: the
 * `class` on a `<mark>`, which carries the highlight colour. It is never copied
 * from the input — the tag is re-emitted from the allowlist below and the class
 * is re-emitted from {@link HIGHLIGHT_COLORS}, so the only strings that can
 * appear are the five literals this file defines. Everything else is stripped
 * wholesale: there is no `href`, no `style`, no `on*`, no `src`, so there is no
 * vector to smuggle. Do not relax that — `dangerouslySetInnerHTML` renders this
 * dialect in the app AND on the public share page.
 *
 * Isomorphic on purpose. The server sanitises on write (never trust the
 * client) and the renderer sanitises again on read (never trust the database),
 * and both call the same function so the two can't drift.
 */

/** Tags kept as-is. Everything else is unwrapped or dropped. */
const ALLOWED = new Set(['b', 'strong', 'i', 'em', 'u', 'mark', 'ul', 'ol', 'li', 'br', 'p', 'div']);

/**
 * The highlight palette — five colours, fixed in code.
 *
 * `rgb` is the identity of a colour in BOTH directions: the class name is what
 * gets stored, and the rgba string is what the editor hands `execCommand` and
 * reads back off the selection. They are defined once, here, so a colour can
 * never mean one thing in the editor and another in Firestore.
 *
 * Tuned for a dark surface: translucent enough that `text-zinc-100` stays
 * legible on top, saturated enough to tell apart at a glance.
 */
export const HIGHLIGHT_COLORS = [
  { id: 'yellow', name: 'Yellow', rgb: [250, 204, 21] },
  { id: 'green', name: 'Green', rgb: [34, 197, 94] },
  { id: 'blue', name: 'Blue', rgb: [59, 130, 246] },
  { id: 'purple', name: 'Purple', rgb: [168, 85, 247] },
  { id: 'pink', name: 'Pink', rgb: [244, 63, 94] },
] as const;

export type HighlightId = (typeof HIGHLIGHT_COLORS)[number]['id'];

/** Alpha for every highlight. One value, so the five read as one family. */
export const HIGHLIGHT_ALPHA = 0.32;

/** The stored class for a colour. The only attribute value the dialect emits. */
export function highlightClass(id: HighlightId): string {
  return `hl-${id}`;
}

/** What the editor hands `execCommand('hiliteColor')`, and matches back. */
export function highlightCss(id: HighlightId): string {
  const c = HIGHLIGHT_COLORS.find(h => h.id === id);
  if (!c) return 'transparent';
  return `rgba(${c.rgb[0]}, ${c.rgb[1]}, ${c.rgb[2]}, ${HIGHLIGHT_ALPHA})`;
}

/**
 * The colour a browser-computed `background-color` belongs to, if any.
 *
 * Matched on the rgb triple alone — the alpha the browser serialises back can
 * differ in precision from the one we sent, and the five colours are distinct
 * without it. Anything unrecognised (including `transparent`, which is how a
 * highlight is cleared) is `null`, and its span is simply unwrapped.
 */
export function highlightIdFromCss(color: string | null | undefined): HighlightId | null {
  if (typeof color !== 'string') return null;
  const m = color.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  if (!m) return null;
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return HIGHLIGHT_COLORS.find(c => c.rgb[0] === r && c.rgb[1] === g && c.rgb[2] === b)?.id ?? null;
}

/** The colour a stored `<mark>` class names, if it names one of ours. */
export function highlightIdFromClass(className: string | null | undefined): HighlightId | null {
  if (typeof className !== 'string') return null;
  const id = className.trim().replace(/^hl-/, '');
  return HIGHLIGHT_COLORS.find(c => c.id === id)?.id ?? null;
}

/**
 * Storage form → editor form.
 *
 * The editor works in `<span style="background-color: …">`, because that is
 * what `execCommand('hiliteColor')` produces and — more importantly — what it
 * knows how to SPLIT, MERGE and CLEAR correctly across a partial selection.
 * Storage works in `<mark class>`, because the dialect allows no style
 * attribute. This converts the one into the other on the way in; the editor
 * converts back on the way out.
 *
 * Safe as a string rewrite because it runs on already-sanitised markup, where
 * `<span>` cannot occur — so every `</mark>` it rewrites has a matching open.
 */
export function marksToStyledSpans(html: string): string {
  if (!html) return '';
  return html
    .replace(/<mark\b([^>]*)>/gi, (_m, attrs: string) => {
      const cls = String(attrs).match(/class\s*=\s*"([^"]*)"/i)?.[1];
      const id = highlightIdFromClass(cls) ?? 'yellow';
      return `<span style="background-color: ${highlightCss(id)}">`;
    })
    .replace(/<\/mark\s*>/gi, '</span>');
}

/** Tags whose CONTENT is discarded too, not just the tag. */
const STRIP_WITH_CONTENT = /<(script|style|iframe|object|embed|noscript|template)\b[\s\S]*?<\/\1\s*>/gi;

/** An opening or closing tag, or a self-closing one. */
const TAG = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;

export const MAX_HTML_LENGTH = 400_000;

/**
 * Reduces arbitrary HTML to the dialect above.
 *
 * Attribute stripping is total rather than selective — the tag name is the only
 * thing carried across, re-emitted from the allowlist rather than copied from
 * the input, so a malformed or obfuscated attribute has nothing to survive in.
 *
 * The single exception is a `<mark>`'s highlight colour, and it is handled the
 * same way: the input's class is only ever LOOKED UP in `HIGHLIGHT_COLORS`, and
 * what gets written is the literal from that table. An unrecognised class
 * yields a bare `<mark>` (the default colour) rather than passing anything
 * through.
 */
export function sanitizePromptHtml(input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) return '';

  // Unclosed script/style blocks would otherwise leak their body as text; cut
  // anything from such an opening tag to the end before the pass below.
  let html = input
    .slice(0, MAX_HTML_LENGTH)
    .replace(STRIP_WITH_CONTENT, '')
    .replace(/<(script|style|iframe|object|embed|noscript|template)\b[\s\S]*$/gi, '')
    // Comments can hide a `>` and confuse the tag scanner.
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<![^>]*>/g, '');

  html = html.replace(TAG, (_match, rawName: string) => {
    const name = rawName.toLowerCase();
    if (!ALLOWED.has(name)) return '';
    if (name === 'br') return '<br>';
    if (_match.startsWith('</')) return `</${name}>`;
    if (name === 'mark') {
      const cls = _match.match(/class\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const id = highlightIdFromClass(cls?.[1] ?? cls?.[2]);
      return id ? `<mark class="${highlightClass(id)}">` : '<mark>';
    }
    return `<${name}>`;
  });

  // Any stray `<` that was not part of a tag is now literal text.
  html = html.replace(/<(?![/a-zA-Z])/g, '&lt;');

  return html.trim();
}

/**
 * The plain-text projection of a sanitised body.
 *
 * Used server-side so `text` is always derived from the same bytes that were
 * stored as `textHtml` — the two can never disagree about what the prompt says.
 * List items are rendered with a leading "- " so a bulleted prompt still pastes
 * into a model as a list.
 *
 * Blank-line fidelity is the delicate part, and the reason the order below is
 * what it is. A browser writes an empty line inside `contentEditable` as
 * `<div><br></div>` — a `<br>` AND a block close. Counting both would turn one
 * blank line into two on every save, quietly re-flowing prompts that are already
 * in production, so the redundant `<br>` is dropped first. For the same reason
 * nothing here collapses runs of newlines: a prompt that deliberately separates
 * two sections with three blank lines keeps them.
 */
export function htmlToPlainText(html: string): string {
  if (!html) return '';
  return decodeEntities(
    html
      // A <br> that only exists to give an empty block height. The block's own
      // close supplies the newline.
      .replace(/<br\s*\/?>\s*(?=<\/(?:div|p|li)\s*>)/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      // A list item opens its own line and is closed by the newline of the
      // NEXT item or of the list itself — hence no break on `</li>`.
      .replace(/<li\s*>/gi, '\n- ')
      .replace(/<\/li\s*>/gi, '')
      .replace(/<\/(?:p|div|ul|ol)\s*>/gi, '\n')
      .replace(/<[^>]*>/g, '')
  )
    .replace(/\r\n?/g, '\n')
    .trim();
}

/** The five entities the browser's `innerHTML` actually produces. */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Escapes plain text for use as HTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A body for the editor to load. A prompt that has never been formatted has no
 * `textHtml`, so its plain text is promoted to markup once, here, rather than
 * being rewritten in Firestore — nothing already stored is touched.
 */
export function promptBodyHtml(text: string, textHtml: string | null | undefined): string {
  const clean = sanitizePromptHtml(textHtml);
  if (clean) return clean;
  return escapeHtml(text).replace(/\r\n?/g, '\n').split('\n').map(line => `<div>${line || '<br>'}</div>`).join('');
}

/** True when the body carries formatting worth storing as HTML. */
export function hasRichFormatting(html: string): boolean {
  return /<(b|strong|i|em|u|mark|ul|ol|li)\b/i.test(html);
}
