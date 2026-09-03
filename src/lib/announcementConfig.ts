/**
 * In-app announcements — the permanent module behind the card that appears under
 * the top bar when something company-wide needs telling.
 *
 * **This file is the only thing that decides who sees what.** The card, the
 * dismissal storage and the endpoint are already deployed and inert until an
 * entry here is armed. Same shape and same reasoning as
 * [`appUpdateConfig.ts`](appUpdateConfig.ts) and
 * [`emailMigrationConfig.ts`](emailMigrationConfig.ts): a phased rollout should
 * be a one-line commit, not a code change.
 *
 * ▸ **`enabled: false` means nobody sees it, full stop.** The default state and
 *   the kill switch.
 *
 * ▸ **Cohorts, for testing and for staging.** A user matches when `allUsers` is
 *   true, or their uid is in `uids`, or one of their groups is in `groups`.
 *   Testing an announcement on yourself is therefore `uids: ['<your uid>']` with
 *   `enabled: true` — nobody else is touched.
 *
 * ▸ **It is read over HTTP** (`fetchAnnouncements` → `/api/announcements`), never
 *   from this compiled-in constant, and that is load-bearing. A renderer that
 *   has been open for a week is running the bundle it launched with, so an
 *   announcement armed today would never reach the very users who most need
 *   telling (cross-cutting rule 9c).
 *
 * ▸ **Two dismissals, deliberately different.** "Remind me later" lasts for the
 *   app session and re-arms on the next start *or* the next clock-out — the same
 *   pattern `UpdateAvailableBanner` uses, and for the same reason: a user who
 *   leaves the app running across shifts must still be caught. The "×" is
 *   permanent and is stored on the user doc, so it survives a reinstall and
 *   follows them to another machine.
 *
 * ▸ **`hideWhen` retires an announcement on its own terms.** An announcement
 *   asking users to do something should disappear when they have done it, rather
 *   than relying on them pressing "×". It is re-evaluated live against the user
 *   snapshot, so the card vanishes the moment the thing happens.
 *
 * ── Adding one ───────────────────────────────────────────────────────────────
 * Append an entry, ship it with `enabled: false`, then arm it in its own commit.
 * Give it an `id` that will never be reused: dismissals are keyed on it, so
 * recycling an id hides a new announcement from everyone who dismissed the old.
 */

/** What the primary button does. */
export type AnnouncementAction =
  /** Mint the caller's one-time Telegram link and open it in the system browser. */
  | { kind: 'telegram-link' }
  /** Open an absolute URL in the system browser. */
  | { kind: 'external'; href: string }
  /** Navigate within the app. */
  | { kind: 'route'; href: string };

/** A live precondition that retires the announcement without a dismissal. */
export type AnnouncementCondition = 'telegram-linked';

/**
 * What the card actually renders — and the whole of what crosses the wire.
 *
 * Split from the definition below on purpose: the cohort fields name colleagues
 * by uid and group, and there is no reason for every renderer to hold that list
 * in memory to draw one card.
 */
export interface ClientAnnouncement {
  /** Stable, never reused — dismissals are keyed on it. */
  id: string;
  title: string;
  body: string;
  primaryLabel: string;
  action: AnnouncementAction;
  /** `null` → no "remind me later" button. */
  secondaryLabel: string | null;
  /** `false` → no "×"; the card can only be deferred, never buried. */
  dismissible: boolean;
  /** Hide (permanently, without a dismissal) once this is true of the user. */
  hideWhen?: AnnouncementCondition | null;
}

export interface AnnouncementDefinition extends ClientAnnouncement {
  /** Master switch for this entry. */
  enabled: boolean;
  /** Show to everyone. Ignores `uids`/`groups`. */
  allUsers: boolean;
  /** Individual uids — the testing and volunteer cohort. */
  uids: string[];
  /** Group slugs ('CA', 'SMM', 'OFAM', 'admin', …). */
  groups: string[];
}

export const ANNOUNCEMENTS: AnnouncementDefinition[] = [
  {
    id: 'telegram-integration-2026-09',
    // ── Rollout state ────────────────────────────────────────────────────
    // DISARMED. Ships inert. To test on yourself: enabled: true + your uid in
    // `uids`. To roll out: a group at a time, then `allUsers`.
    enabled: true,
    allUsers: false,
    uids: ['VoRCp0wmgvSgKG8yzxOyMyZ4cSv1','frSjvEHILmZ0rnDhVpGwh0wjP4d2'],
    groups: [],

    title: 'Bluu Backend has integrated with Telegram',
    body: 'Important updates and system alerts can now be sent straight to you on Telegram, so you can receive important updates without needing to open the app.',

    primaryLabel: 'Link Account',
    action: { kind: 'telegram-link' },
    secondaryLabel: 'Remind me later',
    dismissible: true,
    // Once the account is linked there is nothing left to ask for, so the card
    // retires itself rather than waiting to be dismissed.
    hideWhen: 'telegram-linked',
  },
];

/** The shape the user side of the match needs. Kept structural so both the
 *  server (a `users` doc) and the client (the `useUserData` snapshot) satisfy it
 *  without a shared import. */
export interface AnnouncementAudience {
  uid?: string;
  groups?: string[];
  dismissedAnnouncements?: string[];
  telegram?: { userId?: string } | null;
}

/** Is this user in the announcement's cohort? Cohort only — no dismissal or
 *  condition test, so the two questions stay separable. */
export function matchesAnnouncementCohort(
  announcement: AnnouncementDefinition,
  user: AnnouncementAudience | null | undefined,
): boolean {
  if (!announcement.enabled) return false;
  if (!user) return false;
  if (announcement.allUsers) return true;
  if (user.uid && announcement.uids.includes(user.uid)) return true;
  return (user.groups ?? []).some((g) => announcement.groups.includes(g));
}

/** Has the announcement's `hideWhen` come true for this user? */
export function announcementConditionMet(
  announcement: Pick<ClientAnnouncement, 'hideWhen'>,
  user: AnnouncementAudience | null | undefined,
): boolean {
  if (!announcement.hideWhen) return false;
  if (announcement.hideWhen === 'telegram-linked') return !!user?.telegram?.userId;
  return false;
}

/**
 * The announcements this user should currently see, most-recently-defined last.
 *
 * Only one card is ever rendered (the first match) — two stacked cards under the
 * top bar would cover the page, and an announcement worth interrupting for is
 * worth reading on its own. The full list is returned anyway so the caller can
 * decide, and so a future surface could show a history.
 */
export function selectAnnouncements(
  announcements: AnnouncementDefinition[],
  user: AnnouncementAudience | null | undefined,
): AnnouncementDefinition[] {
  const dismissed = new Set(user?.dismissedAnnouncements ?? []);
  return announcements.filter(
    (a) =>
      matchesAnnouncementCohort(a, user) &&
      !dismissed.has(a.id) &&
      !announcementConditionMet(a, user),
  );
}

/**
 * Read the announcements **as deployed right now**, already filtered to the
 * caller. Falls back to an empty list rather than to the compiled constant: an
 * unreachable endpoint should show nothing, not a stale card the server may
 * have retired. (`fetchAppUpdateConfig` falls back the other way because there
 * the failure mode — not prompting an update — is the dangerous one.)
 *
 * **`idToken` is required**, unlike `fetchAppUpdateConfig`'s endpoint, which is
 * open. `/api/announcements` runs the cohort match server-side so uid and group
 * lists never reach a renderer, which means it must know who is asking — it is
 * wrapped in `withAuth` and 401s without a Bearer token. Calling this without
 * one returns an empty list *silently*, which looks exactly like "no
 * announcement is armed"; that is the failure this parameter exists to prevent.
 */
export async function fetchAnnouncements(idToken: string): Promise<ClientAnnouncement[]> {
  try {
    const res = await fetch('/api/announcements', {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) {
      // A 401 here is a bug, not a state — the caller holds a signed-in user.
      // Say so, rather than letting it read as "nothing is armed".
      if (res.status === 401) console.error('[announcements] unauthorized — token not sent?');
      return [];
    }
    const data: unknown = await res.json();
    const list = (data as { announcements?: unknown })?.announcements;
    if (!Array.isArray(list)) return [];
    return list.filter(isAnnouncementDefinition);
  } catch {
    return [];
  }
}

/** The response is our own and same-origin, but it decides what interrupts a
 *  user's screen — so it is shape-checked rather than trusted. */
function isAnnouncementDefinition(value: unknown): value is ClientAnnouncement {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const action = v.action as Record<string, unknown> | undefined;
  return (
    typeof v.id === 'string' &&
    typeof v.title === 'string' &&
    typeof v.body === 'string' &&
    typeof v.primaryLabel === 'string' &&
    typeof v.dismissible === 'boolean' &&
    !!action &&
    (action.kind === 'telegram-link' ||
      ((action.kind === 'external' || action.kind === 'route') && typeof action.href === 'string'))
  );
}
