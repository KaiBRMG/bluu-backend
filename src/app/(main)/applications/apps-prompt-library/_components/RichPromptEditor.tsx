'use client';

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bold, Check, Highlighter, Italic, List, Underline } from 'lucide-react';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  HIGHLIGHT_COLORS,
  highlightCss,
  highlightIdFromCss,
  marksToStyledSpans,
  sanitizePromptHtml,
  type HighlightId,
} from '@/lib/promptHtml';

export interface RichPromptEditorHandle {
  /** Replaces the body without going through React — see the note below. */
  setHtml: (html: string) => void;
  focus: () => void;
}

type Mark = 'bold' | 'italic' | 'underline' | 'insertUnorderedList';

/**
 * `key` is the shortcut's letter or digit, and `shift` whether it is required.
 * Ctrl/Cmd+B/I/U are the universal ones; Ctrl/Cmd+Shift+8 is the bullet-list
 * shortcut Docs and Word both use, so it is the one people already have.
 */
const MARKS: {
  cmd: Mark;
  label: string;
  icon: typeof Bold;
  key: string;
  /** Matched instead of `key` when set — see the note in `onKeyDown`. */
  code?: string;
  shift?: boolean;
}[] = [
  { cmd: 'bold', label: 'Bold', icon: Bold, key: 'b' },
  { cmd: 'italic', label: 'Italic', icon: Italic, key: 'i' },
  { cmd: 'underline', label: 'Underline', icon: Underline, key: 'u' },
  {
    cmd: 'insertUnorderedList',
    label: 'Bullet list',
    icon: List,
    key: '8',
    code: 'Digit8',
    shift: true,
  },
];

/** Notion's highlight shortcut, and Docs' too. Applies the last colour used. */
const HIGHLIGHT_KEY = 'h';

function modLabel(isMac: boolean, shift: boolean, key: string): string {
  return `${isMac ? '⌘' : 'Ctrl+'}${shift ? (isMac ? '⇧' : 'Shift+') : ''}${key.toUpperCase()}`;
}

function shortcutLabel(mark: (typeof MARKS)[number], isMac: boolean): string {
  return modLabel(isMac, Boolean(mark.shift), mark.key);
}

/**
 * Editor form → storage form.
 *
 * The editor highlights with `<span style="background-color: …">`, because that
 * is what `execCommand('hiliteColor')` produces and, more to the point, what it
 * knows how to split, merge and clear correctly across a partial selection. The
 * stored dialect has no `style` attribute, so every span carrying one of our
 * five colours becomes a `<mark class="hl-…">` on the way out. A span with any
 * other background — including the `transparent` that CLEARS a highlight — is
 * left alone and unwrapped by the sanitiser, which is what makes clearing work.
 *
 * Runs on a clone: the live DOM holds the caret, and rewriting nodes under it
 * would collapse the selection mid-keystroke.
 */
function toStorageHtml(source: HTMLElement): string {
  const clone = source.cloneNode(true) as HTMLElement;
  // Document order, so an outer span is converted before an inner one; the
  // inner node travels into the new <mark> and is still reachable from the
  // static list when its turn comes.
  for (const span of Array.from(clone.querySelectorAll<HTMLElement>('span[style]'))) {
    const id = highlightIdFromCss(span.style.backgroundColor);
    if (!id) continue;
    const mark = clone.ownerDocument.createElement('mark');
    mark.className = `hl-${id}`;
    while (span.firstChild) mark.appendChild(span.firstChild);
    span.replaceWith(mark);
  }
  return sanitizePromptHtml(clone.innerHTML);
}

/**
 * The prompt body editor: bold, italic, underline, highlight and bullets,
 * nothing else.
 *
 * `contentEditable` rather than a controlled `<textarea>` because those marks
 * are exactly what `execCommand` already implements, correctly, against the
 * live selection. `execCommand` is formally deprecated but is the only
 * selection-aware formatting API every Chromium build ships — and this renderer
 * is Chromium by construction (Electron).
 *
 * The consequence is that the DOM, not React, owns the text while you type:
 * re-rendering the node from state on every keystroke would collapse the caret
 * to the start. So the body is written IN once (on mount, and imperatively when
 * the viewed version changes) and read OUT on change. `onChange` publishes the
 * sanitised, storage-form HTML upward for dirty-tracking and saving.
 */
export function RichPromptEditor({
  id,
  initialHtml,
  onChange,
  ref,
  ariaLabel,
  className,
  bodyClassName,
  invalid,
  describedBy,
  placeholder,
  toolbarHost,
}: {
  id: string;
  initialHtml: string;
  onChange: (html: string) => void;
  ref?: React.Ref<RichPromptEditorHandle>;
  ariaLabel: string;
  className?: string;
  /**
   * Classes for the editable region itself — height and surface. Merged with
   * `cn`, so a caller's `bg-*` / `border-*` genuinely replaces the default one
   * instead of racing it in the stylesheet: the new-prompt dialog sits its
   * fields on `bg-zinc-800`, the detail card on the overlay surface, and the
   * editor has to look like the form it is in.
   */
  bodyClassName?: string;
  /** Failed validation, on a form that submits the body (the new-prompt card). */
  invalid?: boolean;
  describedBy?: string;
  /**
   * Hint shown while the field is genuinely empty. A `contentEditable` has no
   * `placeholder`, so it is drawn as a `::before` on `:empty` — which is why it
   * disappears the moment Chromium puts a `<br>` in the box and does not come
   * back on delete-to-empty. Fine for a field that is empty exactly once, on a
   * blank new prompt; do not rely on it as a label.
   */
  placeholder?: string;
  /**
   * Where to render the formatting toolbar. It belongs to this component —
   * it reads `queryCommandState` off the live selection and acts on this
   * editor's caret — but it is PLACED by the caller, so it can sit in the
   * version rail with the rest of the controls instead of floating above the
   * text. Rendered inline when no host is given.
   */
  toolbarHost?: HTMLElement | null;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  // Which toolbar button currently holds the toolbar's single tab stop.
  const [toolbarIndex, setToolbarIndex] = useState(0);
  const [colorsOpen, setColorsOpen] = useState(false);
  // Resolved after mount, never during render: the server has no idea what the
  // viewer is typing on, and branching on it in render would hydrate mismatched.
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    setIsMac(/mac/i.test(navigator.platform || navigator.userAgent));
  }, []);

  const [active, setActive] = useState<Record<Mark, boolean>>({
    bold: false,
    italic: false,
    underline: false,
    insertUnorderedList: false,
  });
  /** The colour under the caret, or null where the text is not highlighted. */
  const [highlight, setHighlight] = useState<HighlightId | null>(null);
  /** What the shortcut and a bare click on the swatch button apply. */
  const [lastColor, setLastColor] = useState<HighlightId>(HIGHLIGHT_COLORS[0].id);

  // Held in a ref so the seed effect and the imperative handle always call the
  // caller's CURRENT handler without either needing to re-run.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const publish = useCallback(() => {
    if (bodyRef.current) onChangeRef.current(toStorageHtml(bodyRef.current));
  }, []);

  // Seeded once, then echoed straight back out. The echo matters: the browser
  // normalises whatever it is handed, so the parent's "unchanged" baseline has
  // to be what the DOM settled on, not what we passed in — otherwise the editor
  // reads as dirty the moment it mounts.
  useEffect(() => {
    const el = bodyRef.current;
    if (el && el.innerHTML === '') {
      el.innerHTML = marksToStyledSpans(initialHtml);
      publish();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      setHtml: (html: string) => {
        if (!bodyRef.current) return;
        bodyRef.current.innerHTML = marksToStyledSpans(html);
        publish();
      },
      focus: () => bodyRef.current?.focus(),
    }),
    [publish]
  );

  const refreshActive = useCallback(() => {
    if (typeof document === 'undefined') return;
    setActive({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      insertUnorderedList: document.queryCommandState('insertUnorderedList'),
    });
    setHighlight(
      highlightIdFromCss(
        document.queryCommandValue('hiliteColor') || document.queryCommandValue('backColor')
      )
    );
  }, []);

  const apply = useCallback(
    (cmd: Mark) => {
      // The toolbar button steals focus on mousedown, which is prevented below;
      // this restores the caret for the keyboard path.
      bodyRef.current?.focus();
      document.execCommand(cmd);
      refreshActive();
      publish();
    },
    [refreshActive, publish]
  );

  /**
   * Highlights the selection, or clears it when `id` is null.
   *
   * `hiliteColor` is used rather than wrapping the range by hand precisely
   * because the browser owns the hard parts: splitting a mark when you select
   * half of it, merging adjacent runs of the same colour, and — the one a
   * hand-rolled `<mark>` gets wrong — REMOVING a highlight from the middle of an
   * existing one. It also keeps every edit on the native undo stack, so Ctrl+Z
   * still walks back through highlights like any other formatting.
   */
  const applyHighlight = useCallback(
    (colorId: HighlightId | null) => {
      bodyRef.current?.focus();
      const value = colorId ? highlightCss(colorId) : 'transparent';
      // `styleWithCSS` is turned on for this one command and off again straight
      // after. Left on, the OTHER commands would start emitting
      // `<span style="font-weight: bold">` instead of `<b>` — markup the
      // dialect strips, so bold would silently stop saving.
      document.execCommand('styleWithCSS', false, 'true');
      // Chromium aliases the two, but `backColor` is the older spelling and the
      // one that answers when `hiliteColor` is not implemented.
      if (!document.execCommand('hiliteColor', false, value)) {
        document.execCommand('backColor', false, value);
      }
      document.execCommand('styleWithCSS', false, 'false');
      if (colorId) setLastColor(colorId);
      refreshActive();
      publish();
    },
    [refreshActive, publish]
  );

  /**
   * Ctrl/Cmd+B/I/U are handled here rather than left to the browser.
   *
   * Chromium does implement them natively inside `contentEditable`, but going
   * through the same path as the toolbar is what keeps the pressed state of the
   * buttons honest and the draft published on the same tick. It also lets the
   * bullet list and the highlight have shortcuts at all, which the browser does
   * not provide.
   */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!e.metaKey && !e.ctrlKey) return;
    if (e.altKey) return;
    const key = e.key.toLowerCase();

    // Ctrl/Cmd+Shift+H toggles the last colour used, the way a highlighter pen
    // works — press it on highlighted text and the highlight comes off.
    if (e.shiftKey && key === HIGHLIGHT_KEY) {
      e.preventDefault();
      e.stopPropagation();
      applyHighlight(highlight ? null : lastColor);
      return;
    }

    const mark = MARKS.find(m => {
      if (Boolean(m.shift) !== e.shiftKey) return false;
      // Shift+8 reports `key` as "*", not "8", so a digit shortcut has to be
      // matched by its physical key instead.
      return m.code ? e.code === m.code : m.key === key;
    });
    if (!mark) return;
    e.preventDefault();
    // Ctrl/Cmd+B is also the sidebar toggle, bound on the WINDOW. Stopping the
    // event here keeps it from ever reaching that listener; `sidebar.tsx` also
    // ignores keystrokes from a contenteditable, so the conflict is closed from
    // both ends — this alone is not sufficient, because a portalled dialog does
    // not necessarily bubble through React's root container.
    e.stopPropagation();
    apply(mark.cmd);
  };

  // A toolbar, declared as one: the buttons act on the editor, and without the
  // role/label pairing they announce as five loose controls.
  //
  // Declaring the role obliges us to implement the interaction that goes with
  // it. A toolbar is ONE tab stop whose members are reached with the arrow keys
  // (APG); five independent tab stops under the role is worse than no role at
  // all, because a screen reader announces "toolbar, 5 items" and then the
  // arrow keys do nothing. Hence the roving tabindex below.
  const onToolbarKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const buttons = Array.from(
      toolbarRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []
    );
    if (buttons.length === 0) return;

    const from = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const cursor = from === -1 ? toolbarIndex : from;
    const next =
      e.key === 'ArrowRight'
        ? (cursor + 1) % buttons.length
        : e.key === 'ArrowLeft'
          ? (cursor - 1 + buttons.length) % buttons.length
          : e.key === 'Home'
            ? 0
            : buttons.length - 1;

    setToolbarIndex(next);
    buttons[next].focus();
  };

  const highlightIndex = MARKS.length;
  const highlightHint = `Highlight (${modLabel(isMac, true, HIGHLIGHT_KEY)})`;

  const toolbar = (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label="Prompt formatting"
      aria-controls={id}
      onKeyDown={onToolbarKeyDown}
      className="flex w-fit items-center gap-0.5 rounded-lg border border-white/[0.07] bg-white/[0.025] p-0.5"
    >
      {MARKS.map((mark, i) => {
        const { cmd, label, icon: Icon } = mark;
        const hint = `${label} (${shortcutLabel(mark, isMac)})`;
        return (
        <Toggle
          key={cmd}
          size="sm"
          pressed={active[cmd]}
          // One tab stop for the whole toolbar; the arrows move within it.
          tabIndex={i === toolbarIndex ? 0 : -1}
          onFocus={() => setToolbarIndex(i)}
          // The shortcut is part of the name, not a `title` alone: a tooltip is
          // unreachable by keyboard and never announced, which is precisely the
          // audience a keyboard shortcut is for.
          aria-label={hint}
          title={hint}
          // Without this the editor loses its selection before the command
          // runs, and the mark lands on nothing.
          onMouseDown={e => e.preventDefault()}
          onPressedChange={() => apply(cmd)}
          className="size-7 min-w-0 p-0 text-zinc-300 hover:text-white data-[state=on]:bg-white/[0.1] data-[state=on]:text-white"
        >
          <Icon aria-hidden />
        </Toggle>
        );
      })}

      {/* Highlight is a colour CHOICE, not a binary mark, so it opens a picker
          rather than toggling. The trigger still shows pressed state, because
          "is the caret inside a highlight" is exactly what the other four
          buttons report about their own marks. */}
      <Popover open={colorsOpen} onOpenChange={setColorsOpen}>
        <PopoverTrigger asChild>
          <Toggle
            size="sm"
            pressed={highlight !== null}
            tabIndex={highlightIndex === toolbarIndex ? 0 : -1}
            onFocus={() => setToolbarIndex(highlightIndex)}
            aria-label={highlightHint}
            title={highlightHint}
            // Same reason as the marks above: opening the picker must not take
            // the selection the colour is about to be applied to. Opening is
            // the trigger's own click handler's job — adding `onPressedChange`
            // here would toggle the popover a second time on the same click and
            // cancel it out.
            onMouseDown={e => e.preventDefault()}
            className="relative size-7 min-w-0 p-0 text-zinc-300 hover:text-white data-[state=on]:bg-white/[0.1] data-[state=on]:text-white"
          >
            <Highlighter aria-hidden />
            {/* The colour that a bare shortcut press would apply, shown as the
                pen's own nib rather than as a second icon. */}
            <span
              aria-hidden
              className="absolute inset-x-1 bottom-0.5 h-0.5 rounded-full"
              style={{ backgroundColor: highlightCss(highlight ?? lastColor) }}
            />
          </Toggle>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-52 p-1"
          // The caret is in the editor and must stay there while the picker is
          // open — a focus move into the popover would collapse the selection.
          onOpenAutoFocus={e => e.preventDefault()}
        >
          <p className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
            Highlight
          </p>
          <ul>
            {HIGHLIGHT_COLORS.map(color => (
              <li key={color.id}>
                <button
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => {
                    applyHighlight(color.id);
                    setColorsOpen(false);
                  }}
                  aria-pressed={highlight === color.id}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-zinc-200 transition-colors hover:bg-white/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
                >
                  <span
                    aria-hidden
                    className="size-4 shrink-0 rounded-md border border-white/[0.14]"
                    style={{ backgroundColor: highlightCss(color.id) }}
                  />
                  {color.name}
                  {highlight === color.id && (
                    <Check className="ml-auto size-3.5 text-zinc-300" aria-hidden />
                  )}
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => {
                  applyHighlight(null);
                  setColorsOpen(false);
                }}
                className="mt-0.5 flex w-full items-center gap-2.5 rounded-md border-t border-white/[0.07] px-2 pb-1.5 pt-2 text-left text-sm text-zinc-200 transition-colors hover:bg-white/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
              >
                <span
                  aria-hidden
                  className="size-4 shrink-0 rounded-md border border-white/[0.14] bg-transparent"
                />
                No highlight
              </button>
            </li>
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );

  return (
    <div className={`flex flex-col gap-2 ${className ?? ''}`}>
      {toolbarHost ? createPortal(toolbar, toolbarHost) : toolbar}

      <div
        id={id}
        ref={bodyRef}
        role="textbox"
        aria-multiline
        aria-label={ariaLabel}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        data-placeholder={placeholder}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onInput={publish}
        onKeyDown={onKeyDown}
        onKeyUp={refreshActive}
        onMouseUp={refreshActive}
        onFocus={refreshActive}
        // Pasting rich content from anywhere would smuggle in markup the
        // dialect does not cover; take the plain text and let the marks be
        // applied deliberately.
        onPaste={e => {
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, text);
          publish();
        }}
        // `font-normal` is not redundant: globals.css sets `body { font-weight:
        // 500 }`, so unstyled prompt text inherits medium and reads as already
        // bold — leaving only 500→700 to distinguish an actual <b>. The base
        // drops to 400 and the marks go to 900.
        //
        // The text-stroke is the belt to that braces. Google Sans may not ship a
        // 900 face, and when a weight is missing the browser silently serves the
        // nearest one it has — so `font-black` alone can render identically to
        // `font-bold` and the mark stays ambiguous. Stroking the glyph thickens
        // it regardless of which faces exist.
        //
        // Highlights need no rule here: inside the editor they are inline-styled
        // spans (see `toStorageHtml`), and `mark.hl-*` in globals.css covers
        // every surface that renders the stored form.
        className={cn(
          'w-full resize-y overflow-y-auto whitespace-pre-wrap break-words rounded-lg border p-4 font-mono text-sm font-normal leading-relaxed text-zinc-100 outline-none focus-visible:border-zinc-500',
          '[&_b]:font-black [&_b]:text-white [&_b]:[-webkit-text-stroke:0.4px_currentColor] [&_strong]:font-black [&_strong]:text-white [&_strong]:[-webkit-text-stroke:0.4px_currentColor]',
          '[&_li]:ml-5 [&_li]:list-disc [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5',
          '[&:empty]:before:text-zinc-400 [&:empty]:before:content-[attr(data-placeholder)]',
          'min-h-[26rem] border-white/[0.07] bg-white/[0.025]',
          bodyClassName,
          invalid && 'border-red-500'
        )}
      />
    </div>
  );
}
