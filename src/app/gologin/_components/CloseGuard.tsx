'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CloseDecision } from '@/hooks/useGoLoginCloseGuard';

export interface BusyProfile {
  profileId: string;
  name: string;
  /** 'starting' | 'running' | 'stopping' */
  status: string;
}

/**
 * Shown when a window close is held back because sessions are live.
 *
 * **The options depend on what is live, because the two situations have
 * different consequences and different remedies:**
 *
 * - **Anything open** (`starting`/`running`) → *Save & quit* and *Cancel*. Closing
 *   the window would leave an Orbita browser running that nothing in Bluu is
 *   showing, so the useful act is to shut the browsers down properly. There is
 *   deliberately no "close anyway" here: it would produce exactly that orphan.
 * - **Only saving** (`stopping`) → *Close when finished*, *Keep window open*, and
 *   *Close anyway*. The work is already under way, so waiting is cheap and the
 *   escape hatch is honest about what it costs.
 *
 * **Not a shadcn `Dialog`.** No dismiss, no Escape, no outside-click: each is an
 * unlabelled extra answer to a question whose answers matter, and the safe
 * default is not "whatever the stray click meant". Rendered as a sibling overlay
 * inside the window's own `fixed inset-0` ground, like `OrbitaGate`.
 */
export default function CloseGuard({
  profiles,
  closing,
  onDecision,
}: {
  /** Live, so the list shrinks as each profile finishes. */
  profiles: BusyProfile[];
  /** True once a closing option was chosen — the dialog then just reports. */
  closing: boolean;
  onDecision: (decision: CloseDecision) => void;
}) {
  const open = profiles.filter((p) => p.status !== 'stopping');
  const savingOnly = open.length === 0;
  const count = profiles.length;

  return (
    <div
      // Same named overlay layer as `OrbitaGate`; the ordering between the two
      // is DOM order in `page.tsx`, where this is rendered last on purpose.
      className="absolute inset-0 z-[var(--z-overlay)] flex items-center justify-center bg-background/95 px-8 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-label="Profiles are still active"
    >
      <div className="w-full max-w-md">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-zinc-400">
          GoLogin
        </h2>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-white">
          <Loader2 className="size-5 animate-spin text-blue-400" aria-hidden />
          {savingOnly
            ? `Saving ${count} ${count === 1 ? 'profile' : 'profiles'}`
            : `${count} ${count === 1 ? 'profile is' : 'profiles are'} still open`}
        </h1>

        <p className="mt-2 text-sm text-zinc-400">
          {/* Stated in the operator's terms. "Committing the profile" is our
              vocabulary; "you would be logged out" is theirs. */}
          {savingOnly
            ? 'Your browsing session — cookies, logins, saved state — is uploading to GoLogin. If it does not finish, that work is lost and the account will be logged out next time it opens.'
            : 'Closing this window will not close the browsers. They keep running, nothing in Bluu will be showing them, and each profile stays locked to this machine until you quit the app.'}
        </p>

        {/* Named, because "3 profiles" is not enough to decide with — the
            operator needs to know which, and what each is doing. */}
        <ul className="mt-4 max-h-40 space-y-1 overflow-y-auto border-t border-white/[0.07] pt-3">
          {profiles.map((profile) => (
            <li key={profile.profileId} className="flex items-center gap-2 text-[11px]">
              {/* The profile name is the subject of the decision, so it takes
                  Ink; its status is the de-emphasis step. These were `-300` and
                  `-500` — two off-palette greys in the one dialog that exists to
                  stop an operator losing work, the lower of them below AA. */}
              <span className="truncate text-white">{profile.name}</span>
              <span
                className={`ml-auto shrink-0 tabular-nums ${
                  profile.status === 'stopping' ? 'text-blue-400' : 'text-zinc-400'
                }`}
              >
                {profile.status === 'stopping'
                  ? 'Stopping'
                  : profile.status === 'starting'
                    ? 'Starting'
                    : 'Open'}
              </span>
            </li>
          ))}
        </ul>

        {closing ? (
          <p className="mt-5 flex items-center gap-1.5 text-[11px] text-zinc-400">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            This window will close on its own once the last profile finishes.
          </p>
        ) : savingOnly ? (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              className="bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
              onClick={() => onDecision('after-completion')}
            >
              Close when finished
            </Button>
            <Button variant="outline" size="sm" onClick={() => onDecision('cancel')}>
              Keep window open
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-zinc-400 hover:text-red-400"
              onClick={() => onDecision('force')}
            >
              Close anyway, lose the session
            </Button>
          </div>
        ) : (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              className="bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
              onClick={() => onDecision('stop-and-close')}
            >
              Save &amp; quit
            </Button>
            <Button variant="outline" size="sm" onClick={() => onDecision('cancel')}>
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
