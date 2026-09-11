/**
 * Envelope encryption for operators' personal GoLogin API tokens.
 *
 * **Why this exists.** Launching a profile runs Orbita on the operator's own
 * machine, so their GoLogin token has to reach their desktop — nothing on Vercel
 * can spawn a browser on someone's desk. Storing it in plaintext would mean a
 * Firestore export, a mis-scoped rule, or a backup dump handing over live
 * credentials to every GoLogin account in the company at once. AES-256-GCM under
 * a key that lives only in the environment means the database alone is not
 * enough.
 *
 * **What this is not.** It is not protection from the server: anything that can
 * read `GL_TOKEN_ENC_KEY` can decrypt, and that is by design — the launch path
 * needs the plaintext. It raises the bar from "read one collection" to "read one
 * collection *and* hold the deploy environment".
 *
 * GCM, not CBC: the tag authenticates the ciphertext, so a tampered row fails to
 * decrypt rather than yielding attacker-chosen bytes into an Authorization
 * header. The IV is random per write and stored alongside — never reused, which
 * is the one way GCM fails catastrophically.
 */
import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits — the size GCM is defined for.
const KEY_BYTES = 32;
const VERSION = 'v1';

/**
 * Resolved per call rather than at module load: a missing key must fail the one
 * request that needs it with a named cause, not crash the whole server on boot
 * for every surface that has nothing to do with GoLogin.
 */
function getKey(): Buffer {
  const raw = process.env.GL_TOKEN_ENC_KEY;
  if (!raw) {
    throw new Error('GL_TOKEN_ENC_KEY is not configured.');
  }
  // base64 (44 chars) is the documented format; hex (64 chars) is accepted
  // because that is what `openssl rand -hex 32` produces and someone will.
  const key = /^[0-9a-fA-F]{64}$/.test(raw.trim())
    ? Buffer.from(raw.trim(), 'hex')
    : Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error('GL_TOKEN_ENC_KEY must decode to 32 bytes (openssl rand -base64 32).');
  }
  return key;
}

/** True when the key is present and well-formed — for a health check, not a gate. */
export function isTokenCryptoConfigured(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * `v1:<iv b64>:<tag b64>:<ciphertext b64>`.
 *
 * Version-prefixed so a future key rotation or algorithm change can be told
 * apart from a corrupt row instead of being guessed at.
 */
export function encryptToken(plaintext: string): string {
  if (!plaintext) throw new Error('Refusing to encrypt an empty token.');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/**
 * Returns null rather than throwing when the row cannot be read — a rotated key
 * or a truncated write should present to the operator as "add your API key
 * again", not as a 500 with a stack trace.
 */
export function decryptToken(envelope: string): string | null {
  if (typeof envelope !== 'string') return null;
  const parts = envelope.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const [, ivB64, tagB64, dataB64] = parts;
    const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    return plaintext || null;
  } catch {
    // Includes the authentication-tag failure, which is the interesting case:
    // the row was altered, or the key changed underneath it.
    console.error('[gologin] could not decrypt a stored API token — key rotated or row corrupt');
    return null;
  }
}
