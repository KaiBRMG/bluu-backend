'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
import { LLM_LIST, type LlmType, type PromptDocument } from '@/types/promptLibrary';
import { CategoryPicker, TagPicker } from './LabelPicker';
import { FieldError } from './FieldError';
import { LlmMark } from './LlmMark';

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
  const router = useRouter();
  const { taxonomy, updateMeta, addLabels } = usePromptLibrary();

  const [llmType, setLlmType] = useState<LlmType>(prompt.llmType);
  const [title, setTitle] = useState(prompt.title);
  const [category, setCategory] = useState(prompt.category);
  const [tags, setTags] = useState<string[]>(prompt.tags);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ title?: string; category?: string }>({});

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    const found: typeof errors = {};
    if (!title.trim()) found.title = 'Give the prompt a title.';
    if (!category.trim()) found.category = 'Choose or create a category.';
    setErrors(found);

    const firstInvalid = (['title', 'category'] as const).find(k => found[k]);
    if (firstInvalid) {
      document.getElementById(`edit-${firstInvalid}`)?.focus();
      return;
    }

    setSaving(true);
    try {
      const next = await updateMeta(prompt.id, { llmType, title, category, tags });
      toast.success('Prompt updated');
      onOpenChange(false);
      // Moving a prompt to another model changes its URL.
      if (next.llmType !== prompt.llmType) {
        router.replace(`/applications/apps-prompt-library/${next.llmType}/${next.id}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update the prompt');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-xs text-zinc-400">Model</legend>
        <div className="flex flex-wrap gap-1.5">
          {LLM_LIST.map(llm => {
            const selected = llm.id === llmType;
            return (
              <button
                key={llm.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setLlmType(llm.id)}
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-all active:scale-[0.98] ${
                  selected
                    ? 'bg-[#2563eb] text-white'
                    : 'bg-white/[0.04] text-zinc-300 hover:bg-white/[0.055] hover:text-white'
                }`}
              >
                <LlmMark llm={llm.id} size={14} />
                {llm.name}
              </button>
            );
          })}
        </div>
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
