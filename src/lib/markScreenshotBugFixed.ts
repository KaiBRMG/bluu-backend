/**
 * TEMPORARY (see CLAUDE.md): latch the stale-TCC screen-recording repair as
 * applied for the current user.
 *
 * `screenshotBugFixed` is the once-ever cap on the automatic `tccutil reset` —
 * the in-memory guards around the call sites are only per-session, so without
 * this write an affected user would have their Screen Recording grant wiped on
 * every launch and be re-prompted by macOS each time they start the app.
 *
 * Fire-and-forget: a failed write costs at most one extra reset next session and
 * self-corrects once the request succeeds, so it must never block or surface an
 * error in the flows that call it.
 */
export async function markScreenshotBugFixed(idToken: string | undefined): Promise<void> {
  if (!idToken) return;

  try {
    await fetch('/api/user/update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ screenshotBugFixed: true }),
    });
  } catch (error) {
    console.error('[Screenshot] Could not persist screenshotBugFixed:', error);
  }
}
