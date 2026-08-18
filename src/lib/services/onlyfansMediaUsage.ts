/**
 * Measuring the OnlyFans media byte cache — server only.
 *
 * The cache in `onlyfans-media/` is deliberately permanent: paying the provider
 * once per file and never again is the whole point of it. The cost of that trade
 * is a Cloud Storage prefix that only ever grows, holding fans' media, with no
 * lifecycle rule on it.
 *
 * This samples the prefix on a schedule so the growth is **observed rather than
 * assumed**, and raises exactly one alert when it reaches a size worth acting
 * on. Extrapolating from a single reading is guesswork; a series says whether
 * 50 GB took three months or three weeks, which is the difference between "set a
 * rule when convenient" and "set one now".
 */
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, adminStorage } from '@/lib/firebase-admin';
import { OF_MEDIA_CACHE_PREFIX } from '@/lib/services/onlyfansMediaCache';
import { notifications } from '@/lib/notificationContent';
import { sendOpsAlertOnce } from '@/lib/services/onlyfansOpsAlerts';

/**
 * The size that raises the alert.
 *
 * 50 GB is not a cliff — at Standard-class pricing it is a little over a dollar
 * a month, and Cloud Storage will happily hold a thousand times it. It is the
 * point at which the *retention* question stops being theoretical: fifty
 * gigabytes of other people's private media, kept forever, with nobody having
 * decided that it should be. Move the number if the answer to that is "fine";
 * do not move it because storage is cheap, which was never the argument.
 */
const CRITICAL_BYTES = 50 * 1024 * 1024 * 1024;

/**
 * How many daily readings to keep. Six months is enough to see a trend and read
 * a growth rate off, and the whole series lives in one document — a doc per day
 * would be 365 reads to answer one question.
 */
const MAX_SAMPLES = 180;

/** Bounds the walk. 500 pages × 1000 objects is far past any plausible cache. */
const MAX_LIST_PAGES = 500;

/** Where the series lives. `onlyfans-meta` is denied to every client already. */
const USAGE_DOC = 'onlyfans-meta/media-usage';

export interface UsageSample {
  /** `YYYY-MM-DD`, UTC. One reading per day; a re-run overwrites its own day. */
  day: string;
  bytes: number;
  objects: number;
}

export interface UsageReport extends UsageSample {
  /** ISO timestamp of the first reading ever taken. */
  firstSampleAt: string;
  /** Human phrase for how long readings have been taken, e.g. `4 months`. */
  period: string;
  /** True only on the run that crossed the threshold and sent the alert. */
  alerted: boolean;
}

/** `1.4 GB` / `812 MB` — coarse on purpose; this is a trend, not an invoice. */
export function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * `3 months` / `6 weeks` / `12 days` — the span the growth happened over.
 *
 * Deliberately one unit and no decimals. The reader is being told roughly how
 * fast a number is moving so they can decide whether to act this week; "2.7
 * months" implies a precision that a daily sampler measuring a cache nobody is
 * pushing on does not have.
 */
export function formatPeriod(fromMs: number, toMs: number): string {
  const days = Math.max(1, Math.round((toMs - fromMs) / 86_400_000));
  if (days >= 60) return `${Math.round(days / 30)} months`;
  if (days >= 14) return `${Math.round(days / 7)} weeks`;
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** `YYYY-MM-DD` in UTC, so a reading's identity never depends on who read it. */
function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Total the prefix.
 *
 * Paged manually rather than with `autoPaginate`, which would materialise every
 * object's metadata at once: only two running totals are wanted, and the number
 * of objects is exactly the thing that is expected to grow without bound.
 */
async function measurePrefix(): Promise<{ bytes: number; objects: number }> {
  const bucket = adminStorage.bucket();
  let bytes = 0;
  let objects = 0;
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const [files, nextQuery] = await bucket.getFiles({
      prefix: `${OF_MEDIA_CACHE_PREFIX}/`,
      maxResults: 1000,
      autoPaginate: false,
      pageToken,
    });

    for (const file of files) {
      bytes += Number(file.metadata?.size ?? 0);
      objects += 1;
    }

    pageToken = (nextQuery as { pageToken?: string } | null)?.pageToken;
    if (!pageToken) return { bytes, objects };
  }

  // A truncated walk is an undercount, and an undercount that silently looks
  // like a reading is worse than a loud one — the alert it feeds is about size.
  console.warn(
    `[onlyfans:usage] stopped after ${MAX_LIST_PAGES} pages; ${objects} objects counted so far`,
  );
  return { bytes, objects };
}

/**
 * Take today's reading, append it to the series, and raise the one-time alert if
 * the cache has reached the threshold.
 *
 * Idempotent within a day: a second run replaces its own reading rather than
 * appending a duplicate, so a manual invocation next to the scheduled one does
 * not distort the series.
 */
export async function sampleMediaCacheUsage(): Promise<UsageReport> {
  const now = new Date();
  const day = utcDay(now);

  const { bytes, objects } = await measurePrefix();

  const ref = adminDb.doc(USAGE_DOC);
  const snapshot = await ref.get();
  const existing = (snapshot.get('samples') as UsageSample[] | undefined) ?? [];
  const firstSampleAt = (snapshot.get('firstSampleAt') as string | undefined) ?? now.toISOString();

  const samples = [...existing.filter((s) => s.day !== day), { day, bytes, objects }]
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-MAX_SAMPLES);

  await ref.set(
    { firstSampleAt, samples, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );

  const period = formatPeriod(Date.parse(firstSampleAt), now.getTime());

  // The latch inside `sendOpsAlertOnce` is what makes this once-ever; this only
  // decides whether the condition is true today.
  const alerted =
    bytes >= CRITICAL_BYTES &&
    (await sendOpsAlertOnce(
      'media-cache-critical',
      notifications.ofMediaCacheCritical(formatSize(bytes), period),
    ));

  console.info(
    `[onlyfans:usage] ${JSON.stringify({ day, bytes, objects, period, alerted })}`,
  );

  return { day, bytes, objects, firstSampleAt, period, alerted };
}
