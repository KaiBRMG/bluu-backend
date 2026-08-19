'use client';

import { Check } from 'lucide-react';
import { usePromptLibrary } from '@/contexts/PromptLibraryContext';
import { MAX_MODELS_PER_PROMPT, type LlmType } from '@/types/promptLibrary';
import { LlmMark } from './LlmMark';

/**
 * Multi-select over the managed model list.
 *
 * A prompt targets one or more models, so these are checkboxes in chip form
 * rather than a radio set — `aria-checked` on a `checkbox` role, so the
 * many-of-many semantics are announced rather than inferred from the fill.
 */
export function ModelPicker({
  value,
  onChange,
  describedBy,
}: {
  value: LlmType[];
  onChange: (next: LlmType[]) => void;
  describedBy?: string;
}) {
  const { models } = usePromptLibrary();
  const selected = new Set(value);

  const toggle = (id: LlmType) => {
    if (selected.has(id)) {
      onChange(value.filter(v => v !== id));
      return;
    }
    if (value.length >= MAX_MODELS_PER_PROMPT) return;
    onChange([...value, id]);
  };

  return (
    // `aria-invalid` is not supported on `group`, so the invalid state is
    // carried by the description the fieldset points at instead.
    <div role="group" aria-describedby={describedBy} className="flex flex-wrap gap-1.5">
      {models.map(model => {
        const on = selected.has(model.id);
        return (
          <button
            key={model.id}
            type="button"
            role="checkbox"
            aria-checked={on}
            onClick={() => toggle(model.id)}
            // Selection is carried by the fill, so a keyboard user needs a
            // separate ring to see WHERE they are as distinct from what is
            // chosen — without it, tabbing a dozen chips is invisible.
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6] active:scale-[0.98] ${
              on
                ? 'bg-[#2563eb] text-white'
                : 'bg-white/[0.04] text-zinc-300 hover:bg-white/[0.055] hover:text-white'
            }`}
          >
            <LlmMark llm={model.id} size={14} />
            {model.name}
            {on && <Check className="size-3" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
