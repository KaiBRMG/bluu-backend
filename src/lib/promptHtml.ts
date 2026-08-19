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
 * The dialect is four marks and two lists — bold, italic, underline, bullets —
 * and NOTHING else. No attributes of any kind survive sanitisation, which is
 * what makes rendering it with `dangerouslySetInnerHTML` safe: there is no
 * `href`, no `style`, no `on*`, no `src`, so there is no vector to smuggle.
 *
 * Isomorphic on purpose. The server sanitises on write (never trust the
 * client) and the renderer sanitises again on read (never trust the database),
 * and both call the same function so the two can't drift.
 */

/** Tags kept as-is. Everything else is unwrapped or dropped. */
const ALLOWED = new Set(['b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'br', 'p', 'div']);

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
    return _match.startsWith('</') ? `</${name}>` : `<${name}>`;
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
  return /<(b|strong|i|em|u|ul|ol|li)\b/i.test(html);
}
