'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { OptionMultiSelect, type MultiOption } from './OptionMultiSelect';
import type { ResourceDocument } from '@/types/resource';
import type { ResourcePayload } from '@/hooks/useAdminResources';

const STATUS_OPTIONS = ['Active', 'Unlisted'];

interface FormState {
  name: string;
  url: string;
  status: string;
  iconEmoji: string;
  groups: string[];
  types: string[];
  users: string[];
}

function toFormState(r?: ResourceDocument): FormState {
  return {
    name: r?.name ?? '',
    url: r?.url ?? '',
    status: r?.status ?? 'Active',
    iconEmoji: r?.icon?.type === 'emoji' ? r.icon.value : '',
    groups: r?.groups ?? [],
    types: r?.types ?? [],
    users: r?.users ?? [],
  };
}

export function ResourceFormDialog({
  open,
  onOpenChange,
  mode,
  resource,
  groupOptions,
  typeOptions,
  userOptions,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  resource?: ResourceDocument;
  groupOptions: MultiOption[];
  typeOptions: MultiOption[];
  userOptions: MultiOption[];
  onSubmit: (payload: ResourcePayload) => Promise<void>;
}) {
  const initial = useMemo(() => toFormState(resource), [resource]);
  const [form, setForm] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);

  // Reset the form whenever the dialog opens (or the target resource changes).
  useEffect(() => {
    if (open) setForm(toFormState(resource));
  }, [open, resource]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initial),
    [form, initial]
  );

  const nameValid = form.name.trim().length > 0;
  // Create: enabled once a name exists. Edit: enabled only after a change.
  const canSave = nameValid && (mode === 'create' ? true : dirty);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const url = form.url.trim().length > 0 ? form.url.trim() : null;
      const originalIcon = resource?.icon ?? null;
      const icon: ResourceDocument['icon'] = form.iconEmoji.trim()
        ? { type: 'emoji', value: form.iconEmoji.trim() }
        // Preserve a migrated image icon when the emoji field is left blank.
        : originalIcon?.type === 'url'
          ? originalIcon
          : null;

      await onSubmit({
        name: form.name.trim(),
        url,
        isNotionPage: url === null,
        // Keep the source page URL so page-references still resolve to a link.
        notionPageUrl: resource?.notionPageUrl || url || '',
        groups: form.groups,
        types: form.types,
        status: form.status,
        icon,
        users: form.users,
      });
      toast.success(mode === 'create' ? 'Resource created' : 'Resource updated');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New resource' : 'Edit resource'}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Add a new document to the resources collection.'
              : 'Update this resource. Leave the URL blank for a page reference.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_5rem] gap-3">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={form.name} onChange={e => set('name', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Icon</Label>
              <Input
                value={form.iconEmoji}
                onChange={e => set('iconEmoji', e.target.value)}
                placeholder="📄"
                className="text-center"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>URL</Label>
            <Input
              value={form.url}
              onChange={e => set('url', e.target.value)}
              placeholder="https://…"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={v => set('status', v)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Groups</Label>
            <OptionMultiSelect
              options={groupOptions}
              value={form.groups}
              onChange={v => set('groups', v)}
              placeholder="Select groups"
              className="w-full"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Types</Label>
            <OptionMultiSelect
              options={typeOptions}
              value={form.types}
              onChange={v => set('types', v)}
              placeholder="Select types"
              className="w-full"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Users</Label>
            <OptionMultiSelect
              options={userOptions}
              value={form.users}
              onChange={v => set('users', v)}
              placeholder="Grant access to specific users"
              emptyText="No users found."
              className="w-full"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
