import { NOT_COUNTED_INK, SEGMENT_COLOR, type SegmentKind } from '@/lib/timesheet/daySegments';

/** The legend mark for a segment kind: its state hue, or the grey hatch for not counted. */
export function SegmentSwatch({ kind }: { kind: SegmentKind }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-2 shrink-0 rounded-full"
      style={{
        background: kind === 'not-counted'
          ? `repeating-linear-gradient(135deg, ${NOT_COUNTED_INK} 0 2px, transparent 2px 4px)`
          : SEGMENT_COLOR[kind],
        boxShadow: kind === 'not-counted' ? `inset 0 0 0 1px ${NOT_COUNTED_INK}` : undefined,
      }}
    />
  );
}
