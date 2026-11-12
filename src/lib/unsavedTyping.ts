/**
 * Is there something the user has typed that a reload or sign-out would throw
 * away? Shared by `DeploymentRefresher` and `TermsUpdateSignOut`, both of which
 * end a page's life at a moment the user did not choose.
 */
/** An empty focused field loses nothing — blocking on it would let an
 *  autofocused search box pin a stale page forever. */
export function hasUnsavedTyping(): boolean {
  const el = typeof document !== 'undefined' ? document.activeElement : null;
  if (!el) return false;
  if ((el as HTMLElement).isContentEditable) return !!el.textContent?.trim();
  if (el instanceof HTMLTextAreaElement) return el.value.trim() !== '';
  if (el instanceof HTMLInputElement) {
    if (['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(el.type)) {
      return false;
    }
    return el.value.trim() !== '';
  }
  return false;
}
