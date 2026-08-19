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
import { type LlmType, type PromptDocument } from '@/types/promptLibrary';
import { CategoryPicker, TagPicker } from './LabelPicker';
import { FieldError } from './FieldError';
import { ModelPicker } from './ModelPicker';

const inputClass =
  'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white transition-colors placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none';

/**
 * Edits everything ABOUT a prompt — never its text. Text changes go through the
 * versioned editor, so retitling or retagging does not manufacture a version
 * that says nothing changed.
 */
export function EditMetaDialog({
  prompt,
  open,
  onOpenChange,
}: {
  prompt: PromptDocument;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Prompt details</DialogTitle>
          <DialogDescription>
            Changes here don’t create a version — only edits to the prompt text do.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so each open seeds fresh from the prompt
            rather than needing an effect to re-sync the fields. */}
        {open && <EditMetaForm prompt={prompt} onOpenChange={onOpenChange} />}
      </DialogContent>
    </Dialog>
  );
}

function EditMetaForm({
  prompt,
  onOpenChange,
}: {
  prompt: PromptDocument;
  onOpenChange: (open: boolean) => void;
}) {
  const { taxonomy, updateMeta, addLabels } = usePromptLibrary();

  const [llmTypes, setLlmTypes] = useState<LlmType[]>(prompt.llmTypes);
  const [title, setTitle] = useState(prompt.title);
  const [category, setCategory] = useState(prompt.category);
  const [tags, setTags] = useState<string[]>(prompt.tags);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ models?: string; title?: string; category?: string }>({});

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    const found: typeof errors = {};
    if (llmTypes.length === 0) found.models = 'Pick at least one model.';
    if (!title.trim()) found.title = 'Give the prompt a title.';
    if (!category.trim()) found.category = 'Choose or create a category.';
    setErrors(found);

    const firstInvalid = (['models', 'title', 'category'] as const).find(k => found[k]);
    if (firstInvalid) {
      document.getElementById(`edit-${firstInvalid}`)?.focus();
      return;
    }

    setSaving(true);
    try {
      await updateMeta(prompt.id, { llmTypes, title, category, tags });
      toast.success('Prompt updated');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update the prompt');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
      {/* Focusable only so the focus-first-invalid recovery can reach it — a
          bare <fieldset> is not, so `.focus()` here used to do nothing. */}
      <fieldset
        id="edit-models"
        tabIndex={-1}
        aria-describedby={errors.models ? 'edit-models-error' : undefined}
        className="flex flex-col gap-1.5 focus:outline-none"
      >
        <legend className="mb-1.5 text-xs text-zinc-400">
          Models <span className="text-zinc-400">(pick one or more)</span>
        </legend>
        <ModelPicker
          value={llmTypes}
          onChange={next => {
            setLlmTypes(next);
            if (errors.models) setErrors(prev => ({ ...prev, models: undefined }));
          }}
          describedBy={errors.models ? 'edit-models-error' : undefined}
        />
        <FieldError id="edit-models-error" message={errors.models} />
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="edit-title" className="text-xs text-zinc-400">
          Title
        </label>
        <input
          id="edit-title"
          value={title}
          onChange={e => {
            setTitle(e.target.value);
            if (errors.title) setErrors(prev => ({ ...prev, title: undefined }));
          }}
          maxLength={160}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? 'edit-title-error' : undefined}
          className={`${inputClass} ${errors.title ? 'border-red-500' : ''}`}
        />
        <FieldError id="edit-title-error" message={errors.title} />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="edit-category" className="text-xs text-zinc-400">
          Category
        </label>
        <CategoryPicker
          id="edit-category"
          options={taxonomy.categories}
          value={category}
          onChange={next => {
            setCategory(next);
            if (errors.category) setErrors(prev => ({ ...prev, category: undefined }));
          }}
          onCreate={label => addLabels({ categories: [label] })}
          invalid={Boolean(errors.category)}
          describedBy={errors.category ? 'edit-category-error' : undefined}
        />
        <FieldError id="edit-category-error" message={errors.category} />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="edit-tags" className="text-xs text-zinc-400">
          Tags
        </label>
        <TagPicker
          id="edit-tags"
          options={taxonomy.tags}
          value={tags}
          onChange={setTags}
          onCreate={label => addLabels({ tags: [label] })}
        />
      </div>

      <div className="mt-1 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save details'}
        </Button>
      </div>
    </form>
  );
}
