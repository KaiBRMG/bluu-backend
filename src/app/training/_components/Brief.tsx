import { DATASETS, type BriefBlock, type BriefDef, type BriefSection, type TestDef } from '@/lib/training/modules';
import { cn } from '@/lib/utils';

/**
 * Renders the copy in `modules.ts`. A block that the code also knows — the
 * which identity goes with which source, a correction — is
 * rendered from the test's slots, so the words cannot disagree with the mechanics.
 */
function Block({ block, test, compact }: { block: BriefBlock; test: Pick<TestDef, 'slots'>; compact?: boolean }) {
  if (typeof block === 'string') return <p>{block}</p>;
  if (Array.isArray(block)) {
    return (
      <ul className="list-disc space-y-1.5 pl-5">
        {block.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }
  if ('assignments' in block) {
    return (
      <ul className="list-disc space-y-1 pl-5 tabular-nums">
        {test.slots
          .filter((s) => s.identity)
          .map((s) => (
            <li key={s.id}>
              {s.code} — {DATASETS[s.identity!].label}
            </li>
          ))}
      </ul>
    );
  }
  if (compact) return <p className="text-white/70">The correction for each image is shown beside it.</p>;
  return (
    <ul className="space-y-4">
      {test.slots.map((s) => (
        <li key={s.id}>
          <p className="font-medium text-white">
            Image {s.code} — {s.correction?.title}
          </p>
          <div className="mt-1 space-y-1.5">
            {s.correction?.body.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Blocks({ blocks, test, compact }: { blocks: BriefBlock[]; test: Pick<TestDef, 'slots'>; compact?: boolean }) {
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => (
        <Block key={i} block={b} test={test} compact={compact} />
      ))}
    </div>
  );
}

/** The heading level a brief's top sections take; a sub-section is one below. */
type Level = 2 | 3;

function Section({
  section,
  test,
  compact,
  level,
}: {
  section: BriefSection;
  test: Pick<TestDef, 'slots'>;
  compact?: boolean;
  level: Level;
}) {
  const H = section.sub ? (`h${level + 1}` as 'h3' | 'h4') : (`h${level}` as 'h2' | 'h3');
  return (
    <section className={section.sub ? 'mt-5' : 'mt-8'}>
      <H className={cn('font-semibold text-white', section.sub ? 'text-base' : 'text-lg')}>{section.heading}</H>
      {section.body.length > 0 && (
        <div className="mt-2">
          <Blocks blocks={section.body} test={test} compact={compact} />
        </div>
      )}
    </section>
  );
}

/** A test's full brief. `level` is the heading level of its sections: one below whatever heads the place it sits in. */
export function BriefView({
  test,
  brief = test.brief,
  compact,
  level = 3,
}: {
  test: TestDef;
  brief?: BriefDef;
  compact?: boolean;
  level?: Level;
}) {
  return (
    <div className="max-w-prose text-base leading-relaxed text-white/80">
      <Blocks blocks={brief.lead} test={test} compact={compact} />
      {brief.sections.map((s, i) => (
        <Section key={`${s.heading}-${i}`} section={s} test={test} compact={compact} level={level} />
      ))}
    </div>
  );
}

/** The module explainer: the same typography, no test to derive from. */
export function ExplainerView({ sections, level = 3 }: { sections: BriefSection[]; level?: Level }) {
  const none = { slots: [] };
  return (
    <div className="max-w-prose text-base leading-relaxed text-white/80">
      {sections.map((s, i) => (
        <Section key={`${s.heading}-${i}`} section={s} test={none} level={level} />
      ))}
    </div>
  );
}
