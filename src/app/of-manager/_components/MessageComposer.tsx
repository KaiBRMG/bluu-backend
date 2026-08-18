'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AtSign,
  DollarSign,
  Eye,
  EyeOff,
  FileQuestion,
  Image as ImageIcon,
  Loader2,
  Music,
  Paperclip,
  Reply,
  RotateCw,
  SendHorizontal,
  Video,
  WifiOff,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useNetworkStatus } from '@/contexts/NetworkStatusContext';
import { useResolvedMedia } from '@/hooks/useOnlyFansMedia';
import { useOnlyFansUpload, UploadCancelled } from '@/hooks/useOnlyFansUpload';
import type { SendInput } from '@/hooks/useOnlyFansMessages';
import {
  MAX_MESSAGE_MEDIA,
  MAX_PPV_PRICE,
  MIN_PPV_PRICE,
  UPLOAD_ACCEPT,
  isValidPpvPrice,
  rejectUpload,
} from '@/lib/onlyfansUpload';
import VaultDialog from './VaultDialog';
import EmojiPicker from './EmojiPicker';
import {
  EMPTY_DRAFT,
  clearDraft,
  loadDraft,
  saveDraft,
  type Draft,
  type DraftMedia,
  type DraftReply,
} from '../_lib/drafts';
import { formatMoney } from '../_lib/format';

/**
 * The composer.
 *
 * Everything unsent about a message lives here and nowhere else — text,
 * attachments, price. That is the same rule the send path has always followed
 * (a failed send removes its optimistic bubble and hands the draft back) held
 * consistently across three new axes:
 *
 *  - **A failed send keeps its uploads.** Staging a file is a billed, single-use
 *    provider id; a send that fails has not consumed it, so the composer retries
 *    against the same id rather than paying to upload the same photo twice.
 *  - **A draft survives the window closing.** Persisted per account+chat (see
 *    `_lib/drafts.ts`), cleared only by a confirmed send.
 *  - **An in-flight send empties the composer optimistically** and restores
 *    *all* of it — text and media together — if it fails. Half a restore would
 *    leave the operator with a caption and no photo.
 *
 * The bytes of an attachment never pass through our API: `useOnlyFansUpload`
 * signs a Storage slot, the browser PUTs to it, and the provider fetches from
 * there. See `src/lib/onlyfansUpload.ts`.
 */

interface MessageComposerProps {
  accountId: string | null;
  chatId: string;
  fanName: string;
  canSend: boolean;
  sending: boolean;
  send: (input: SendInput) => Promise<boolean>;
  /**
   * A reply raised from a bubble in the thread. Consumed into the draft on
   * arrival and acknowledged via `onReplyConsumed`, so the target lives in
   * exactly one place — here — the instant after it is chosen.
   */
  replyRequest?: DraftReply | null;
  onReplyConsumed?: () => void;
}

/** An upload the operator has started but which has no provider id yet. */
interface PendingUpload {
  key: string;
  name: string;
  type: string;
  /**
   * The file itself, kept only so a failed upload can be retried in place. A
   * network blip mid-drop is the common failure here, and making the operator
   * find the file again is a worse answer than holding a reference to it for the
   * life of the composer.
   */
  file: File;
  /** Object URL for an image, so the chip shows the actual photo while it uploads. */
  localUrl: string | null;
  progress: number;
  error: string | null;
}

const MAX_TEXT_LENGTH = 5000;
/** Below this the counter is noise; above it the operator needs to see the wall coming. */
const COUNTER_VISIBLE_FROM = 4500;

const PRICE_PRESETS = [5, 10, 20, 50];

export default function MessageComposer({
  accountId,
  chatId,
  fanName,
  canSend,
  sending,
  send,
  replyRequest,
  onReplyConsumed,
}: MessageComposerProps) {
  const upload = useOnlyFansUpload();
  const { isOnline } = useNetworkStatus();

  // Read once, lazily: `ChatThread` is keyed on the chat, so this component is
  // remounted per thread and never has to reconcile a draft against a prop
  // change. (A chat cannot be selected before `accountId` resolves — the list it
  // is selected from is itself account-scoped — so the key is always complete.)
  const [draft, setDraft] = useState<Draft>(() => loadDraft(accountId, chatId));
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /**
   * Object URLs by media id, so a photo keeps its thumbnail after the upload
   * resolves. Deliberately *not* part of the draft: an object URL dies with the
   * document, and persisting one would restore a chip pointing at nothing.
   */
  const localUrlsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    saveDraft(accountId, chatId, draft);
  }, [accountId, chatId, draft]);

  // Take the thread's reply target into the draft and hand the event back, so
  // there is never a render in which both hold it. Focusing the textarea is the
  // point of the action — the operator chose Reply in order to type.
  useEffect(() => {
    if (!replyRequest) return;
    setDraft((prev) => ({ ...prev, replyTo: replyRequest }));
    textareaRef.current?.focus();
    onReplyConsumed?.();
  }, [replyRequest, onReplyConsumed]);

  // Object URLs are a document-lifetime leak if they are never revoked, and a
  // shift in this window is hours long.
  useEffect(() => {
    const urls = localUrlsRef.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  /** Grow with the content, to the cap. A composer is a paragraph, not a line. */
  const autoSize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(autoSize, [draft.text, autoSize]);

  const totalMedia = draft.media.length + pending.length;
  const remaining = MAX_MESSAGE_MEDIA - totalMedia;

  // ─── Attachments ──────────────────────────────────────────────────

  /**
   * Upload one already-staged chip through to a provider media id.
   *
   * Split out of `stageFiles` so a **retry re-runs this and nothing else**. The
   * obvious alternative — drop the failed chip and re-enter `stageFiles` — has to
   * re-do the attachment-cap arithmetic against a `pending` array that has not
   * re-rendered yet, so at the cap a retry would report "no room" for a slot it
   * was about to free. Retrying in place also keeps the chip where the operator
   * is looking.
   */
  const runUpload = useCallback(
    async (key: string, file: File, localUrl: string | null) => {
      try {
        const mediaId = await upload(file, {
          onProgress: (fraction) =>
            setPending((prev) => prev.map((p) => (p.key === key ? { ...p, progress: fraction } : p))),
        });

        if (localUrl) localUrlsRef.current.set(mediaId, localUrl);
        setPending((prev) => prev.filter((p) => p.key !== key));
        setDraft((prev) => ({
          ...prev,
          media: [
            ...prev.media,
            {
              id: mediaId,
              kind: 'upload',
              label: file.name,
              type: file.type.split('/')[0],
              previewUrl: null,
              width: null,
              height: null,
            },
          ],
        }));
      } catch (error) {
        if (error instanceof UploadCancelled) {
          if (localUrl) URL.revokeObjectURL(localUrl);
          setPending((prev) => prev.filter((p) => p.key !== key));
          return;
        }
        setPending((prev) =>
          prev.map((p) =>
            p.key === key
              ? { ...p, error: error instanceof Error ? error.message : 'Upload failed' }
              : p,
          ),
        );
      }
    },
    [upload],
  );

  /** Clear a failed chip's error and try the same file again. Nothing was billed. */
  const retryUpload = useCallback(
    (item: PendingUpload) => {
      setPending((prev) =>
        prev.map((p) => (p.key === item.key ? { ...p, error: null, progress: 0 } : p)),
      );
      runUpload(item.key, item.file, item.localUrl);
    },
    [runUpload],
  );

  const stageFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      const room = MAX_MESSAGE_MEDIA - (draft.media.length + pending.length);
      if (room <= 0) {
        toast.error(`A message can carry ${MAX_MESSAGE_MEDIA} attachments.`);
        return;
      }
      if (files.length > room) {
        toast.error(`Only ${room} more attachment${room === 1 ? '' : 's'} will fit — the rest were skipped.`);
      }

      for (const file of files.slice(0, room)) {
        // Rejected before anything is uploaded: being told at 100% that a file
        // was never sendable is the worst possible moment to find out.
        const rejection = rejectUpload(file);
        if (rejection) {
          toast.error(`${file.name}: ${rejection}`);
          continue;
        }

        const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const localUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;

        setPending((prev) => [
          ...prev,
          { key, name: file.name, type: file.type, file, localUrl, progress: 0, error: null },
        ]);

        // Awaited, so several dropped files upload one at a time rather than
        // saturating the connection and starving each other's progress.
        await runUpload(key, file, localUrl);
      }
    },
    [draft.media.length, pending.length, runUpload],
  );

  const removeMedia = (id: string) => {
    const url = localUrlsRef.current.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      localUrlsRef.current.delete(id);
    }
    setDraft((prev) => ({
      ...prev,
      media: prev.media.filter((m) => m.id !== id),
      previewIds: prev.previewIds.filter((p) => p !== id),
      // A price with nothing behind it is not a message the provider accepts.
      ...(prev.media.length === 1 ? { price: 0, lockedText: false } : {}),
    }));
  };

  const togglePreview = (id: string) => {
    setDraft((prev) => ({
      ...prev,
      previewIds: prev.previewIds.includes(id)
        ? prev.previewIds.filter((p) => p !== id)
        : [...prev.previewIds, id],
    }));
  };

  const addVaultMedia = (media: DraftMedia[]) => {
    setDraft((prev) => ({
      ...prev,
      media: [...prev.media, ...media.filter((m) => !prev.media.some((e) => e.id === m.id))],
    }));
  };

  // ─── Send ─────────────────────────────────────────────────────────

  const submit = async () => {
    const text = draft.text.trim();
    if (sending || (!text && draft.media.length === 0)) return;
    if (pending.length > 0) {
      toast.error('Wait for the attachments to finish uploading.');
      return;
    }

    const sent = draft;
    // Emptied optimistically — the bubble in the thread is now where this
    // message lives. Restored whole below if the provider refuses it.
    setDraft(EMPTY_DRAFT);

    const ok = await send({
      text,
      replyToMessageId: sent.replyTo?.id,
      mediaIds: sent.media.map((m) => m.id),
      previewIds: sent.price > 0 ? sent.previewIds : [],
      price: sent.price,
      lockedText: sent.lockedText,
    });

    if (ok) {
      for (const url of localUrlsRef.current.values()) URL.revokeObjectURL(url);
      localUrlsRef.current.clear();
      clearDraft(accountId, chatId);
    } else {
      // Text *and* media: the staged upload ids are still good (a failed send
      // does not consume them), so retrying costs nothing extra.
      setDraft(sent);
    }
  };

  if (!canSend) {
    return (
      <footer className="shrink-0 border-t border-white/[0.07] p-3">
        <p className="py-2 text-center text-sm text-zinc-400">
          You cannot send messages to this fan.
        </p>
      </footer>
    );
  }

  const hasMedia = draft.media.length > 0;
  const empty = draft.text.trim() === '' && !hasMedia;

  return (
    <TooltipProvider delayDuration={300}>
      <footer
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          // Only when the pointer has actually left the footer, not merely
          // crossed onto a child — otherwise the highlight strobes.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          stageFiles([...e.dataTransfer.files]);
        }}
        className={cn(
          'shrink-0 border-t border-white/[0.07] p-3 transition-colors',
          dragging && 'bg-[#3b82f6]/[0.08]',
        )}
      >
        {/* Offline is a condition, not an error — zinc, in place, and it stays
            for as long as it is true. It disables Send rather than letting the
            operator write into a message that cannot leave: the draft persists,
            so nothing typed while offline is lost. */}
        {!isOnline && (
          <div
            role="status"
            className="mb-2 flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-xs text-zinc-400"
          >
            <WifiOff className="size-3.5 shrink-0" />
            Offline — this message will send once you reconnect.
          </div>
        )}

        {draft.replyTo && (
          <ReplyStrip
            reply={draft.replyTo}
            fanName={fanName}
            onClear={() => setDraft((prev) => ({ ...prev, replyTo: null }))}
          />
        )}

        {(hasMedia || pending.length > 0) && (
          <div className="mb-2 flex flex-wrap gap-2">
            {draft.media.map((media) => (
              <StagedTile
                key={media.id}
                media={media}
                localUrl={localUrlsRef.current.get(media.id) ?? null}
                priced={draft.price > 0}
                isPreview={draft.previewIds.includes(media.id)}
                onRemove={() => removeMedia(media.id)}
                onTogglePreview={() => togglePreview(media.id)}
              />
            ))}
            {pending.map((item) => (
              <PendingTile
                key={item.key}
                item={item}
                onDismiss={() => {
                  if (item.localUrl) URL.revokeObjectURL(item.localUrl);
                  setPending((prev) => prev.filter((p) => p.key !== item.key));
                }}
                onRetry={item.error ? () => retryUpload(item) : undefined}
              />
            ))}
          </div>
        )}

        {draft.price > 0 && (
          <PriceStrip
            price={draft.price}
            previewCount={draft.previewIds.length}
            lockedText={draft.lockedText}
            onToggleLockedText={() =>
              setDraft((prev) => ({ ...prev, lockedText: !prev.lockedText }))
            }
            onClear={() => setDraft((prev) => ({ ...prev, price: 0, lockedText: false, previewIds: [] }))}
          />
        )}

        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={draft.text}
            onChange={(e) => setDraft((prev) => ({ ...prev, text: e.target.value }))}
            onKeyDown={(e) => {
              // `isComposing` guards the IME: the Enter that commits a Japanese
              // or Korean candidate must not also send the half-typed message.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
              // Escape drops the reply target rather than blurring — the strip
              // is the only modal-ish state the composer has, and the chat
              // list's own Escape handler ignores events from a textarea.
              if (e.key === 'Escape' && draft.replyTo) {
                e.preventDefault();
                setDraft((prev) => ({ ...prev, replyTo: null }));
              }
            }}
            onPaste={(e) => {
              // A pasted screenshot is a real `File` on the clipboard in
              // Chromium, so this needs nothing native — and pasting a
              // screenshot straight into a reply is the single most common way
              // media enters this composer.
              const files = [...e.clipboardData.files];
              if (files.length > 0) {
                e.preventDefault();
                stageFiles(files);
              }
            }}
            maxLength={MAX_TEXT_LENGTH}
            placeholder={hasMedia ? 'Add a message…' : 'Type a message…'}
            aria-label={`Message ${fanName}`}
            rows={1}
            className="max-h-40 min-h-[2.5rem] resize-none border-zinc-700 bg-zinc-800 text-sm placeholder-zinc-400 focus:border-zinc-500"
          />
          <Button
            onClick={submit}
            disabled={empty || sending || pending.length > 0 || !isOnline}
            // Action Blue Deep, not the stock `default` variant: under `.dark`
            // `--primary` resolves to near-white, which made the one primary
            // action in this window the loudest pixel on the screen and broke
            // the One Voice Rule. Deep rather than #3b82f6 because white ink on
            // #3b82f6 measures 3.68:1 and fails AA; on #2563eb it reads 5.17:1.
            className="h-10 shrink-0 bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <SendHorizontal className="size-4" />
            )}
            Send
          </Button>
        </div>

        <div className="mt-1.5 flex items-center gap-0.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={UPLOAD_ACCEPT}
            onChange={(e) => {
              stageFiles([...(e.target.files ?? [])]);
              // Cleared so re-picking the same file fires `change` again.
              e.target.value = '';
            }}
            className="hidden"
          />

          <ToolButton
            label="Attach a file"
            onClick={() => fileInputRef.current?.click()}
            disabled={remaining <= 0}
          >
            <Paperclip className="size-4" />
          </ToolButton>

          <ToolButton
            label="Add media from the vault"
            onClick={() => setVaultOpen(true)}
            disabled={remaining <= 0}
          >
            <ImageIcon className="size-4" />
          </ToolButton>

          <EmojiPicker
            onPick={(emoji) => setDraft((prev) => ({ ...prev, text: prev.text + emoji }))}
          />

          <PricePopover
            price={draft.price}
            disabled={!hasMedia}
            onApply={(price) => setDraft((prev) => ({ ...prev, price }))}
          />

          {/* Deliberately a stub. Tagging needs the creator registry that
              Phase 5 builds; a button that silently did nothing would be worse
              than one that says so. */}
          <ToolButton label="Tagging creators is not available yet" onClick={() => {}} disabled>
            <AtSign className="size-4" />
          </ToolButton>

          <span className="ml-auto flex items-center gap-2 text-xs text-zinc-400">
            {draft.text.length >= COUNTER_VISIBLE_FROM && (
              <span className="tabular-nums">
                {draft.text.length}/{MAX_TEXT_LENGTH}
              </span>
            )}
            {totalMedia > 0 && (
              <span className="tabular-nums">
                {totalMedia}/{MAX_MESSAGE_MEDIA}
              </span>
            )}
          </span>
        </div>

        <VaultDialog
          open={vaultOpen}
          onOpenChange={setVaultOpen}
          accountId={accountId}
          stagedIds={draft.media.map((m) => m.id)}
          remaining={Math.max(remaining, 0)}
          onAdd={addVaultMedia}
        />
      </footer>
    </TooltipProvider>
  );
}

// ─── Toolbar ────────────────────────────────────────────────────────

function ToolButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* The span keeps the tooltip reachable on a disabled button, which
            stops firing pointer events entirely. */}
        <span className="inline-flex">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            className="size-8 text-zinc-400 hover:text-white"
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Setting a PPV price.
 *
 * Bounded to the provider's own rule — free, or $3–$200 — and unavailable
 * without media, because a paid message with nothing to unlock is rejected on
 * arrival. The button says so rather than the send failing later.
 */
function PricePopover({
  price,
  disabled,
  onApply,
}: {
  price: number;
  disabled: boolean;
  onApply: (price: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');

  // Seeded when the popover opens rather than in an effect: opening is the event
  // that decides what the field should say, and an effect would be a cascading
  // render chasing a state change it already knows about.
  const change = (next: boolean) => {
    if (next) setValue(price > 0 ? String(price) : '');
    setOpen(next);
  };

  const parsed = Number(value);
  const valid = value !== '' && isValidPpvPrice(parsed) && parsed > 0;

  const apply = () => {
    if (!valid) return;
    onApply(parsed);
    setOpen(false);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Popover open={open} onOpenChange={change}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={disabled}
                aria-label="Set a price for this message"
                className={cn(
                  'size-8 text-zinc-400 hover:text-white',
                  price > 0 && 'text-orange-400 hover:text-orange-400',
                )}
              >
                <DollarSign className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 border-white/[0.07] bg-[#171717] p-3">
              <p className="mb-1 text-xs text-zinc-400">Price</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  apply();
                }}
                className="flex gap-2"
              >
                <Input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  inputMode="decimal"
                  placeholder={`${MIN_PPV_PRICE}–${MAX_PPV_PRICE}`}
                  aria-label="Message price in dollars"
                  className="h-8 border-zinc-700 bg-zinc-800 text-sm tabular-nums placeholder-zinc-400 focus:border-zinc-500"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={!valid}
                  className="h-8 bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
                >
                  Set
                </Button>
              </form>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {PRICE_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setValue(String(preset))}
                    className="rounded-full bg-white/[0.04] px-2.5 py-1 text-xs tabular-nums text-zinc-400 transition-colors hover:bg-white/[0.055] hover:text-white"
                  >
                    ${preset}
                  </button>
                ))}
              </div>

              {value !== '' && !valid && (
                <p className="mt-2 text-xs text-zinc-400">
                  OnlyFans accepts ${MIN_PPV_PRICE}–${MAX_PPV_PRICE}.
                </p>
              )}
            </PopoverContent>
          </Popover>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {disabled ? 'Attach media to set a price' : 'Set a price for this message'}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * "Replying to…", with the message quoted.
 *
 * **The provider takes a reply target but never reports one back** — no message
 * it returns says what it replies to, ours included. So this strip is the only
 * place on the surface where the relationship is ever visible, and it exists
 * only until Send. That asymmetry is the provider's, not a gap here; the thread
 * cannot render reply context it is never told about.
 *
 * The quote is clamped to one line: it is a reminder of what is being answered,
 * not a second copy of the conversation.
 */
function ReplyStrip({
  reply,
  fanName,
  onClear,
}: {
  reply: DraftReply;
  fanName: string;
  onClear: () => void;
}) {
  return (
    <div className="mb-2 flex items-center gap-2 rounded-lg border-l-2 border-[#3b82f6]/60 bg-white/[0.04] px-2.5 py-1.5">
      <Reply className="size-3.5 shrink-0 text-zinc-400" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-zinc-400">
          Replying to {reply.fromMe ? 'yourself' : fanName}
        </p>
        <p className="truncate text-xs text-foreground">
          {reply.text || <span className="text-zinc-400">Attachment</span>}
        </p>
      </div>
      <button
        type="button"
        onClick={onClear}
        aria-label="Cancel reply"
        className="shrink-0 text-zinc-400 transition-colors hover:text-white"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

/**
 * The state of a priced message, spelled out.
 *
 * Orange is the semantic "awaiting" hue the thread already uses for a locked
 * PPV, so the composer and the resulting bubble read as the same fact. The
 * preview count is here because "locked" without it is ambiguous: a set with no
 * preview shows the fan nothing at all, and that is a choice worth seeing before
 * pressing Send.
 */
function PriceStrip({
  price,
  previewCount,
  lockedText,
  onToggleLockedText,
  onClear,
}: {
  price: number;
  previewCount: number;
  lockedText: boolean;
  onToggleLockedText: () => void;
  onClear: () => void;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-orange-500/30 bg-orange-500/[0.09] px-2.5 py-1.5 text-xs">
      <span className="font-medium tabular-nums text-orange-400">{formatMoney(price)} to unlock</span>
      <span className="text-zinc-400">
        {previewCount > 0
          ? `${previewCount} shown as preview`
          : 'Nothing shown before unlocking'}
      </span>
      <button
        type="button"
        onClick={onToggleLockedText}
        aria-pressed={lockedText}
        className="text-zinc-400 transition-colors hover:text-white"
      >
        {lockedText ? 'Message text hidden' : 'Message text visible'}
      </button>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto text-zinc-400 transition-colors hover:text-white"
      >
        Make free
      </button>
    </div>
  );
}

// ─── Staged media ───────────────────────────────────────────────────

function TypeIcon({ type }: { type: string }) {
  if (type === 'video') return <Video className="size-4" />;
  if (type === 'audio') return <Music className="size-4" />;
  if (type === 'photo' || type === 'image' || type === 'gif') return <ImageIcon className="size-4" />;
  return <FileQuestion className="size-4" />;
}

/**
 * One attachment, staged and ready.
 *
 * Vault media carries an expiring CDN link and resolves like any other tile;
 * an upload has no such link, so it shows the browser's own copy of the file
 * while the document lives and a type icon after that.
 */
function StagedTile({
  media,
  localUrl,
  priced,
  isPreview,
  onRemove,
  onTogglePreview,
}: {
  media: DraftMedia;
  localUrl: string | null;
  priced: boolean;
  isPreview: boolean;
  onRemove: () => void;
  onTogglePreview: () => void;
}) {
  // Vault media only. An upload's id is an `ofapi_media_…` staging handle that
  // the media cache has never seen and never will, so asking would be a round
  // trip to be told so — the browser's own copy of the file is what shows there.
  const resolved = useResolvedMedia(
    localUrl || media.kind !== 'vault'
      ? null
      : { id: media.id, variant: media.previewVariant ?? 'preview', url: media.previewUrl },
    !localUrl && media.kind === 'vault',
  );
  const url = localUrl ?? resolved.url;

  return (
    <div className="group relative size-16 overflow-hidden rounded-lg border border-white/[0.07] bg-white/[0.04]">
      {url ? (
        // A local object URL or a short-lived signed provider URL — neither can
        // go through next/image, and neither is an avatar.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          onError={localUrl ? undefined : resolved.onLoadError}
          decoding="async"
          draggable={false}
          className={cn('size-full object-cover', priced && !isPreview && 'blur-[2px]')}
        />
      ) : (
        <span className="flex size-full flex-col items-center justify-center gap-0.5 px-1 text-center text-zinc-400">
          <TypeIcon type={media.type} />
          <span className="w-full truncate text-[11px]">{media.label}</span>
        </span>
      )}

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${media.label}`}
        className="absolute right-0.5 top-0.5 flex size-5 items-center justify-center rounded-full bg-black/70 text-zinc-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
      >
        <X className="size-3" />
      </button>

      {/* Only meaningful once there is a paywall for a preview to be an
          exception to — on a free message every attachment is visible. */}
      {priced && (
        <button
          type="button"
          onClick={onTogglePreview}
          aria-pressed={isPreview}
          aria-label={isPreview ? `Lock ${media.label}` : `Show ${media.label} as a preview`}
          className="absolute bottom-0.5 left-0.5 flex size-5 items-center justify-center rounded-full bg-black/70 text-zinc-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
        >
          {isPreview ? <Eye className="size-3 text-green-400" /> : <EyeOff className="size-3" />}
        </button>
      )}
    </div>
  );
}

/**
 * An upload in flight, or one that failed.
 *
 * A failure is **retryable in place**. Nothing was staged with the provider — a
 * failed upload has no id and cost nothing — so retrying is free, and the
 * alternative is asking the operator to find the file again after a network
 * blip. Dismiss stays available beside it for the case where the file was wrong.
 */
function PendingTile({
  item,
  onDismiss,
  onRetry,
}: {
  item: PendingUpload;
  onDismiss: () => void;
  onRetry?: () => void;
}) {
  return (
    <div className="relative size-16 overflow-hidden rounded-lg border border-white/[0.07] bg-white/[0.04]">
      {item.localUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.localUrl}
          alt=""
          decoding="async"
          draggable={false}
          className="size-full object-cover opacity-40"
        />
      )}

      <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-1 text-center text-zinc-400">
        {item.error ? (
          onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              aria-label={`Retry uploading ${item.name}`}
              className="flex flex-col items-center gap-0.5 text-zinc-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
            >
              <RotateCw className="size-4" />
              <span className="text-[11px] leading-tight">Retry</span>
            </button>
          ) : (
            <span className="text-[11px] leading-tight">Failed</span>
          )
        ) : (
          <>
            <Loader2 className="size-4 animate-spin" />
            <span className="text-[11px] tabular-nums">{Math.round(item.progress * 100)}%</span>
          </>
        )}
      </span>

      <button
        type="button"
        onClick={onDismiss}
        aria-label={item.error ? `Dismiss ${item.name}` : `Cancel ${item.name}`}
        className="absolute right-0.5 top-0.5 flex size-5 items-center justify-center rounded-full bg-black/70 text-zinc-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
