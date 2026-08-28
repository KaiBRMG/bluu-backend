'use client';

import { useEffect } from 'react';

/**
 * Opts this route out of browser page translation, for as long as it is mounted.
 *
 * WHY THIS EXISTS — a real applicant lost a half-filled application to it.
 * Browser translators (Safari's Translate, Chrome's) rewrite text nodes *in
 * place*: Safari swaps the node, Chrome wraps it in a `<font>`. React does not
 * know, and keeps a reference to the node it created. The next time it unmounts
 * that subtree it calls `parent.removeChild(node)` on a node that is no longer
 * a child, and WebKit throws `NotFoundError: The object can not be found here.`
 * That kills the whole React root — on a form with no saved state, it takes the
 * applicant's answers with it.
 *
 * It bit us on the country `Select`: picking an option unmounts the dropdown,
 * which is exactly such a deletion. Any Radix overlay here is the same shape.
 *
 * WHY THE ATTRIBUTE GOES ON `<html>`, NOT ON THE FORM.
 * `translate` is inherited through the DOM tree, and Radix renders its overlays
 * in a **portal attached to `document.body`** — a sibling of the form, not a
 * descendant. Marking the form alone would leave the exact subtree that crashed
 * still translatable. `<html>` is the only node that covers both.
 *
 * It is scoped to this route (set on mount, restored on unmount) rather than set
 * in the root layout, because translation is a genuine convenience on the rest
 * of the app — this form is the one surface where it is load-bearing enough to
 * break, and the one with an international, non-English-speaking audience.
 *
 * Both the attribute and the `notranslate` class are set: the attribute is the
 * standard, the class is what older Google Translate honours.
 */
export function NoTranslate() {
  useEffect(() => {
    const el = document.documentElement;
    const previous = el.getAttribute('translate');
    const hadClass = el.classList.contains('notranslate');

    el.setAttribute('translate', 'no');
    el.classList.add('notranslate');

    return () => {
      if (previous === null) el.removeAttribute('translate');
      else el.setAttribute('translate', previous);
      if (!hadClass) el.classList.remove('notranslate');
    };
  }, []);

  return null;
}
