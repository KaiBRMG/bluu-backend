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
import { Textarea } from '@/components/ui/textarea';
import { usePromptLibrary } from '@/contexts/PromptLibraryContext';
import { LLM_LIST, type LlmType } from '@/types/promptLibrary';
import { CategoryPicker, TagPicker } from './LabelPicker';
import { FieldError } from './FieldError';
import { LlmMark } from './LlmMark';
import { wordCount } from '../_lib/format';

const inputClass =
  'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white transition-colors placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none';

export function NewPromptDialog({
  open,
  onOpenChange,
  defaultLlm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultLlm?: LlmType;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New prompt</DialogTitle>
          <DialogDescription>
            Saved as version 1. Every later edit is kept as its own version.
          </DialogDescription>
        </DialogHeader>
        {/* The form lives inside the dialog content, so closing unmounts it and
            the next open starts clean — no reset effect to keep in sync. */}
        {open && <NewPromptForm onOpenChange={onOpenChange} defaultLlm={defaultLlm} />}
      </DialogContent>
    </Dialog>
  );
}

function NewPromptForm({
  onOpenChange,
  defaultLlm,
}: {
  onOpenChange: (open: boolean) => void;
  defaultLlm?: LlmType;
}) {
  const router = useRouter();
  const { taxonomy, createPrompt, addLabels } = usePromptLibrary();

  const [llmType, setLlmType] = useState<LlmType>(defaultLlm ?? 'chatgpt');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ title?: string; category?: string; text?: string }>({});

  // The submit button stays enabled and the form answers on submit. A disabled
  // button that never says which field is missing is a dead end — especially
  // once the prompt body has scrolled out of sight.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    const found: typeof errors = {};
    if (!title.trim()) found.title = 'Give the prompt a title.';
    if (!category.trim()) found.category = 'Choose or create a category.';
    if (!text.trim()) found.text = 'Write the prompt text.';
    setErrors(found);

    const firstInvalid = (['title', 'category', 'text'] as const).find(k => found[k]);
    if (firstInvalid) {
      document
        .getElementById(firstInvalid === 'text' ? 'prompt-text' : `prompt-${firstInvalid}`)
        ?.focus();
      return;
    }

    setSaving(true);
    try {
      const prompt = await createPrompt({
        llmType,
        category,
        title,
        tags,
        text,
      });
      toast.success('Prompt created');
      onOpenChange(false);
      router.push(`/applications/apps-prompt-library/${prompt.llmType}/${prompt.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create the prompt');
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
        <label htmlFor="prompt-title" className="text-xs text-zinc-400">
          Title
        </label>
        <input
          id="prompt-title"
          value={title}
          onChange={e => {
            setTitle(e.target.value);
            if (errors.title) setErrors(prev => ({ ...prev, title: undefined }));
          }}
          placeholder="Cinematic product shot"
          maxLength={160}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? 'prompt-title-error' : undefined}
          className={`${inputClass} ${errors.title ? 'border-red-500' : ''}`}
        />
        <FieldError id="prompt-title-error" message={errors.title} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="prompt-category" className="text-xs text-zinc-400">
            Category
          </label>
          <CategoryPicker
            id="prompt-category"
            options={taxonomy.categories}
            value={category}
            onChange={next => {
              setCategory(next);
              if (errors.category) setErrors(prev => ({ ...prev, category: undefined }));
            }}
            onCreate={label => addLabels({ categories: [label] })}
            invalid={Boolean(errors.category)}
            describedBy={errors.category ? 'prompt-category-error' : undefined}
          />
          <FieldError id="prompt-category-error" message={errors.category} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="prompt-tags" className="text-xs text-zinc-400">
            Tags <span className="text-zinc-400">(optional)</span>
          </label>
          <TagPicker
            id="prompt-tags"
            options={taxonomy.tags}
            value={tags}
            onChange={setTags}
            onCreate={label => addLabels({ tags: [label] })}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <label htmlFor="prompt-text" className="text-xs text-zinc-400">
            Prompt
          </label>
          <span className="text-[11px] tabular-nums text-zinc-400">{wordCount(text)} words</span>
        </div>
        <Textarea
          id="prompt-text"
          value={text}
          onChange={e => {
            setText(e.target.value);
            if (errors.text) setErrors(prev => ({ ...prev, text: undefined }));
          }}
          rows={12}
          placeholder="Write the prompt exactly as it should be pasted into the model…"
          aria-invalid={errors.text ? true : undefined}
          aria-describedby={errors.text ? 'prompt-text-error' : undefined}
          className={`min-h-56 resize-y whitespace-pre-wrap bg-zinc-800 font-mono text-sm leading-relaxed text-white placeholder:text-zinc-400 focus-visible:border-zinc-500 ${
            errors.text ? 'border-red-500' : 'border-zinc-700'
          }`}
        />
        <FieldError id="prompt-text-error" message={errors.text} />
      </div>

      <div className="mt-1 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Creating…' : 'Create prompt'}
        </Button>
      </div>
    </form>
  );
}
