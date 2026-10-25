import 'server-only';
import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { normalizeEmail } from '@/lib/authEmail';

/**
 * Candidate identity for `/training` — deliberately NOT Firebase Auth.
 *
 * The project already runs two identity systems that must never share a uid
 * (employees on Google, creators on Telegram). Candidates are neither, and a
 * third Auth population would put strangers in the same user table the
 * allowlist protects. A candidate is an email address an admin added to a
 * session; they prove they hold it with a 6-digit code, and what they carry
 * afterwards is an HMAC-signed httpOnly cookie naming that address's hash.
 *
 * The cookie is only an *identity*. Authorisation is re-derived from Firestore
 * on every request — an admin revoking a participant or a session closing takes
 * effect on the next call, not when a cookie expires.
 *
 * Every collection here is Admin-SDK-only (`read, write: if false`).
 */

const CODES_COLLECTION = 'training-codes';
const RATE_COLLECTION = 'training-rate';
const CANDIDATES_COLLECTION = 'training-candidates';

// ─── Signing ─────────────────────────────────────────────────────────────────

/**
 * Own key namespace: a training token must never verify as a model-submission
 * session or the reverse. Prefers an explicit secret; otherwise derived from the
 * service-account credential that already has to exist for the app to boot.
 */
function signingKey(): Buffer {
  const explicit = process.env.TRAINING_SECRET;
  if (explicit) return Buffer.from(explicit, 'utf8');
  return crypto
    .createHash('sha256')
    .update(process.env.FIREBASE_SERVICE_ACCOUNT ?? '')
    .update('training/v1')
    .digest();
}

function hmac(label: string, value: string): string {
  return crypto.createHmac('sha256', signingKey()).update(`${label}:${value}`).digest('hex');
}

/**
 * The address's stable key. HMAC'd so a Firestore export is not a list of
 * candidate emails, and so document ids derived from it are unguessable.
 * `normalizeEmail` folds case and Gmail aliasing, so `J.Doe+x@gmail.com` and
 * `jdoe@gmail.com` are the same candidate.
 */
export function emailHashFor(email: string): { emailKey: string; emailHash: string } | null {
  const emailKey = normalizeEmail(email);
  if (!emailKey) return null;
  return { emailKey, emailHash: hmac('email', emailKey).slice(0, 32) };
}

/** Salted, non-reversible fingerprint of the caller. We never store a raw IP. */
export function hashIp(ip: string): string {
  return hmac('ip', ip).slice(0, 32);
}

/**
 * Best-effort client IP behind Vercel's proxy. (Not imported from the model
 * application's service: that module pulls in `sharp`, which a code request
 * should not pay a cold start for.)
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return headers.get('x-real-ip')?.trim() || 'unknown';
}

// ─── The session cookie ──────────────────────────────────────────────────────

/** `__Host-` pins the cookie to this exact origin, no Domain, Path=/ — but it requires Secure. */
const SECURE = process.env.NODE_ENV === 'production';
export const COOKIE_NAME = SECURE ? '__Host-training' : 'training';
const COOKIE_MAX_AGE_S = 7 * 24 * 60 * 60;

export function mintCookie(emailHash: string): string {
  const issued = Date.now();
  const payload = `${emailHash}.${issued}`;
  const sig = crypto.createHmac('sha256', signingKey()).update(`cookie:${payload}`).digest('base64url');
  return `${payload}.${sig}`;
}

export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: SECURE,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: COOKIE_MAX_AGE_S,
};

/** Reads and verifies the candidate cookie. Returns the email hash, or null. */
export function readCandidate(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  const match = header
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  const value = decodeURIComponent(match.slice(COOKIE_NAME.length + 1));

  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [emailHash, issued, sig] = parts;
  if (!/^[a-f0-9]{32}$/.test(emailHash)) return null;
  const issuedMs = Number(issued);
  if (!Number.isFinite(issuedMs) || Date.now() - issuedMs > COOKIE_MAX_AGE_S * 1000) return null;

  const expected = Buffer.from(
    crypto.createHmac('sha256', signingKey()).update(`cookie:${emailHash}.${issued}`).digest('base64url'),
  );
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  return emailHash;
}

// ─── Rate limiting ───────────────────────────────────────────────────────────

/**
 * Fixed-window counter, transactional. Keyed by a salted hash so the same
 * collection serves per-IP and per-email limits. The window resets lazily on
 * the first request after it expires; `expiresAt` is for a TTL policy.
 *
 * Returns false when the caller is over `limit`.
 */
export async function consumeRate(
  scope: string,
  keyHash: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const ref = adminDb.collection(RATE_COLLECTION).doc(`${scope}_${keyHash}`);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const d = snap.exists ? snap.data() ?? {} : {};
    const windowStart: number = typeof d.windowStart === 'number' ? d.windowStart : 0;
    const fresh = now - windowStart > windowMs;
    const used: number = fresh ? 0 : typeof d.count === 'number' ? d.count : 0;
    if (used + 1 > limit) return false;
    tx.set(ref, {
      windowStart: fresh ? now : windowStart,
      count: used + 1,
      expiresAt: Timestamp.fromMillis(now + windowMs * 2),
    });
    return true;
  });
}

// ─── One-time codes ──────────────────────────────────────────────────────────

const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_COOLDOWN_MS = 45 * 1000;
const CODE_MAX_ATTEMPTS = 5;

/**
 * The code is DERIVED from a random nonce stored on the doc, not stored itself:
 * nothing recoverable sits in Firestore, and a resend can repeat the same code.
 * Repeating matters. If every request minted a fresh code, anyone who knew a
 * candidate's address could keep invalidating the code already in their inbox
 * (one request every 45 s) — the very attack the code exists to stop. A hostile
 * resend now just delivers the candidate's own code again.
 */
function codeFor(emailHash: string, nonce: string): string {
  const digest = crypto.createHmac('sha256', signingKey()).update(`code:${emailHash}:${nonce}`).digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

/**
 * Returns the code to email, or null inside the resend cooldown (the caller then
 * sends nothing and says nothing different). A live code is re-sent, with its
 * expiry pushed out; a new one is minted only when none is live — expired,
 * spent by wrong guesses, or used.
 */
export async function issueCode(emailHash: string): Promise<string | null> {
  const ref = adminDb.collection(CODES_COLLECTION).doc(emailHash);
  const now = Date.now();

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() ?? {} : {};
    const live =
      typeof d.nonce === 'string' &&
      typeof d.expiresAtMs === 'number' &&
      now <= d.expiresAtMs &&
      (typeof d.attempts === 'number' ? d.attempts : 0) < CODE_MAX_ATTEMPTS;

    if (live) {
      if (now - (typeof d.sentAtMs === 'number' ? d.sentAtMs : 0) < CODE_COOLDOWN_MS) return null;
      tx.update(ref, {
        sentAtMs: now,
        expiresAtMs: now + CODE_TTL_MS,
        expiresAt: Timestamp.fromMillis(now + CODE_TTL_MS * 2),
      });
      return codeFor(emailHash, d.nonce);
    }

    const nonce = crypto.randomBytes(16).toString('hex');
    tx.set(ref, {
      nonce,
      sentAtMs: now,
      expiresAtMs: now + CODE_TTL_MS,
      attempts: 0,
      expiresAt: Timestamp.fromMillis(now + CODE_TTL_MS * 2),
    });
    return codeFor(emailHash, nonce);
  });
}

/**
 * Checks a code. Every wrong guess counts, and five spend the code — a
 * six-digit space is only safe because the guesses are capped, so the attempt
 * is recorded BEFORE the comparison and inside the same transaction.
 */
export async function verifyCode(emailHash: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const ref = adminDb.collection(CODES_COLLECTION).doc(emailHash);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const d = snap.data() ?? {};
    const attempts = typeof d.attempts === 'number' ? d.attempts : 0;
    const expiresAtMs = typeof d.expiresAtMs === 'number' ? d.expiresAtMs : 0;
    if (typeof d.nonce !== 'string' || Date.now() > expiresAtMs || attempts >= CODE_MAX_ATTEMPTS) {
      tx.delete(ref);
      return false;
    }

    const expected = Buffer.from(codeFor(emailHash, d.nonce));
    const given = Buffer.from(code);
    const ok = expected.length === given.length && crypto.timingSafeEqual(expected, given);

    if (ok) tx.delete(ref);
    else tx.update(ref, { attempts: attempts + 1 });
    return ok;
  });
}

// ─── Candidate profile ───────────────────────────────────────────────────────

export async function getCandidateName(emailHash: string): Promise<string | null> {
  const snap = await adminDb.collection(CANDIDATES_COLLECTION).doc(emailHash).get();
  const name = snap.exists ? snap.data()?.name : null;
  return typeof name === 'string' && name ? name : null;
}

/** Names for a roster, in one batched read (rule 9). */
export async function getCandidateNames(emailHashes: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (emailHashes.length === 0) return out;
  const snaps = await adminDb.getAll(
    ...emailHashes.map((h) => adminDb.collection(CANDIDATES_COLLECTION).doc(h)),
  );
  for (const s of snaps) {
    const name = s.exists ? s.data()?.name : null;
    if (typeof name === 'string' && name) out.set(s.id, name);
  }
  return out;
}

/** First-visit name capture. Set once: a second call returns the stored name. */
export async function setCandidateName(emailHash: string, name: string): Promise<string> {
  const ref = adminDb.collection(CANDIDATES_COLLECTION).doc(emailHash);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? snap.data()?.name : null;
    if (typeof existing === 'string' && existing) return existing;
    tx.set(ref, { name, nameSetAtMs: Date.now() }, { merge: true });
    return name;
  });
}

/** Trims, collapses whitespace and rejects control characters. Returns '' if unusable. */
export function cleanName(raw: unknown, min: number, max: number): string {
  if (typeof raw !== 'string') return '';
  const name = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  return name.length >= min && name.length <= max ? name : '';
}
