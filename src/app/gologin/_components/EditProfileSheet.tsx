'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { cn } from '@/lib/utils';
import { SURFACE } from '@/lib/surfaces';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  goLoginOsLabel,
  isGoLoginProxyMode,
  type GoLoginProfile,
  type GoLoginProfileDetail,
} from '@/lib/gologin/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DANGER_BUTTON,
  FIELD,
  holderHas,
  LABEL,
  PRIMARY_BUTTON,
  type ManagedFolder,
  type ProfileHolder,
} from '../_lib/manage';
import FolderChecklist from './FolderChecklist';
import OsIcon from './OsIcon';
import ProxyFields, {
  EMPTY_PROXY,
  proxyComplete,
  proxyKey,
  proxyPayload,
  type ProxyDraft,
} from './ProxyFields';

interface Loaded {
  profile: GoLoginProfileDetail;
  folderIds: string[];
  /** Every user-facing folder — arrives with the profile, so no second request. */
  folders: ManagedFolder[];
}

/** The proxy as stored, in the form's shape. Unsupported modes are handled apart. */
function draftFrom(detail: GoLoginProfileDetail): ProxyDraft {
  const mode = detail.proxy.mode;
  return {
    enabled: isGoLoginProxyMode(mode),
    mode: isGoLoginProxyMode(mode) ? mode : 'http',
    host: detail.proxy.host,
    port: detail.proxy.port ? String(detail.proxy.port) : '',
    username: detail.proxy.username,
    password: '',
    keepPassword: detail.proxy.hasPassword,
  };
}

function sameProxy(a: ProxyDraft, b: ProxyDraft): boolean {
  if (a.enabled !== b.enabled) return false;
  return !a.enabled || proxyKey(a) === proxyKey(b);
}

function sameSet(a: ReadonlySet<string>, b: readonly string[]): boolean {
  return a.size === b.length && b.every((id) => a.has(id));
}

function formatDate(ms: number | null): string {
  return ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

/**
 * Edit Profile — every fact about one profile, with the few that are safe to
 * change made editable.
 *
 * ## Two halves, and the line between them is GoLogin's, not ours
 *
 * **Editable:** name, notes, proxy, folders. GoLogin's own guidance lists these
 * as safe to change at any time.
 *
 * **Read-only:** the fingerprint — OS, user agent, screen, language, CPU,
 * memory, WebGL, WebRTC, canvas, timezone. GoLogin states these must never
 * change once an account has logged in ("websites treat the browser as a new
 * device"), so the panel shows them and says why they are fixed rather than
 * offering a control that would cost someone an account.
 *
 * ## Saving
 *
 * The Save bar exists only while something differs from what was loaded, and
 * only the changed fields are sent — each through its own field-scoped endpoint
 * server-side. A changed proxy must pass Ping first, for the same reason as on
 * New Profile. A profile someone has open cannot be saved (the server refuses
 * too): a proxy change under a live session would not reach it, and the notes
 * write replays the whole document.
 */
export default function EditProfileSheet({
  profileId,
  onOpenChange,
  onSaved,
  canEditFolders,
  holder,
}: {
  /** The profile being edited, or null when closed. */
  profileId: string | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (profile: GoLoginProfile) => void;
  canEditFolders: boolean;
  /** Who has it open right now, if anyone — from the live lock snapshot. */
  holder: ProfileHolder | null;
}) {
  const authFetch = useAuthFetch();
  const open = !!profileId;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [proxy, setProxy] = useState<ProxyDraft | null>(null);
  const [replacingProxy, setReplacingProxy] = useState(false);
  const [folderIds, setFolderIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmRemoveProxy, setConfirmRemoveProxy] = useState(false);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /** Put the form back to exactly what was loaded — Discard costs no request. */
  const applyLoaded = useCallback((data: Loaded) => {
    setName(data.profile.name);
    setNotes(data.profile.notes);
    setProxy(draftFrom(data.profile));
    setReplacingProxy(false);
    setFolderIds(new Set(data.folderIds));
  }, []);

  const load = useCallback(
    async (id: string) => {
      setLoaded(null);
      setError(null);
      try {
        const data: Loaded = await authFetch(`/api/gologin/manage/profiles/${encodeURIComponent(id)}`);
        if (!aliveRef.current) return;
        setLoaded(data);
        applyLoaded(data);
      } catch (err) {
        if (!aliveRef.current) return;
        setError(err instanceof Error ? err.message : 'Could not load the profile.');
      }
    },
    [authFetch, applyLoaded],
  );

  useEffect(() => {
    if (profileId) void load(profileId);
  }, [profileId, load]);

  const detail = loaded?.profile ?? null;
  const baseline = useMemo(() => (detail ? draftFrom(detail) : null), [detail]);
  /** A proxy mode this form cannot express (SOCKS4, Tor, GoLogin's own…). */
  const foreignProxy =
    !!detail && detail.proxy.mode !== 'none' && !isGoLoginProxyMode(detail.proxy.mode) && !replacingProxy;

  const nameChanged = !!detail && name.trim() !== detail.name;
  const notesChanged = !!detail && notes.trim() !== detail.notes.trim();
  const proxyChanged = !!proxy && !!baseline && (replacingProxy || !sameProxy(proxy, baseline));
  const foldersChanged = !!loaded && !sameSet(folderIds, loaded.folderIds);
  const initialFolders = useMemo(() => new Set(loaded?.folderIds ?? []), [loaded]);
  const dirty = nameChanged || notesChanged || proxyChanged || foldersChanged;

  const removingProxy = proxyChanged && !proxy?.enabled && !!baseline?.enabled;

  const blocker = holder
    ? `${holderHas(holder)} this profile open.`
    : !name.trim()
      ? 'The profile needs a name.'
      : proxyChanged && proxy?.enabled && !proxyComplete(proxy)
        ? 'Enter the proxy’s IP and port.'
        : null;

  const save = () => {
    if (!detail || !dirty || blocker || saving) return;
    // Taking the proxy away puts a signed-in account on whichever desk opens it
    // next — asked, never a side effect of a segmented control.
    if (removingProxy) {
      setConfirmRemoveProxy(true);
      return;
    }
    void commit();
  };

  const commit = async () => {
    if (!detail) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (nameChanged) body.name = name.trim();
      if (notesChanged) body.notes = notes;
      if (proxyChanged && proxy) body.proxy = proxyPayload(proxy);
      if (foldersChanged) body.folderIds = [...folderIds];
      const result: { profile: GoLoginProfile } = await authFetch(
        `/api/gologin/manage/profiles/${encodeURIComponent(detail.id)}`,
        { method: 'PATCH', body: JSON.stringify(body) },
      );
      onSaved(result.profile);
      toast.success(`Saved ${result.profile.name}.`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the profile.');
    } finally {
      if (aliveRef.current) setSaving(false);
    }
  };

  const fingerprint: [string, React.ReactNode][] = detail
    ? [
        [
          'Operating system',
          <span key="os" className="flex items-center gap-1.5">
            <OsIcon os={detail.os} osSpec={detail.osSpec} />
            {goLoginOsLabel(detail.os, detail.osSpec)}
          </span>,
        ],
        ['Browser', detail.browserType || '—'],
        ['User agent', <span key="ua" className="break-all font-mono text-[11px]">{detail.userAgent || '—'}</span>],
        ['Screen', <span key="res" className="tabular-nums">{detail.resolution || '—'}</span>],
        ['Language', detail.autoLang ? 'Follows the proxy’s location' : detail.language || '—'],
        ['Timezone', detail.timezoneFromIp ? 'Follows the proxy’s IP' : detail.timezone || '—'],
        ['Platform', detail.platform || '—'],
        ['CPU threads', <span key="cpu" className="tabular-nums">{detail.hardwareConcurrency ?? '—'}</span>],
        ['Memory', <span key="mem" className="tabular-nums">{detail.deviceMemory ? `${detail.deviceMemory} GB` : '—'}</span>],
        ['WebGL', [detail.webglVendor, detail.webglRenderer].filter(Boolean).join(' · ') || '—'],
        ['WebRTC', detail.webRtcMode || '—'],
        ['Canvas', detail.canvasMode || '—'],
      ]
    : [];

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        if (!next && dirty) {
          setConfirmDiscard(true);
          return;
        }
        onOpenChange(next);
      }}
    >
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="shrink-0 border-b border-white/[0.07] px-6 pb-4 pt-5 text-left">
          <SheetTitle className="truncate pr-6 text-lg font-semibold text-white">
            {detail?.name || 'Edit profile'}
          </SheetTitle>
          <SheetDescription className="text-[11px] text-zinc-400">
            {detail ? (
              <>
                <span className="font-mono">{detail.id}</span>
                {' · created '}
                {formatDate(detail.createdAtMs)}
              </>
            ) : (
              'Loading from GoLogin…'
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <div className="flex flex-col items-start gap-2 p-6">
              <p className="text-sm text-zinc-400">{error}</p>
              <Button variant="outline" size="sm" onClick={() => profileId && load(profileId)}>
                Retry
              </Button>
            </div>
          ) : !detail || !proxy ? (
            <div className="space-y-5 p-6" role="status" aria-label="Loading profile">
              {[0, 1, 2].map((i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-3 w-20 rounded" />
                  <Skeleton className="h-9 w-full rounded-md" />
                </div>
              ))}
              <Skeleton className="h-40 w-full rounded-xl" />
            </div>
          ) : (
            <div className="space-y-6 px-6 py-5">
              {holder && (
                <p className={cn('flex items-start gap-2 rounded-lg px-3 py-2 text-[11px] text-zinc-400', SURFACE)}>
                  <Lock className="mt-px size-3.5 shrink-0" aria-hidden />
                  <span>
                    {holder.self ? (
                      'You have this profile open. Close it to save changes.'
                    ) : (
                      <>
                        <span className="font-medium text-white">{holder.name}</span> has this profile
                        open. Changes can be saved once they close it.
                      </>
                    )}
                  </span>
                </p>
              )}

              <label className="block">
                <span className={LABEL}>Name</span>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  className={`h-9 ${FIELD}`}
                />
              </label>

              <label className="block">
                <span className={LABEL}>Notes</span>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  className={`resize-y text-sm ${FIELD}`}
                />
              </label>

              <fieldset>
                <legend className={LABEL}>Connection</legend>
                {foreignProxy ? (
                  <div className="space-y-2">
                    <p className="text-sm text-white">
                      <span className="uppercase">{detail.proxy.mode}</span>
                      {detail.proxy.host && (
                        <span className="font-mono text-zinc-300"> · {detail.proxy.host}</span>
                      )}
                    </p>
                    <p className="max-w-[60ch] text-[11px] text-zinc-400">
                      This proxy type is managed in GoLogin&rsquo;s own app. Replacing it here swaps it
                      for an HTTP or SOCKS5 proxy.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setReplacingProxy(true);
                        setProxy(EMPTY_PROXY);
                      }}
                    >
                      Replace proxy
                    </Button>
                  </div>
                ) : (
                  <>
                    <ProxyFields draft={proxy} onChange={setProxy} />
                    {/* A new proxy is safe; a new *location* is not. Said only
                        when an existing proxy is being replaced, so it is read. */}
                    {proxyChanged && proxy.enabled && baseline?.enabled && (
                      <p className="mt-2 max-w-[62ch] text-[11px] text-orange-400">
                        If an account is already signed in here, keep the new proxy in the same
                        country and city — a sudden change of location can trigger a security check.
                      </p>
                    )}
                  </>
                )}
              </fieldset>

              <fieldset>
                <legend className={LABEL}>Folders</legend>
                <FolderChecklist
                  folders={loaded?.folders ?? []}
                  loading={false}
                  error={null}
                  selected={folderIds}
                  initial={initialFolders}
                  disabled={!canEditFolders}
                  maxHeightClass="max-h-44"
                  onChange={setFolderIds}
                />
                {!canEditFolders && (
                  <p className="mt-1 text-[11px] text-zinc-400">
                    Changing folders needs the folder permission.
                  </p>
                )}
              </fieldset>

              <section aria-labelledby="fingerprint-heading">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 id="fingerprint-heading" className="text-xs font-medium text-zinc-400">
                    Fingerprint
                  </h3>
                  <span className="flex items-center gap-1 text-[11px] text-zinc-400">
                    <Lock className="size-3" aria-hidden />
                    Fixed at creation
                  </span>
                </div>
                <p className="mt-1 max-w-[62ch] text-[11px] text-zinc-400">
                  Changing these after an account has signed in makes sites see a new device, so
                  they can&rsquo;t be edited.
                </p>
                <dl className={cn('mt-3 divide-y divide-white/[0.07] rounded-xl', SURFACE)}>
                  {fingerprint.map(([label, value]) => (
                    <div key={label} className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 px-3 py-2">
                      <dt className="text-[11px] text-zinc-400">{label}</dt>
                      <dd className="min-w-0 text-xs text-zinc-300">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 text-[11px] text-zinc-400">
                  Updated {formatDate(detail.updatedAtMs)}
                  {detail.lastActivityMs ? ` · last active ${formatDate(detail.lastActivityMs)}` : ''}
                </p>
              </section>
            </div>
          )}
        </div>

        {/* Only while something differs from what was loaded — an ever-present
            Save invites a no-op write, and on this panel every write is a
            billed request against a token a 429 destroys. */}
        {dirty && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-white/[0.07] px-6 py-3">
            <p className="min-w-0 text-[11px] text-zinc-400" aria-live="polite">
              {blocker ?? 'Unsaved changes.'}
            </p>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={() => loaded && applyLoaded(loaded)}
              >
                Discard
              </Button>
              <Button size="sm" className={PRIMARY_BUTTON} disabled={!!blocker || saving} onClick={save}>
                {saving && <Loader2 className="activity-spinner size-3.5 animate-spin" aria-hidden />}
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>

      <AlertDialog open={confirmRemoveProxy} onOpenChange={setConfirmRemoveProxy}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the proxy from {detail?.name || 'this profile'}?</AlertDialogTitle>
            <AlertDialogDescription>
              Without a proxy it connects from the IP of whichever computer opens it next. An account
              signed in here will see a new location and may be locked or asked to verify.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep the proxy</AlertDialogCancel>
            <AlertDialogAction
              className={DANGER_BUTTON}
              onClick={() => {
                setConfirmRemoveProxy(false);
                void commit();
              }}
            >
              Remove proxy
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Esc or an outside click with unsaved edits used to close silently —
          including a proxy that had just passed Ping. Asked, not assumed. */}
      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
            <AlertDialogDescription>
              The edits to {detail?.name || 'this profile'} have not been saved to GoLogin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              className={DANGER_BUTTON}
              onClick={() => {
                setConfirmDiscard(false);
                onOpenChange(false);
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}
