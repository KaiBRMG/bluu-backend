'use client';

import { IconCheck } from '@tabler/icons-react';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { MULTI_SEP, isRequired, maxLength, type Answers, type Question } from '@/lib/creatorOnboarding';
import { cn } from '@/lib/utils';
import { Field } from '@/app/model-submissions/_components/Field';
import { AZURE, FIELD } from '@/app/model-submissions/_lib/theme';

/** Selected choice chip: azure edge + tint + a check — three cues, never hue alone. */
const CHIP_BASE =
  'flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-base font-medium transition-colors';
const CHIP_ON = 'border-[#00b8f5] bg-[#00b8f5]/10 text-white';
const CHIP_OFF = 'border-white/[0.10] bg-white/[0.03] text-white/80 hover:bg-white/[0.06]';

interface QuestionFieldProps {
  q: Question;
  answers: Answers;
  error?: string;
  onChange: (id: string, value: string) => void;
}

/** Latest date that makes someone 18 today — the date picker's ceiling. */
function adultCeiling(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return d.toISOString().slice(0, 10);
}

/**
 * One question, rendered from its declaration in `lib/creatorOnboarding.ts`.
 *
 * Wraps the application form's own `Field`, so label / hint / error wiring and
 * the "Optional" marker are identical across both public forms. A prefilled
 * answer says where it came from in the hint, so a creator knows why a box is
 * already full and that it is theirs to correct.
 */
export function QuestionField({ q, answers, error, onChange }: QuestionFieldProps) {
  const value = answers[q.id] ?? '';
  const optional = !isRequired(q, answers);
  const hint = [q.help, q.prefilled && value ? 'From your application — change it if it’s out of date.' : null]
    .filter(Boolean)
    .join(' ');

  const set = (v: string) => onChange(q.id, v);

  if (q.kind === 'choice') {
    return (
      <Field label={q.label} hint={hint || undefined} optional={optional} error={error} group>
        {(a) => (
          <RadioGroup
            aria-invalid={a['aria-invalid']}
            aria-describedby={a['aria-describedby']}
            value={value}
            onValueChange={set}
            className={cn('grid gap-2.5', (q.options?.length ?? 0) > 3 ? 'sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3')}
          >
            {q.options?.map((o) => (
              <Label key={o.value} htmlFor={`${a.id}-${o.value}`} className={cn(CHIP_BASE, value === o.value ? CHIP_ON : CHIP_OFF)}>
                <RadioGroupItem id={`${a.id}-${o.value}`} value={o.value} />
                {o.label}
              </Label>
            ))}
          </RadioGroup>
        )}
      </Field>
    );
  }

  if (q.kind === 'multi') {
    const selected = value ? value.split(MULTI_SEP) : [];
    const toggle = (v: string) => {
      const next = selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v];
      // Keep the declared order, so the stored string reads the same however it was tapped.
      const order = q.options?.map((o) => o.value) ?? [];
      set(order.filter((o) => next.includes(o)).join(MULTI_SEP));
    };
    return (
      <Field label={q.label} hint={hint || 'Choose all that apply.'} optional={optional} error={error} group>
        {(a) => (
          <div className="flex flex-wrap gap-2" aria-describedby={a['aria-describedby']}>
            {q.options?.map((o) => {
              const on = selected.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(o.value)}
                  className={cn(
                    'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-base font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#00b8f5]/40',
                    on ? CHIP_ON : CHIP_OFF,
                  )}
                >
                  {on && <IconCheck className="size-4" style={{ color: AZURE }} aria-hidden />}
                  {o.label}
                </button>
              );
            })}
          </div>
        )}
      </Field>
    );
  }

  if (q.kind === 'textarea') {
    return (
      <Field label={q.label} hint={hint || undefined} optional={optional} error={error}>
        {(a) => (
          <Textarea
            {...a}
            rows={q.id === 'socials' ? 4 : 3}
            maxLength={maxLength(q)}
            placeholder={q.placeholder}
            className={cn(FIELD, 'min-h-24 resize-y')}
            value={value}
            onChange={(e) => set(e.target.value)}
          />
        )}
      </Field>
    );
  }

  const inputType = q.kind === 'date' ? 'date' : 'text';
  const inputMode =
    q.kind === 'number' ? 'numeric' : q.kind === 'money' ? 'decimal' : q.id.toLowerCase().includes('link') ? 'url' : undefined;

  return (
    <Field label={q.label} hint={hint || undefined} optional={optional} error={error}>
      {(a) => (
        <div className="flex items-stretch">
          {q.prefix && (
            <span
              aria-hidden
              className="grid shrink-0 place-items-center rounded-l-xl border border-r-0 border-white/[0.10] bg-white/[0.06] px-3.5 text-base text-white/60"
            >
              {q.prefix}
            </span>
          )}
          <input
            {...a}
            type={inputType}
            inputMode={inputMode}
            max={q.kind === 'date' ? adultCeiling() : undefined}
            maxLength={maxLength(q)}
            placeholder={q.placeholder}
            autoCapitalize={q.kind === 'handle' || inputMode === 'url' ? 'none' : undefined}
            autoCorrect={q.kind === 'handle' || inputMode === 'url' ? 'off' : undefined}
            spellCheck={q.kind === 'handle' ? false : undefined}
            className={cn(
              FIELD,
              'min-w-0 flex-1',
              q.prefix && 'rounded-l-none',
              q.suffix && 'rounded-r-none',
              (q.kind === 'number' || q.kind === 'money' || q.kind === 'date') && 'tabular-nums',
              q.kind === 'date' && '[color-scheme:dark]',
            )}
            value={value}
            onChange={(e) => {
              let v = e.target.value;
              if (q.kind === 'number') v = v.replace(/[^\d.]/g, '');
              if (q.kind === 'money') v = v.replace(/[^\d.,]/g, '');
              if (q.kind === 'handle') v = v.replace(/^@+/, '').replace(/\s/g, '');
              set(v);
            }}
          />
          {q.suffix && (
            <span
              aria-hidden
              className="grid shrink-0 place-items-center rounded-r-xl border border-l-0 border-white/[0.10] bg-white/[0.06] px-3.5 text-sm whitespace-nowrap text-white/60"
            >
              {q.suffix}
            </span>
          )}
        </div>
      )}
    </Field>
  );
}

