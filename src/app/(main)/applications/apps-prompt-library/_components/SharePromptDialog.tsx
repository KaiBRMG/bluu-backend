'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Copy, Globe, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { SURFACE } from '@/lib/surfaces';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
import { promptShareUrl } from '@/lib/promptShareUrl';
import { copyText } from '@/lib/copyText';
import { grantedRole } from '@/lib/promptAccess';
import { useAuth } from '@/components/AuthProvider';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useBasicUsers, type BasicUser } from '@/hooks/useBasicUsers';
import { usePromptLibrary, type AccessChangeInput } from '@/contexts/PromptLibraryContext';
import {
  EMPTY_ACCESS,
  type PromptDocument,
  type PromptGrant,
  type PromptGrantTarget as Target,
  type PromptRole,
} from '@/types/promptLibrary';
import { relativeTime } from '../_lib/format';

const key = (t: Target) => `${t.kind}:${t.id}`;

const ROLE_LABEL: Record<PromptRole, string> = { view: 'Can view', edit: 'Can edit' };

/** The two grantable roles, in one place so no menu retypes the labels. */
function RoleItems() {
  return (
    <>
      {(['view', 'edit'] as const).map(r => (
        <SelectItem key={r} value={r}>
          {ROLE_LABEL[r]}
        </SelectItem>
      ))}
    </>
  );
}

// Groups that never appear in the picker: admins already own every prompt, and
// "unassigned" is a holding state, not a team.
const HIDDEN_GROUPS = new Set(['admin', 'unassigned']);

const selectTriggerClass =
  'h-8 w-[8.5rem] border-zinc-700 bg-zinc-800 text-xs text-white focus-visible:border-zinc-500';

type AvatarUser = Pick<BasicUser, 'displayName' | 'photoURL'>;

function PersonAvatar({ user, className }: { user: AvatarUser; className?: string }) {
  // Seeded from displayName so one person is one colour everywhere (DESIGN.md).
  const seed = user.displayName || 'User';
  return (
    <Avatar className={cn('size-8', className)} style={{ background: getAvatarColor(seed) }}>
      {user.photoURL && <AvatarImage src={user.photoURL} alt="" />}
      <AvatarFallback style={{ background: getAvatarColor(seed), color: '#fff' }}>
        {getInitials(seed)}
      </AvatarFallback>
    </Avatar>
  );
}

function GroupTile({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full bg-white/[0.08]',
        className
      )}
    >
      <Users className="size-4 text-zinc-300" />
    </span>
  );
}

/**
 * How many people and groups a prompt is shared with, for the Share button.
 * A count, not faces: drawing faces needs the whole staff directory, which the
 * dialog fetches when it opens — a button should not cost a users read.
 */
export function AccessCount({ prompt }: { prompt: PromptDocument }) {
  const total =
    Object.keys(prompt.access?.users ?? {}).length + Object.keys(prompt.access?.groups ?? {}).length;
  if (total === 0) return null;
  return (
    <span className="flex items-center gap-1 text-[11px] tabular-nums text-zinc-400">
      <Users className="size-3" aria-hidden />
      {total}
      <span className="sr-only"> with access</span>
    </span>
  );
}

/**
 * Who a prompt is shared with.
 *
 * The organisation (admins) owns every prompt, so the first row is locked and
 * says so. Everything else is a grant — a person or a group — and every change
 * saves the moment it is made, with an Undo toast, rather than behind a Save
 * button (the same pattern as /admin-portal/sharing). Editors may open this
 * dialog; viewers never see the Share button at all.
 */
export function SharePromptDialog({
  prompt,
  open,
  onOpenChange,
  onLostAccess,
}: {
  prompt: PromptDocument;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired when the caller removed or demoted their own access. */
  onLostAccess: () => void;
}) {
  const { user: authUser } = useAuth();
  const myUid = authUser?.uid ?? '';
  const { updateAccess, shareLink, revokeShare, viewer } = usePromptLibrary();
  const { users, groups, loading, error, refetch } = useBasicUsers(open);

  const [staged, setStaged] = useState<Target[]>([]);
  const [newRole, setNewRole] = useState<PromptRole>('view');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; run: () => void } | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const usersById = useMemo(() => new Map(users.map(u => [u.uid, u])), [users]);
  const groupsById = useMemo(() => new Map(groups.map(g => [g.id, g])), [groups]);

  const access = prompt.access ?? EMPTY_ACCESS;

  const groupRows = useMemo(
    () =>
      Object.entries(access.groups)
        .map(([id, grant]) => ({ id, grant, name: groupsById.get(id)?.name ?? id }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [access.groups, groupsById]
  );
  const userRows = useMemo(
    () =>
      Object.entries(access.users)
        .map(([id, grant]) => {
          const u = usersById.get(id);
          return {
            id,
            grant,
            user: u,
            name: u?.displayName || 'Unknown person',
            gone: !u || !u.isActive || u.isArchived,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [access.users, usersById]
  );

  const stagedKeys = useMemo(() => new Set(staged.map(key)), [staged]);

  const offerGroups = useMemo(
    () => groups.filter(g => !HIDDEN_GROUPS.has(g.id) && !access.groups[g.id]),
    [groups, access.groups]
  );
  const offerUsers = useMemo(
    () =>
      users
        .filter(u => u.isActive && !u.isArchived && u.uid !== myUid && !access.users[u.uid])
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [users, access.users, myUid]
  );

  const toggleStaged = (t: Target) =>
    setStaged(prev =>
      stagedKeys.has(key(t)) ? prev.filter(p => key(p) !== key(t)) : [...prev, t]
    );

  /** Runs one change; closes everything if the caller lost edit access by it. */
  const apply = async (change: AccessChangeInput, rowKey: string | null) => {
    setBusy(rowKey ?? 'add');
    try {
      const role = await updateAccess(prompt.id, change);
      if (role !== 'edit') {
        onOpenChange(false);
        onLostAccess();
        toast.success(
          role ? 'You now have view-only access' : 'You no longer have access to this prompt'
        );
        return false;
      }
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update sharing');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const undoable = (message: string, undo: AccessChangeInput) =>
    toast.success(message, {
      action: { label: 'Undo', onClick: () => void apply(undo, null) },
    });

  const addStaged = async () => {
    if (staged.length === 0) return;
    const targets = staged;
    const ok = await apply({ set: targets.map(t => ({ ...t, role: newRole })) }, null);
    if (!ok) return;
    setStaged([]);
    undoable(targets.length === 1 ? 'Shared' : `Shared with ${targets.length}`, { remove: targets });
  };

  /**
   * What the caller would hold after `change`, resolved the way the server does —
   * direct grant plus every group they are in. Only this tells whether a change
   * costs them edit access: removing your own row is harmless while a group still
   * grants it, and removing a group row is costly when it was the only route.
   */
  const roleAfter = (change: AccessChangeInput): PromptRole | null => {
    const next = { users: { ...access.users }, groups: { ...access.groups } };
    for (const g of change.set ?? []) {
      (g.kind === 'user' ? next.users : next.groups)[g.id] = {
        role: g.role,
        grantedBy: myUid,
        grantedAt: '',
      };
    }
    for (const r of change.remove ?? []) delete (r.kind === 'user' ? next.users : next.groups)[r.id];
    return grantedRole(next, { uid: myUid, groups: viewer.groups, isAdmin: false });
  };

  const changeRole = (
    t: Target,
    grant: PromptGrant,
    next: PromptRole | 'remove',
    label: string
  ) => {
    if (next !== 'remove' && next === grant.role) return;
    const change: AccessChangeInput =
      next === 'remove' ? { remove: [t] } : { set: [{ ...t, role: next }] };

    const run = async () => {
      if (await apply(change, key(t))) {
        undoable(
          next === 'remove' ? `Removed ${label}` : `${label}: ${ROLE_LABEL[next].toLowerCase()}`,
          { set: [{ ...t, role: grant.role }] }
        );
      }
    };

    // Dropping your own edit access is the one change with no way back in on
    // your own. Admins own every prompt, so nothing here can lock them out.
    const after = roleAfter(change);
    if (!viewer.isAdmin && after !== 'edit') {
      setConfirm({
        message:
          after === null
            ? 'You’ll lose access to this prompt.'
            : 'You’ll lose edit access to this prompt.',
        run: () => void run(),
      });
    } else {
      void run();
    }
  };

  const togglePublic = async (on: boolean) => {
    setLinkBusy(true);
    try {
      if (on) {
        await shareLink(prompt.id);
        toast.success('Public link on', { description: 'Anyone with the link can read this prompt.' });
      } else {
        await revokeShare(prompt.id);
        toast.success('Public link off', { description: 'The old link no longer works.' });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change the public link');
    } finally {
      setLinkBusy(false);
    }
  };

  const copyLink = async () => {
    if (!prompt.shareId) return;
    if (await copyText(promptShareUrl(prompt.shareId))) {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1600);
    } else {
      toast.error('Could not copy the link');
    }
  };

  const stagedLabel = (t: Target) =>
    t.kind === 'group'
      ? (groupsById.get(t.id)?.name ?? t.id)
      : (usersById.get(t.id)?.displayName ?? t.id);

  const rowShell = 'flex items-center gap-3 rounded-lg px-2 py-2';

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) {
          setStaged([]);
          setConfirm(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] gap-5 overflow-y-auto sm:max-w-lg">
        <DialogHeader className="text-left">
          <DialogTitle className="truncate pr-6">Share “{prompt.title}”</DialogTitle>
          <DialogDescription>
            People you add can open this prompt. Changes save as you make them.
          </DialogDescription>
        </DialogHeader>

        {/* ── Add people or groups ─────────────────────────────────────── */}
        <section aria-label="Add people or groups" className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={pickerOpen}
                  className="h-9 min-w-0 flex-1 justify-between border-zinc-700 bg-zinc-800 font-normal text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                >
                  <span className="truncate">Add people or groups</span>
                  <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
                <Command>
                  <CommandInput placeholder="Search people and groups…" />
                  <CommandList>
                    {loading ? (
                      <div className="flex flex-col gap-2 p-3">
                        <Skeleton className="h-6 w-full" />
                        <Skeleton className="h-6 w-4/5" />
                        <Skeleton className="h-6 w-3/5" />
                      </div>
                    ) : error ? (
                      <p className="p-3 text-sm text-zinc-400">
                        Couldn’t load people.{' '}
                        <button
                          type="button"
                          onClick={() => refetch()}
                          className="text-zinc-200 underline underline-offset-2 hover:text-white"
                        >
                          Try again
                        </button>
                      </p>
                    ) : (
                      <>
                        <CommandEmpty>No one matches.</CommandEmpty>
                        {offerGroups.length > 0 && (
                          <CommandGroup heading="Groups">
                            {offerGroups.map(g => {
                              const t: Target = { kind: 'group', id: g.id };
                              return (
                                <CommandItem
                                  key={g.id}
                                  value={`group ${g.name}`}
                                  onSelect={() => toggleStaged(t)}
                                >
                                  <GroupTile className="size-6" />
                                  <span className="truncate">{g.name}</span>
                                  {stagedKeys.has(key(t)) && (
                                    <Check className="ml-auto size-4" aria-hidden />
                                  )}
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        )}
                        {offerUsers.length > 0 && (
                          <CommandGroup heading="People">
                            {offerUsers.map(u => {
                              const t: Target = { kind: 'user', id: u.uid };
                              return (
                                <CommandItem
                                  key={u.uid}
                                  value={`person ${u.displayName} ${u.workEmail}`}
                                  onSelect={() => toggleStaged(t)}
                                >
                                  <PersonAvatar user={u} className="size-6 text-[10px]" />
                                  <span className="truncate">{u.displayName}</span>
                                  {stagedKeys.has(key(t)) && (
                                    <Check className="ml-auto size-4" aria-hidden />
                                  )}
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        )}
                      </>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            <Select value={newRole} onValueChange={v => setNewRole(v as PromptRole)}>
              <SelectTrigger
                aria-label="Access for the people you add"
                className={selectTriggerClass}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <RoleItems />
              </SelectContent>
            </Select>

            <Button
              className="h-9"
              onClick={addStaged}
              disabled={staged.length === 0 || busy === 'add'}
            >
              {busy === 'add' ? 'Adding…' : 'Add'}
            </Button>
          </div>

          {staged.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Waiting to be added">
              {staged.map(t => (
                <li
                  key={key(t)}
                  className="flex items-center gap-1 rounded-full bg-white/[0.08] py-0.5 pl-2.5 pr-1 text-xs text-zinc-200"
                >
                  {stagedLabel(t)}
                  <button
                    type="button"
                    onClick={() => toggleStaged(t)}
                    aria-label={`Don’t add ${stagedLabel(t)}`}
                    className="rounded-full p-0.5 text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Who has access ───────────────────────────────────────────── */}
        <section aria-label="People with access" className="flex flex-col">
          <ul className="flex flex-col">
            {/* The organisation owns every prompt. Locked on purpose: it is not
                a grant, and nothing here can remove it. */}
            <li className={rowShell}>
              <GroupTile />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">Bluu Rock admins</p>
                <p className="text-xs text-zinc-400">Own every prompt</p>
              </div>
              <span className="pr-2 text-xs text-zinc-400">Owner</span>
            </li>

            {groupRows.map(row => {
              const t: Target = { kind: 'group', id: row.id };
              return (
                <GrantRow
                  key={key(t)}
                  avatar={<GroupTile />}
                  name={row.name}
                  grant={row.grant}
                  addedBy={usersById.get(row.grant.grantedBy)?.displayName}
                  busy={busy === key(t)}
                  onChange={next => changeRole(t, row.grant, next, row.name)}
                  className={rowShell}
                />
              );
            })}

            {userRows.map(row => {
              const t: Target = { kind: 'user', id: row.id };
              return (
                <GrantRow
                  key={key(t)}
                  avatar={
                    <PersonAvatar user={row.user ?? { displayName: '', photoURL: undefined }} />
                  }
                  name={row.id === myUid ? `${row.name} (you)` : row.name}
                  tag={row.gone ? 'Deactivated' : undefined}
                  grant={row.grant}
                  addedBy={usersById.get(row.grant.grantedBy)?.displayName}
                  removeOnly={row.gone}
                  busy={busy === key(t)}
                  onChange={next => changeRole(t, row.grant, next, row.name)}
                  className={rowShell}
                />
              );
            })}
          </ul>

          {groupRows.length + userRows.length === 0 && (
            <p className="px-2 pt-1 text-sm text-zinc-400">
              Not shared with anyone else yet. Add people or groups above.
            </p>
          )}
        </section>

        {confirm && (
          <div
            role="alertdialog"
            aria-label="Confirm"
            className={cn(
              'flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2.5',
              SURFACE
            )}
          >
            <p className="text-sm text-zinc-200">{confirm.message}</p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                Keep access
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  const run = confirm.run;
                  setConfirm(null);
                  run();
                }}
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {/* ── Public link: the existing /p/[shareId] page, one row of the model ── */}
        <section
          aria-label="Public link"
          className="flex flex-col gap-3 border-t border-white/[0.07] pt-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 gap-3">
              <Globe className="mt-0.5 size-4 shrink-0 text-zinc-400" aria-hidden />
              <div className="min-w-0">
                <label htmlFor="prompt-public-link" className="text-sm font-medium text-white">
                  Anyone with the link can view
                </label>
                <p className="text-xs text-zinc-400">
                  Opens in any browser without signing in. No names or edit history are included.
                </p>
              </div>
            </div>
            <Switch
              id="prompt-public-link"
              checked={Boolean(prompt.shareId)}
              onCheckedChange={togglePublic}
              disabled={linkBusy}
            />
          </div>

          {prompt.shareId && (
            <div className="flex items-center gap-2">
              <input
                readOnly
                aria-label="Public link"
                value={promptShareUrl(prompt.shareId)}
                onFocus={e => e.currentTarget.select()}
                className="h-8 min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-xs text-zinc-300 focus:border-zinc-500 focus:outline-none"
              />
              <Button variant="outline" size="sm" className="h-8" onClick={copyLink}>
                {linkCopied ? (
                  <Check className="size-3.5 text-green-400" aria-hidden />
                ) : (
                  <Copy className="size-3.5" aria-hidden />
                )}
                {linkCopied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}

function GrantRow({
  avatar,
  name,
  tag,
  grant,
  addedBy,
  busy,
  removeOnly,
  onChange,
  className,
}: {
  avatar: React.ReactNode;
  name: string;
  tag?: string;
  grant: PromptGrant;
  addedBy?: string;
  busy: boolean;
  /** A deactivated person: nothing to change but taking them off. */
  removeOnly?: boolean;
  onChange: (next: PromptRole | 'remove') => void;
  className?: string;
}) {
  return (
    <li className={cn(className, tag && 'opacity-80')}>
      {avatar}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-sm font-medium text-white">
          <span className="truncate">{name}</span>
          {tag && (
            <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-medium text-zinc-300">
              {tag}
            </span>
          )}
        </p>
        <p className="truncate text-xs text-zinc-400">
          {addedBy ? `Added by ${addedBy}` : 'Added'} · {relativeTime(grant.grantedAt)}
        </p>
      </div>
      {removeOnly ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs"
          disabled={busy}
          onClick={() => onChange('remove')}
        >
          Remove
        </Button>
      ) : (
        <Select
          value={grant.role}
          onValueChange={v => onChange(v as PromptRole | 'remove')}
          disabled={busy}
        >
          <SelectTrigger aria-label={`Access for ${name}`} className={selectTriggerClass}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <RoleItems />
            <SelectSeparator />
            <SelectItem value="remove" className="text-red-400 focus:text-red-400">
              Remove access
            </SelectItem>
          </SelectContent>
        </Select>
      )}
    </li>
  );
}
