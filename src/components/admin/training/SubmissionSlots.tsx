import type { TrainingPartDef } from '@/lib/training/modules';
import type { AdminSubmissionView } from '@/lib/training/types';
import { formatWhen } from './zonedTime';

interface SubmissionSlotsProps {
  part: TrainingPartDef;
  slots: AdminSubmissionView['slots'];
  sources: AdminSubmissionView['sources'];
  timezone: string;
}

/**
 * One attempt's work, laid out for comparison: for each level, the image they
 * started from beside what they handed in, with the upload time. Shared by the
 * single-part dialog on the session page and the all-sessions candidate panel,
 * so the two can never show the same work differently.
 */
export default function SubmissionSlots({ part, slots, sources, timezone }: SubmissionSlotsProps) {
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const bySlot = new Map(slots.map((s) => [s.slotId, s]));
  // Sources are lettered in the order the slots use them, as the candidate saw them lettered.
  const letters = new Map([...new Set(slots.map((s) => s.sourceId))].map((id, i) => [id, String.fromCharCode(65 + i)]));

  return (
    <ul className="flex flex-col gap-3">
      {part.task.slots.map((def) => {
        const slot = bySlot.get(def.id);
        const src = slot ? sourceById.get(slot.sourceId) : undefined;
        return (
          <li key={def.id} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium">{def.label}</p>
              <p className="text-[11px] text-zinc-400 tabular-nums">
                {slot ? `Uploaded ${formatWhen(slot.uploadedAtMs, timezone)}` : 'Nothing uploaded'}
              </p>
            </div>
            {slot && (
              <div className="grid grid-cols-2 gap-3">
                <figure>
                  {src && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={src.thumbUrl}
                      alt={`Source image ${letters.get(slot.sourceId)}`}
                      loading="lazy"
                      decoding="async"
                      className="aspect-square w-full rounded-lg object-cover"
                    />
                  )}
                  <figcaption className="mt-1 text-[11px] text-zinc-400">Started from image {letters.get(slot.sourceId)}</figcaption>
                </figure>
                <figure>
                  <a
                    href={slot.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={slot.url}
                      alt={`Their ${def.label} edit`}
                      loading="lazy"
                      decoding="async"
                      className="aspect-square w-full rounded-lg object-cover"
                    />
                  </a>
                  <figcaption className="mt-1 text-[11px] text-zinc-400 tabular-nums">
                    Their edit · {(slot.bytes / 1024 / 1024).toFixed(1)} MB · opens full size
                  </figcaption>
                </figure>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
