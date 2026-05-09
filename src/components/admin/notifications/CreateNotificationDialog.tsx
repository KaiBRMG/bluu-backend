'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Check, ChevronDown, X, Users, Layers, Link, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from '@/components/ui/command';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { PAGES } from '@/lib/definitions';
import type { BasicUser } from '@/hooks/useBasicUsers';
import type { AdminGroup } from '@/hooks/useAdminUsers';
import type { NotificationType } from '@/types/firestore';
import type { CreateBatchPayload } from '@/hooks/useAdminNotifications';

type ActionUrlMode = 'none' | 'internal' | 'external';

const INTERNAL_PAGES = PAGES.filter(p => p.href !== null);

interface CreateNotificationDialogProps {
  users: BasicUser[];
  groups: AdminGroup[];
  onCreated: () => void;
  onCreate: (payload: CreateBatchPayload) => Promise<string>;
}

type RecipientType = 'user' | 'group';
interface Recipient {
  id: string;
  type: RecipientType;
  label: string;
}

const NOTIFICATION_TYPES: { value: NotificationType; label: string; color: string; ring: string }[] = [
  { value: 'shift',   label: 'Shift',   color: 'bg-blue-500',   ring: 'ring-blue-500' },
  { value: 'alert',   label: 'Alert',   color: 'bg-red-500',    ring: 'ring-red-500' },
  { value: 'success', label: 'Success', color: 'bg-green-500',  ring: 'ring-green-500' },
  { value: 'action',  label: 'Action',  color: 'bg-amber-500',  ring: 'ring-amber-500' },
];

export default function CreateNotificationDialog({
  users,
  groups,
  onCreated,
  onCreate,
}: CreateNotificationDialogProps) {
  const [open, setOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState<NotificationType>('shift');
  const [actionUrlMode, setActionUrlMode] = useState<ActionUrlMode>('none');
  const [internalPage, setInternalPage] = useState('');
  const [externalUrl, setExternalUrl] = useState('');

  function resetForm() {
    setRecipients([]);
    setTitle('');
    setMessage('');
    setType('shift');
    setActionUrlMode('none');
    setInternalPage('');
    setExternalUrl('');
  }

  function resolvedActionUrl(): string | null {
    if (actionUrlMode === 'internal') return internalPage || null;
    if (actionUrlMode === 'external') return externalUrl.trim() || null;
    return null;
  }

  function toggleRecipient(recipient: Recipient) {
    setRecipients(prev => {
      const exists = prev.some(r => r.id === recipient.id && r.type === recipient.type);
      return exists
        ? prev.filter(r => !(r.id === recipient.id && r.type === recipient.type))
        : [...prev, recipient];
    });
  }

  function removeRecipient(id: string, recipientType: RecipientType) {
    setRecipients(prev => prev.filter(r => !(r.id === id && r.type === recipientType)));
  }

  function isSelected(id: string, recipientType: RecipientType) {
    return recipients.some(r => r.id === id && r.type === recipientType);
  }

  async function handleSubmit() {
    if (!title.trim() || !message.trim() || recipients.length === 0) return;

    const userIds = recipients.filter(r => r.type === 'user').map(r => r.id);
    const groupIds = recipients.filter(r => r.type === 'group').map(r => r.id);

    setSubmitting(true);
    try {
      await onCreate({ title: title.trim(), message: message.trim(), type, userIds, groupIds, actionUrl: resolvedActionUrl() });
      toast.success('Notification sent successfully');
      resetForm();
      setOpen(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send notification');
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = title.trim().length > 0 && message.trim().length > 0 && recipients.length > 0;

  return (
    <>
      <Button onClick={() => setOpen(true)}>Create new notification</Button>

      <Dialog open={open} onOpenChange={open => { setOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Notification</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Recipients */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Recipients</label>
              <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal"
                  >
                    {recipients.length === 0
                      ? 'Select users or groups…'
                      : `${recipients.length} selected`}
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[420px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search users or groups…" />
                    <CommandList>
                      <CommandEmpty>No results found.</CommandEmpty>

                      {groups.length > 0 && (
                        <CommandGroup heading="Groups">
                          {groups.map(group => (
                            <CommandItem
                              key={group.id}
                              value={`group-${group.id}-${group.name}`}
                              onSelect={() =>
                                toggleRecipient({ id: group.id, type: 'group', label: group.name })
                              }
                            >
                              <Layers className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                              <span className="flex-1">{group.name}</span>
                              <span className="text-xs text-muted-foreground mr-2">
                                {group.members.length} member{group.members.length !== 1 ? 's' : ''}
                              </span>
                              <Check
                                className={cn(
                                  'h-4 w-4',
                                  isSelected(group.id, 'group') ? 'opacity-100' : 'opacity-0'
                                )}
                              />
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}

                      <CommandSeparator />

                      <CommandGroup heading="Users">
                        {users.map(user => (
                          <CommandItem
                            key={user.uid}
                            value={`user-${user.uid}-${user.displayName}-${user.workEmail}`}
                            onSelect={() =>
                              toggleRecipient({
                                id: user.uid,
                                type: 'user',
                                label: user.displayName,
                              })
                            }
                          >
                            <Users className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                            <span className="flex-1">{user.displayName}</span>
                            <span className="text-xs text-muted-foreground mr-2">
                              {user.workEmail}
                            </span>
                            <Check
                              className={cn(
                                'h-4 w-4',
                                isSelected(user.uid, 'user') ? 'opacity-100' : 'opacity-0'
                              )}
                            />
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              {/* Selected recipient chips */}
              {recipients.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {recipients.map(r => (
                    <Badge
                      key={`${r.type}-${r.id}`}
                      variant="secondary"
                      className="gap-1 pr-1"
                    >
                      {r.type === 'group' ? (
                        <Layers className="h-3 w-3" />
                      ) : (
                        <Users className="h-3 w-3" />
                      )}
                      {r.label}
                      <button
                        onClick={() => removeRecipient(r.id, r.type)}
                        className="ml-0.5 rounded-full opacity-60 hover:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Title */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Title</label>
              <Input
                placeholder="Notification title"
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
            </div>

            {/* Message */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Message</label>
              <Textarea
                placeholder="Notification message"
                rows={3}
                value={message}
                onChange={e => setMessage(e.target.value)}
              />
            </div>

            {/* Action URL */}
            <div className="space-y-2">
              <label className="text-sm font-medium">On-click action</label>
              <div className="flex rounded-md border overflow-hidden">
                {(['none', 'internal', 'external'] as ActionUrlMode[]).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setActionUrlMode(mode)}
                    className={cn(
                      'flex-1 py-1.5 text-xs font-medium transition-colors',
                      actionUrlMode === mode
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-transparent text-muted-foreground hover:bg-accent'
                    )}
                  >
                    {mode === 'none' && 'None'}
                    {mode === 'internal' && 'App page'}
                    {mode === 'external' && 'External URL'}
                  </button>
                ))}
              </div>

              {actionUrlMode === 'internal' && (
                <Select value={internalPage} onValueChange={setInternalPage}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a page…" />
                  </SelectTrigger>
                  <SelectContent>
                    {INTERNAL_PAGES.map(page => (
                      <SelectItem key={page.pageId} value={page.href!}>
                        <span className="flex items-center gap-2">
                          <Link className="h-3.5 w-3.5 text-muted-foreground" />
                          {page.title}
                          <span className="text-xs text-muted-foreground">{page.href}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {actionUrlMode === 'external' && (
                <div className="relative">
                  <ExternalLink className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="https://example.com"
                    value={externalUrl}
                    onChange={e => setExternalUrl(e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Type */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Type</label>
              <div className="grid grid-cols-4 gap-2">
                {NOTIFICATION_TYPES.map(t => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setType(t.value)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-lg border p-3 text-sm transition-colors',
                      type === t.value
                        ? `border-transparent ring-2 ${t.ring}`
                        : 'border-border hover:bg-accent'
                    )}
                  >
                    <span className={cn('h-3 w-3 rounded-full', t.color)} />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setOpen(false); resetForm(); }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit || submitting}>
              {submitting ? 'Sending…' : 'Send notification'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
