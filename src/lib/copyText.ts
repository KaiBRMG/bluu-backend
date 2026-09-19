/**
 * Puts text on the OS clipboard, through whichever path is actually available.
 *
 * **Main first, the web API second, and the order matters.**
 * `navigator.clipboard.writeText` requires the document to be focused, and the
 * case this exists for is a snip finishing while the user is in another
 * application with the Bluu window hidden — there the web API rejects and the
 * one thing the user wanted never reaches their clipboard. `clipboard:writeText`
 * runs in the main process and has no such requirement.
 *
 * The fallback is not redundancy for its own sake: an installed shell older than
 * the Snipping Tool has no `clipboard.writeText` on the bridge (rule 9c), and a
 * plain browser has no bridge at all. In both, the document *is* focused,
 * because the only way to reach those paths is a click on a page.
 *
 * Returns whether the text actually landed, so the caller can say so honestly
 * rather than claiming a copy it did not make.
 */
export async function copyText(text: string): Promise<boolean> {
  const viaMain = await window.electronAPI?.clipboard
    ?.writeText?.(text)
    .catch(() => null);
  if (viaMain?.success) return true;

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
