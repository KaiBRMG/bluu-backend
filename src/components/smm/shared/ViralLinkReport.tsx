'use client';

import { format } from 'date-fns';
import { CircleAlert, CircleCheck, Clock, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { UserAvatarLabel } from '@/components/UserAvatarLabel';
import { ApprovalBadge, SubmissionStatusBadge } from '@/components/smm/shared/badges';
import { LinkWithCopy } from '@/components/smm/shared/LinkWithCopy';
import { formatMoney } from '@/lib/smm/format';
import type { EligibilityResult } from '@/hooks/useSmmBonus';
import type { SmmPost, SmmSubmission } from '@/types/firestore';

/**
 * The verdict + usage report for a pasted viral link, rendered identically
 * wherever the check is offered:
 *
 * - {@link ViralCopyDialog} — step one of scheduling a post, where the verdict
 *   also gates whether the copy may be declared.
 * - `LinkUsageChecker` on Viral Accounts — the same lookup with nothing riding
 *   on it, so an SMM can check a post before writing anything.
 *
 * Both call `GET /api/smm/bonus/eligibility` through `useSmmBonus`, so the
 * checks are the same by construction: this file only renders what it is
 * given. The result is advisory everywhere — `POST /api/smm/posts` re-runs all
 * three gates before storing a copy.
 */

/** Section label + result count, shared by all three report blocks below. */
function ReportSectionHeader({
  label, hint, count,
}: { label: string; hint: string; count: number }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="text-xs font-medium text-foreground">{label}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      {count > 0 && <Badge variant="secondary" className="shrink-0 font-normal tabular-nums">{count}</Badge>}
    </div>
  );
}

/** Empty-state line for a report section, matching DESIGN's "one quiet line" rule. */
function ReportEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed p-2.5 text-xs text-muted-foreground">{children}</p>
  );
}

/** A scheduled post found by the search — used for both the original-post and copies sections. */
function ReportPostRow({ post }: { post: SmmPost }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-white/[0.025]">
      <UserAvatarLabel
        name={post.postedByName ?? ''}
        photoURL={post.postedByPhotoURL ?? null}
        className="min-w-0 flex-1"
      />
      <span className="hidden shrink-0 max-w-[8rem] truncate text-xs text-muted-foreground sm:inline">
        {post.accountName}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {post.postDate ? format(new Date(post.postDate), 'PP') : '—'}
      </span>
      {post.bonusSubmission && (
        <span className="shrink-0 text-sm" role="img" title="Submitted for bonus" aria-label="Submitted for bonus">
          💰
        </span>
      )}
      <LinkWithCopy url={post.postLink} className="max-w-[8rem] shrink-0" />
    </div>
  );
}

/** A bonus submission found by the search. */
function ReportSubmissionRow({ submission }: { submission: SmmSubmission }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-white/[0.025]">
      <UserAvatarLabel
        name={submission.submittedByName ?? ''}
        photoURL={submission.submittedByPhotoURL ?? null}
        className="min-w-0 flex-1"
      />
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {submission.submissionDate ? format(new Date(submission.submissionDate), 'PP') : '—'}
      </span>
      <span className="shrink-0 text-sm font-medium tabular-nums">{formatMoney(submission.bonusAmount)}</span>
      <SubmissionStatusBadge status={submission.status} />
      <ApprovalBadge value={submission.adminApproval} />
    </div>
  );
}

/**
 * Three outcomes, not two. "Already used recently" is the one failure that
 * *expires* — the same link is fine again in a few days — so it takes the
 * pending hue and a countdown, while a missing or non-viral account is a hard
 * no. Collapsing the two into one red state throws away the most useful thing
 * the check knows.
 */
export type ViralLinkTone = 'ok' | 'waiting' | 'blocked';

/**
 * The verdict's semantic triad, one entry per tone — the app's `-400` ink /
 * `/10` wash / `/30` border pattern (DESIGN §2). One map, never an inline hue
 * at a call site, so the two surfaces can't drift apart.
 */
const TONE: Record<ViralLinkTone, { panel: string; ink: string; Icon: LucideIcon }> = {
  ok: { panel: 'border-green-500/30 bg-green-500/10', ink: 'text-green-400', Icon: CircleCheck },
  waiting: { panel: 'border-orange-500/30 bg-orange-500/10', ink: 'text-orange-400', Icon: Clock },
  blocked: { panel: 'border-red-500/30 bg-red-500/10', ink: 'text-red-400', Icon: CircleAlert },
};

export interface ViralLinkVerdict {
  /** The handle resolved to an account in `twitterx-accounts`. */
  accountFound: boolean;
  /** That account is listed on Viral Accounts (`isViralBonus`). */
  isViralAccount: boolean;
  /** All three gates passed — the link may be copied. */
  ok: boolean;
  tone: ViralLinkTone;
  /** The tone's icon, so a header can carry the same mark as the panel. */
  Icon: LucideIcon;
  /** The tone's text colour. */
  ink: string;
  /** The one-line status, for the badge. */
  statusLabel: string;
  /** The headline, for whichever header the surface renders. */
  title: string;
}

/**
 * The three gates, in the order they are applied: the handle resolves to an
 * account → that account has `isViralBonus` → the source is older than two
 * weeks. An unknown account blocks regardless of anything else and a non-viral
 * one blocks regardless of age, so both win over the two-week rule.
 *
 * Derived in one place so every surface reaches the same verdict from the same
 * payload — a second copy of this ladder is how two screens start disagreeing.
 */
export function viralLinkVerdict(eligibility: EligibilityResult): ViralLinkVerdict {
  const accountFound = !!eligibility.account;
  const isViralAccount = eligibility.account?.isViralBonus === true;
  const ok = eligibility.eligible && accountFound && isViralAccount;

  const tone: ViralLinkTone = ok
    ? 'ok'
    : accountFound && isViralAccount ? 'waiting' : 'blocked';

  return {
    accountFound,
    isViralAccount,
    ok,
    tone,
    Icon: TONE[tone].Icon,
    ink: TONE[tone].ink,
    statusLabel: !accountFound
      ? 'Account not found'
      : !isViralAccount
        ? 'Not a viral account'
        : eligibility.eligible
          ? (eligibility.found ? 'Eligible — old enough to copy' : 'Eligible — never used')
          : 'Already used recently',
    title: !accountFound
      ? 'Account not found'
      : !isViralAccount
        ? 'Not a viral account'
        : eligibility.eligible
          ? (eligibility.found ? 'Eligible to copy' : 'Eligible — never used')
          : 'Already used recently',
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When a source blocked by the two-week rule becomes copyable again — the one
 * thing an SMM actually wants from a "no", and something the payload already
 * knows. `eligibleAfterDays` is the server's own constant, so the rule is never
 * re-declared here; without it (or without a usage date) there is no countdown
 * and the caller simply renders nothing.
 *
 * The server's test is `daysDiff > eligibleAfterDays`, and `daysDiff` floors —
 * so the instant it unlocks is the source's date plus `eligibleAfterDays + 1`
 * whole days.
 */
function unlocksAt(eligibility: EligibilityResult): { days: number; date: Date } | null {
  const { eligibleAfterDays, detail, found, eligible } = eligibility;
  if (eligible || !found || eligibleAfterDays == null || !detail?.date) return null;

  const used = new Date(detail.date).getTime();
  if (Number.isNaN(used)) return null;

  const at = used + (eligibleAfterDays + 1) * DAY_MS;
  const days = Math.max(1, Math.ceil((at - Date.now()) / DAY_MS));
  return { days, date: new Date(at) };
}

/**
 * The report body: the verdict card, then every record found for the link —
 * the original post itself, other posts that copied it, and bonus submissions
 * filed against it. The heading above it is the caller's, because the wording
 * differs by surface ("go back and answer No" only makes sense mid-flow).
 */
export function ViralLinkReportCard({
  eligibility,
  link,
}: {
  eligibility: EligibilityResult;
  /** The link as pasted, echoed back so the SMM can see what was checked. */
  link: string;
}) {
  const { isViralAccount, ok, tone, statusLabel, Icon, ink } = viralLinkVerdict(eligibility);
  const report = eligibility.report;
  const unlock = unlocksAt(eligibility);

  return (
    // The reveal is the moment the answer lands, so it belongs to the whole
    // report, not to each row. One 200ms ease-out, `motion-safe` like the rest
    // of the app, and the base style is the final state — the report is correct
    // if the animation never runs.
    <div className="space-y-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-200">
      {/* PRIMARY — the verdict, tinted by the triad for its tone: readable
          across the room before a word of it is read. */}
      <div className={`rounded-lg border p-3 space-y-1.5 text-sm ${TONE[tone].panel}`}>
        <div className="flex items-center justify-between gap-2">
          <span className={`flex items-center gap-1.5 font-medium ${ink}`}>
            <Icon className="size-4 shrink-0" aria-hidden />
            {statusLabel}
          </span>
          {/* The countdown is the point of the pending tone: a "no" with a date
              on it is a plan, a bare "no" is a dead end. */}
          {unlock && (
            <Badge variant="secondary" className="shrink-0 font-normal tabular-nums">
              Free in {unlock.days} day{unlock.days === 1 ? '' : 's'} · {format(unlock.date, 'PP')}
            </Badge>
          )}
        </div>
        <p className="break-all">
          <span className="text-muted-foreground">Original link: </span>
          {link.trim() || '—'}
        </p>
        <p>
          <span className="text-muted-foreground">Account: </span>
          {eligibility.account
            ? (
              <>
                {eligibility.account.name}
                <span className="text-muted-foreground"> ({eligibility.account.network})</span>
                {!isViralAccount && (
                  <span className="text-destructive"> — not a Viral Account</span>
                )}
              </>
            )
            : <span className="text-destructive">
                {eligibility.handle ? `@${eligibility.handle} — not in the account database` : 'Not found in the database'}
              </span>}
        </p>
        {eligibility.found ? (
          <p className="tabular-nums">
            <span className="text-muted-foreground">Last used: </span>
            {eligibility.daysDiff != null ? `${eligibility.daysDiff} day${eligibility.daysDiff === 1 ? '' : 's'} ago` : '—'}
            <span className="text-muted-foreground"> (as {eligibility.source === 'submission' ? 'a bonus submission source' : 'a scheduled post'})</span>
          </p>
        ) : ok && (
          // The cleanest result the check can return — worth saying out loud
          // rather than leaving as the absence of a "last used" line.
          <p className="text-muted-foreground">Untouched — nobody here has used this link before.</p>
        )}
      </div>

      {/* PRIMARY — the post whose OWN link matches: the original itself. */}
      <div className="space-y-1.5">
        <ReportSectionHeader
          label="Original post"
          hint="The post in the schedule whose own link is this exact link."
          count={report.originalPost ? 1 : 0}
        />
        {report.originalPost ? (
          <div className="rounded-lg border">
            <ReportPostRow post={report.originalPost} />
          </div>
        ) : (
          <ReportEmpty>Not in the schedule — nobody has uploaded this exact post.</ReportEmpty>
        )}
      </div>

      {/* SECONDARY — other posts that also copied this same original. */}
      <div className="space-y-1.5">
        <ReportSectionHeader
          label="Other copies of this original"
          hint="Posts that declared this link as their own copy source, not the original itself."
          count={report.copies.length}
        />
        {report.copies.length === 0 ? (
          <ReportEmpty>Nobody has copied this one yet.</ReportEmpty>
        ) : (
          <div className="rounded-lg border divide-y">
            {report.copies.map((p) => <ReportPostRow key={p.id} post={p} />)}
          </div>
        )}
      </div>

      {/* Bonus submissions filed against this original. */}
      <div className="space-y-1.5">
        <ReportSectionHeader
          label="Bonus submissions"
          hint="Bonuses filed with this link as their copy source, paid or pending."
          count={report.submissions.length}
        />
        {report.submissions.length === 0 ? (
          <ReportEmpty>No bonus has been claimed against this original.</ReportEmpty>
        ) : (
          <div className="rounded-lg border divide-y">
            {report.submissions.map((s) => <ReportSubmissionRow key={s.id} submission={s} />)}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The waiting state, shaped like the report it is about to become — the verdict
 * panel, then the three sections. A skeleton that matches the real thing turns
 * the lookup into "it's coming" instead of "did that button work?".
 */
export function ViralLinkReportSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-[6.5rem] rounded-lg" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-11 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

/**
 * A result worth rendering — `report` is what every section reads from, so a
 * payload without one is treated as no result rather than crashing a section.
 */
export function hasViralReport(eligibility: EligibilityResult | null): eligibility is EligibilityResult {
  return !!eligibility?.report;
}
