'use client';

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bold, Italic, List, Underline } from 'lucide-react';
import { Toggle } from '@/components/ui/toggle';
import { sanitizePromptHtml } from '@/lib/promptHtml';

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

function shortcutLabel(
  mark: (typeof MARKS)[number],
  isMac: boolean
): string {
  const mod = isMac ? '⌘' : 'Ctrl+';
  const shift = mark.shift ? (isMac ? '⇧' : 'Shift+') : '';
  return `${mod}${shift}${mark.key.toUpperCase()}`;
}

/**
 * The prompt body editor: bold, italic, underline and bullets, nothing else.
 *
 * `contentEditable` rather than a controlled `<textarea>` because the four
 * marks are exactly what `execCommand` already implements, correctly, against
 * the live selection. `execCommand` is formally deprecated but is the only
 * selection-aware formatting API every Chromium build ships — and this renderer
 * is Chromium by construction (Electron).
 *
 * The consequence is that the DOM, not React, owns the text while you type:
 * re-rendering the node from state on every keystroke would collapse the caret
 * to the start. So the body is written IN once (on mount, and imperatively when
 * the viewed version changes) and read OUT on change. `onChange` publishes the
 * sanitised HTML upward for dirty-tracking and saving.
 */
export function RichPromptEditor({
  id,
  initialHtml,
  onChange,
  ref,
  ariaLabel,
  className,
  toolbarHost,
}: {
  id: string;
  initialHtml: string;
  onChange: (html: string) => void;
  ref?: React.Ref<RichPromptEditorHandle>;
  ariaLabel: string;
  className?: string;
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

  // Held in a ref so the seed effect and the imperative handle always call the
  // caller's CURRENT handler without either needing to re-run.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const publish = useCallback(() => {
    if (bodyRef.current) onChangeRef.current(sanitizePromptHtml(bodyRef.current.innerHTML));
  }, []);

  // Seeded once, then echoed straight back out. The echo matters: the browser
  // normalises whatever it is handed, so the parent's "unchanged" baseline has
  // to be what the DOM settled on, not what we passed in — otherwise the editor
  // reads as dirty the moment it mounts.
  useEffect(() => {
    const el = bodyRef.current;
    if (el && el.innerHTML === '') {
      el.innerHTML = initialHtml;
      publish();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      setHtml: (html: string) => {
        if (!bodyRef.current) return;
        bodyRef.current.innerHTML = html;
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
   * Ctrl/Cmd+B/I/U are handled here rather than left to the browser.
   *
   * Chromium does implement them natively inside `contentEditable`, but going
   * through the same path as the toolbar is what keeps the pressed state of the
   * buttons honest and the draft published on the same tick. It also lets the
   * bullet list have a shortcut at all, which the browser does not provide.
   */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!e.metaKey && !e.ctrlKey) return;
    if (e.altKey) return;
    const key = e.key.toLowerCase();
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
  // role/label pairing they announce as four loose toggles.
  //
  // Declaring the role obliges us to implement the interaction that goes with
  // it. A toolbar is ONE tab stop whose members are reached with the arrow keys
  // (APG); four independent tab stops under the role is worse than no role at
  // all, because a screen reader announces "toolbar, 4 items" and then the
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
        className="min-h-[26rem] w-full resize-y overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-white/[0.07] bg-white/[0.025] p-4 font-mono text-sm font-normal leading-relaxed text-zinc-100 outline-none focus-visible:border-zinc-500 [&_b]:font-black [&_b]:text-white [&_b]:[-webkit-text-stroke:0.4px_currentColor] [&_li]:ml-5 [&_li]:list-disc [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-black [&_strong]:text-white [&_strong]:[-webkit-text-stroke:0.4px_currentColor] [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
      />
    </div>
  );
}
