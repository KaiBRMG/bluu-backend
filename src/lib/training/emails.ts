import { isPlausibleEmail } from '@/lib/authEmail';

/**
 * Splits a pasted blob (lines, commas, semicolons) into usable addresses and the
 * tokens that are not. Pure, so the admin dialogs can show a live count with the
 * exact rule the server applies; the server then layers hashing and de-duping on
 * top (`parseEmails` in trainingService).
 */
export function splitEmails(raw: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const token of raw.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean)) {
    (isPlausibleEmail(token) ? valid : invalid).push(token);
  }
  return { valid, invalid };
}
