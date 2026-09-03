import { COLOR } from "./theme";

/**
 * The segment's route-level loading state.
 *
 * Shaped to the screen it precedes — a header bar, the verdict lines, then rows
 * pinned to the spine — so nothing jumps when the real thing lands. A centred
 * spinner would be honest about waiting and dishonest about what is coming.
 */
export default function CreatorPortalLoading() {
  return (
    <div className="min-h-dvh" style={{ background: COLOR.void }} aria-busy="true">
      <span className="sr-only" role="status">
        Loading your portal
      </span>

      <div
        className="flex h-14 items-center px-3 sm:px-4"
        style={{ borderBottom: `1px solid ${COLOR.line}` }}
      >
        <span
          className="h-5 w-24 animate-pulse rounded"
          style={{ background: COLOR.surface }}
          aria-hidden="true"
        />
        <span
          className="ml-auto size-8 animate-pulse rounded-full"
          style={{ background: COLOR.surface }}
          aria-hidden="true"
        />
      </div>

      <div className="mx-auto w-full max-w-3xl px-3 pt-8 sm:px-6 sm:pt-12" aria-hidden="true">
        <span className="block h-3.5 w-32 animate-pulse rounded" style={{ background: COLOR.surface }} />
        <span
          className="mt-3 block h-7 w-3/5 animate-pulse rounded"
          style={{ background: COLOR.raised }}
        />
        <span className="mt-3 block h-3.5 w-2/5 animate-pulse rounded" style={{ background: COLOR.surface }} />

        <div className="mt-10 flex flex-col gap-5">
          {[72, 58, 64].map((w, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="flex w-8 shrink-0 justify-center pt-1">
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: COLOR.line }}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className="block h-3.5 animate-pulse rounded"
                  style={{ width: `${w}%`, background: COLOR.line }}
                />
                <span
                  className="mt-2 block h-2.5 w-2/5 animate-pulse rounded"
                  style={{ background: COLOR.surface }}
                />
                <span
                  className="mt-2 block h-[3px] w-full rounded-full"
                  style={{ background: COLOR.surface }}
                />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
