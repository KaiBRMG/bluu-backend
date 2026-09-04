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
import { hasRichFormatting, htmlToPlainText } from '@/lib/promptHtml';
import { type LlmType } from '@/types/promptLibrary';
import { CategoryPicker, TagPicker } from './LabelPicker';
import { FieldError } from './FieldError';
import { ModelPicker } from './ModelPicker';
import { RichPromptEditor } from './RichPromptEditor';
import { wordCount } from '../_lib/format';

const inputClass =
  'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white transition-colors placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none';

export function NewPromptDialog({
  open,
  onOpenChange,
  defaultLlm,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultLlm?: LlmType;
  /** Hands the new prompt's id back so the caller can open its detail card. */
  onCreated?: (id: string) => void;
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
        {open && (
          <NewPromptForm
            onOpenChange={onOpenChange}
            defaultLlm={defaultLlm}
            onCreated={onCreated}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function NewPromptForm({
  onOpenChange,
  defaultLlm,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  defaultLlm?: LlmType;
  onCreated?: (id: string) => void;
}) {
  const { taxonomy, models, createPrompt, addLabels } = usePromptLibrary();

  const [llmTypes, setLlmTypes] = useState<LlmType[]>(
    defaultLlm ? [defaultLlm] : models[0] ? [models[0].id] : []
  );
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  /**
   * The body in storage form — the same representation the detail card edits,
   * so a prompt can be written with formatting from the first version rather
   * than having to be created plain and then marked up in a second save.
   */
  const [bodyHtml, setBodyHtml] = useState('');
  const [saving, setSaving] = useState(false);
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const [errors, setErrors] = useState<{
    models?: string;
    title?: string;
    category?: string;
    text?: string;
  }>({});

  // `text` is derived from the markup, never typed separately — the same rule
  // the server enforces in `resolveBody`, so the two cannot disagree about what
  // the prompt says.
  const text = htmlToPlainText(bodyHtml);

  // The submit button stays enabled and the form answers on submit. A disabled
  // button that never says which field is missing is a dead end — especially
  // once the prompt body has scrolled out of sight.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    const found: typeof errors = {};
    if (llmTypes.length === 0) found.models = 'Pick at least one model.';
    if (!title.trim()) found.title = 'Give the prompt a title.';
    if (!category.trim()) found.category = 'Choose or create a category.';
    if (!text.trim()) found.text = 'Write the prompt text.';
    setErrors(found);

    const firstInvalid = (['models', 'title', 'category', 'text'] as const).find(k => found[k]);
    if (firstInvalid) {
      document
        .getElementById(firstInvalid === 'text' ? 'prompt-text' : `prompt-${firstInvalid}`)
        ?.focus();
      return;
    }

    setSaving(true);
    try {
      const prompt = await createPrompt({
        llmTypes,
        category,
        title,
        tags,
        text,
        // Plain prompts stay plain in Firestore — `textHtml` is only written
        // once a mark has actually been applied.
        textHtml: hasRichFormatting(bodyHtml) ? bodyHtml : null,
      });
      toast.success('Prompt created');
      onOpenChange(false);
      onCreated?.(prompt.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create the prompt');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
      {/* `tabIndex={-1}` is what makes the focus-first-invalid recovery work at
          all: a <fieldset> is not focusable by default, so `.focus()` on it was
          a silent no-op and the first field in the form was the one field the
          error recovery could never reach. The description rides the fieldset
          too, so focusing the group announces WHY it was focused. */}
      <fieldset
        id="prompt-models"
        tabIndex={-1}
        aria-describedby={errors.models ? 'prompt-models-error' : undefined}
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
          describedBy={errors.models ? 'prompt-models-error' : undefined}
        />
        <FieldError id="prompt-models-error" message={errors.models} />
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
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <label htmlFor="prompt-text" className="text-xs text-zinc-400">
            Prompt
          </label>
          <div className="flex items-center gap-3">
            {/* The editor portals its formatting toolbar in here, so the marks
                sit on the field's own label row rather than hovering above the
                text. A state ref, not a plain one: the editor needs a re-render
                once the node exists. */}
            <div ref={setToolbarHost} className="flex items-center" />
            <span className="text-[11px] tabular-nums text-zinc-400">{wordCount(text)} words</span>
          </div>
        </div>
        {/* The same editor the detail card uses, so formatting is available at
            creation and not only on the second save. */}
        <RichPromptEditor
          id="prompt-text"
          initialHtml=""
          onChange={html => {
            setBodyHtml(html);
            if (errors.text) setErrors(prev => ({ ...prev, text: undefined }));
          }}
          ariaLabel="Prompt text"
          placeholder="Write the prompt exactly as it should be pasted into the model…"
          toolbarHost={toolbarHost}
          invalid={Boolean(errors.text)}
          describedBy={errors.text ? 'prompt-text-error' : undefined}
          // Shorter than the detail card's, because this dialog carries four
          // other fields above it — and on the same `bg-zinc-800` surface as
          // every one of them, so the body reads as a field of this form rather
          // than as a panel that wandered in from the detail card.
          bodyClassName="min-h-56 border-zinc-700 bg-zinc-800"
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
