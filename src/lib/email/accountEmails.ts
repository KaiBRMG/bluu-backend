import 'server-only';
import { ORGANIZATION_MANAGER_EMAIL } from '@/lib/organization';
import { sendEmail } from './resend';
import type { RenderedEmail } from './layout';

/**
 * Sending for the account emails (sign-in alerts, staff lifecycle). Both are
 * BEST-EFFORT: the sign-in or admin action they report has already happened,
 * so a Resend failure is logged and swallowed — never surfaced as a failed
 * login or a failed archive. Call them from `after()` so they never add
 * latency to the response.
 */

export async function sendAccountEmail(to: string, email: RenderedEmail, category: string): Promise<void> {
  try {
    await sendEmail({ to, email, tags: [{ name: 'category', value: category }] });
  } catch (error) {
    console.error(`[email/${category}] send failed:`, error);
  }
}

/** Staff-lifecycle mail to the organization manager (`lib/organization.ts`). */
export function emailOrganizationManager(email: RenderedEmail, category: string): Promise<void> {
  return sendAccountEmail(ORGANIZATION_MANAGER_EMAIL, email, category);
}
