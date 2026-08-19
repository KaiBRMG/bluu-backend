'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { usePromptLibrary } from '@/contexts/PromptLibraryContext';
import { toModelId } from '@/types/promptLibrary';
import { FieldError } from './FieldError';

const inputClass =
  'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white transition-colors placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none';

/**
 * Coins a new model type.
 *
 * Nothing else is asked for. The id is derived from the name, and the icon is
 * resolved at render time from that id — dropping
 * `public/prompt-library-llm-logos/<id>.png` into the repo is the whole of
 * "adding the logo", with no second form and no upload path to secure.
 */
export function AddModelDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a model type</DialogTitle>
          {/* The mechanics of the icon are deliberately not explained here —
              adding a model is a one-field job and the description made it read
              like a two-step one. See prompt-library.md for how icons resolve. */}
          <DialogDescription className="sr-only">
            Name a new model type for the prompt library.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so each open starts from a clean form. */}
        {open && <AddModelForm onOpenChange={onOpenChange} />}
      </DialogContent>
    </Dialog>
  );
}

function AddModelForm({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { models, addLabels } = usePromptLibrary();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const id = toModelId(name);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    if (!name.trim()) {
      setError('Give the model a name.');
      document.getElementById('model-name')?.focus();
      return;
    }
    if (!id) {
      setError('The name needs at least one letter or number.');
      return;
    }
    if (models.some(m => m.id === id)) {
      setError(`“${models.find(m => m.id === id)?.name}” already exists.`);
      return;
    }

    setSaving(true);
    try {
      await addLabels({ models: [{ id, name: name.trim() }] });
      toast.success(`${name.trim()} added`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add the model');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="model-name" className="text-xs text-zinc-400">
          Model name
        </label>
        <input
          id="model-name"
          value={name}
          onChange={e => {
            setName(e.target.value);
            if (error) setError(undefined);
          }}
          placeholder="Midjourney"
          maxLength={48}
          autoFocus
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'model-name-error' : undefined}
          className={`${inputClass} ${error ? 'border-red-500' : ''}`}
        />
        <FieldError id="model-name-error" message={error} />
      </div>

      <div className="mt-1 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Adding…' : 'Add model'}
        </Button>
      </div>
    </form>
  );
}
