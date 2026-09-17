// Timestamp used in shared types — compatible with both firebase/firestore and firebase-admin/firestore
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Timestamp = any;

// ─── Group hierarchy ────────────────────────────────────────────────

export type GroupSlug = 'unassigned' | 'CA' | 'SMM' | 'OFAM' | 'admin';

/** Numeric level for each group. Higher = more privileged. */
export const GROUP_HIERARCHY: Record<string, number> = {
  'unassigned': -1,
  'CA': 0,
  'SMM': 0,
  'OFAM': 1,
  'admin': 2,
};

/** Human-readable display names. */
export const GROUP_DISPLAY_NAMES: Record<string, string> = {
  'unassigned': 'Unassigned',
  'CA': 'Chat Agents',
  'SMM': 'Social Media Manager',
  'OFAM': 'Account Manager',
  'admin': 'Admin',
};

// ─── User ───────────────────────────────────────────────────────────

export interface UserDocument {
  uid: string;
  /**
   * The sign-in address, and the **authorisation key** for the whole app: an
   * admin registers it in the Employee Registry, and login is refused unless
   * the address Google returns matches it (via the `auth-emails` index).
   *
   * Named `workEmail` for history — since the personal-email migration it holds
   * the user's *personal* Google account. The UI labels it "Login email"; the
   * field name is kept because it spans types, caches and API payloads.
   */
  workEmail: string;
  displayName: string;
  photoURL?: string;
  firstName: string;
  lastName: string;
  groups: string[];
  createdAt: Timestamp;
  /** Null until the registered user actually signs in — this is "Invited". */
  lastLoginAt: Timestamp | null;
  /**
   * Last time the app was **open** for this user — the real "last seen".
   *
   * Distinct from {@link lastLoginAt}, which is only written at sign-in and is
   * therefore months stale for anyone who never quits the Electron shell
   * (rule 9c). Written by `POST /api/user/presence` from `PresenceReporter`,
   * which every authenticated window mounts, so having the app open in any
   * capacity — main window, OF Manager, GoLogin, clocked in or out, minimised —
   * counts. Resolution is ~10 minutes by design; it is not an activity signal
   * (that is `active_sessions`) and it must not be used as one.
   *
   * Absent on users who have not been online since this shipped.
   */
  lastActiveAt?: Timestamp;
  /** Google's stable account id (`sub`), recorded on login. Survives renames. */
  googleSub?: string | null;
  /** Set when the user moved off their @bluurock.com address. */
  emailMigratedAt?: Timestamp;
  /**
   * Set when a mistaken migration was undone and the user was moved *back* onto
   * their @bluurock.com address. Mutually exclusive with `emailMigratedAt`,
   * which the reversal deletes.
   */
  emailRevertedAt?: Timestamp;
  /**
   * Set when an already-migrated user was moved from one personal address to
   * another (they migrated signed into the wrong Google account). Coexists with
   * `emailMigratedAt`, which a correction deliberately leaves untouched — they
   * came off the company domain then, not now.
   */
  emailCorrectedAt?: Timestamp;
  /** The previous address, replaced on each move. Audit only. */
  previousWorkEmail?: string | null;
  isActive: boolean;
  isArchived?: boolean;
  role?: 'admin' | 'member';

  /**
   * The address of the user's own GoLogin account, set when they link a personal
   * API key. Present == "GoLogin onboarding is done", which is the whole reason
   * it is mirrored here: the window reads it off the existing `useUserData`
   * snapshot and needs no extra round trip to decide what to render.
   *
   * The **key itself is not here** and must never be — this document is streamed
   * to the renderer. It lives encrypted in `gologin-accounts/{uid}`, which no
   * client can read. See `lib/services/gologinAccountService.ts`.
   */
  gologinEmail?: string;
  gologinLinkedAt?: Timestamp;

  address?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
  };

  gender?: string;
  DOB?: Timestamp;
  jobTitle?: string;
  employmentType?: string;

  contactInfo?: {
    phoneNumber?: string;
    countryCode?: string;
    personalEmail?: string;
    emergencyContactName?: string;
    emergencyContactNumber?: string;
    emergencyContactEmail?: string;
  };

  paymentMethod?: string;
  paymentInfo?: string;

  userComments?: string;

  timezone?: string;
  timezoneOffset?: string;
  additionalTimezones?: string[];
  // Notion document IDs the user has pinned to their home dashboard (max 10).
  pinnedResources?: string[];
  hasPaidLeave?: boolean;
  remainingUnpaidLeave?: number;
  remainingPaidLeave?: number;
  /**
   * The leave periods this user's balances were last reset for — `YYYY-MM` for
   * unpaid, a year for paid.
   *
   * Written only by the daily reset cron (`/api/cron/leave-reset`) and by user
   * creation. They are what makes the reset idempotent: the job asks "which
   * period is this user stamped for", never "what day is it today", so a missed
   * run catches up and a double run does nothing. See
   * [`leaveBalance.ts`](../lib/leave/leaveBalance.ts).
   *
   * Nothing queries either field — the cron filters in memory over a cohort it
   * already had to fetch — so both are index-exempt (rule 9).
   */
  unpaidLeaveResetMonth?: string;
  paidLeaveResetYear?: number;
  enableIdleTimeout?: boolean;
  enableScreenshots?: boolean;

  // Always-visible session timer (macOS menu-bar tray / Windows docked HUD).
  // User-controlled in Settings → App Settings and DEFAULT ON, so absent must
  // read as enabled — test it with `!== false`, never as truthy.
  timerWidgetEnabled?: boolean;

  notificationPreferences?: {
    desktopEnabled: boolean;
    soundEnabled: boolean;
    shiftReminders: boolean;
    screenshotNotifications: boolean;
  };

  // Denormalized: page IDs this user can access (kept in sync by server on group/permission changes)
  permittedPageIds?: string[];

  // ── Telegram ──────────────────────────────────────────────────────────
  // The bound Telegram account, written only by the bot webhook once the user
  // spends their one-time link. Absent = not connected, which is also the
  // opt-out: notification delivery resolves chat ids off this field, so
  // disconnecting in Settings genuinely stops Telegram messages.
  // The reverse direction (Telegram id → uid) lives in `telegram-accounts`;
  // nothing queries this field, so it is exempt from indexing (rule 9).
  telegram?: {
    userId: string;
    chatId: string;
    username?: string | null;
    firstName?: string | null;
    linkedAt: Timestamp;
  };
  // SHA-256 of the outstanding one-time link, or absent. Points at the
  // `telegram-links` doc so minting a new invite can void the previous one
  // without a query. Never the token itself.
  telegramLinkTokenHash?: string;
  telegramLinkCreatedAt?: Timestamp;
  // Set once, at onboarding completion (`/api/user/onboarding`), regardless of
  // whether the user actually linked or pressed "Skip for now" on the
  // dedicated Link Telegram section. Lets `announcementConfig.ts` retire the
  // telegram-integration announcement for anyone who was already asked here —
  // re-showing the same ask in a card would be redundant, not a reminder.
  telegramPromptedAtOnboarding?: boolean;

  // Announcement ids the user has dismissed permanently (the card's "×").
  // Keyed on AnnouncementDefinition.id — see announcementConfig.ts. Nothing
  // queries it; index-exempt (rule 9).
  dismissedAnnouncements?: string[];

  // Installed desktop app build, reported once per app start by the renderer
  // (see AppVersionReporter) and only written when it actually changes.
  appVersion?: string | null;
  appPlatform?: string | null; // darwin / win32
  appVersionUpdatedAt?: Timestamp;

  // Release note (APP_UPDATE.releaseNote) this user has already been sent, so a
  // "what's new" notification reaches each user once per release and never again.
  // Absent = never notified. Written only by /api/user/app-version.
  releaseNoteNotifiedVersion?: string | null;

  // LEGACY single-session token, rotated on every DESKTOP login (a web login
  // leaves it alone on purpose). Superseded by `sessions` below, but still
  // written and still the fallback comparison — a renderer open for weeks is
  // running a bundle that knows nothing else. See lib/services/sessionService.ts.
  sessionToken?: string;

  // Device-keyed sessions: deviceId -> that device's own token. The unit of
  // session enforcement, so a desktop session and a web session can coexist
  // while two desktop sessions still cannot. Absent on users who have not
  // logged in since device identity shipped.
  sessions?: Record<
    string,
    {
      token: string;
      kind: 'desktop' | 'web';
      label: string;
      createdTime: string;
      lastSeenTime: string;
    }
  >;

  // Onboarding state
  hasAcceptedTerms: boolean;
  hasCompletedOnboarding: boolean;

  // TEMPORARY (remove after fleet migrates): true for users created after the
  // stale-ScreenCapture-TCC fix shipped. Absent/false on pre-existing users, who
  // may hold a stale macOS Screen Recording grant that needs a one-time reset.
  // See the "Temporary: screenshot TCC repair" note in CLAUDE.md.
  screenshotBugFixed?: boolean;
}

// ─── Notifications ───────────────────────────────────────────────────

export type NotificationType = 'onboarding' | 'system' | 'shift' | 'alert' | 'success' | 'action';

export interface NotificationDocument {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: NotificationType;
  read: boolean;
  dismissedByUser: boolean;
  createdAt: Timestamp;
  actionUrl?: string | null;
  announcement?: boolean;
  announcementExpiry?: Timestamp | null;
  batchId?: string;
}

export interface AdminNotificationBatch {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  sentBy: string;
  sentByName: string;
  sentAt: Timestamp;
  recipientUserIds: string[];
  recipientGroupIds: string[];
  /** Individually-picked creator uids. Absent on batches sent before creators were wired up. */
  recipientCreatorIds?: string[];
  /** True when the "All Creators" pseudo-group was selected. */
  recipientAllCreators?: boolean;
  recipientCount: number;
  /** True when the admin also pushed this batch to Telegram. Absent on pre-Telegram batches. */
  sentViaTelegram?: boolean;
}

// ─── Leave Requests ───────────────────────────────────────────────────

export interface LeaveRequestDocument {
  leaveId: string;
  shiftId: string;
  occurrenceStart: number;    // ms UTC — identifies the specific occurrence
  userId: string;
  leaveType: 'paid' | 'unpaid';
  status: 'pending' | 'approved' | 'denied';
  requestedAt: Timestamp;
  resolvedAt?: Timestamp | null;
  resolvedBy?: string | null;  // admin UID
  /**
   * Why the leave is being taken. Mandatory for paid leave, optional for unpaid.
   *
   * Exists so the reason arrives with the request instead of in a separate
   * 1-on-1 chat message an admin has to go and find before they can decide.
   */
  reason?: string | null;
  /**
   * What approval actually released, resolved against the live roster rather
   * than the `shiftId`/`occurrenceStart` pinned above.
   *
   * The two differ whenever an admin edited the shift while the request sat in
   * the queue — a single-occurrence edit moves it to a new override document, a
   * "this and future" edit to a whole new series root. The release follows the
   * roster; this records where it landed so a later withdrawal restores the same
   * document instead of un-deleting one nobody released.
   *
   * Absent on requests approved before this was recorded, and on requests that
   * were never approved. Nothing queries either field — both are index-exempt
   * (rule 9).
   */
  releasedShiftId?: string | null;
  releasedOccurrenceStart?: number | null;
}

// ─── Group ──────────────────────────────────────────────────────────

export interface GroupDocument {
  id: string;
  name: string;
  description?: string;
  members: string[];
  createdAt: Timestamp;
  isDefault: boolean;
  level: number;
}

// ─── Page permission (Firestore document) ───────────────────────────

export interface PagePermissionDoc {
  pageId: string;
  groups: Record<string, true>;  // groupSlug -> true (presence = access)
  users: Record<string, true>;   // uid -> true (presence = access)
}

// ─── Time Tracking ──────────────────────────────────────────────────

/** @deprecated Used only for the legacy time-entries collection. New sessions use ActiveSessionDocument + TimeEntryLedgerDocument. */
export type TimeEntryState = 'working' | 'idle' | 'on-break';

/** @deprecated Used only for the legacy time-entries collection. */
export interface TimeEntryDocument {
  userId: string;
  state: TimeEntryState;
  createdTime: Timestamp;
  lastTime: Timestamp;
  userClockOut: boolean;
  durationSeconds?: number | null;
  interrupted?: boolean;
}

// ─── New session model ───────────────────────────────────────────────

export type ActiveSessionState = 'working' | 'idle' | 'on-break' | 'paused';
export type TimerDisplayState = 'working' | 'idle' | 'on-break' | 'paused' | 'clocked-out';

export type SessionEventType =
  | 'clock-in'
  | 'idle-start'
  | 'idle-end'
  | 'break-start'
  | 'break-end'
  | 'pause'
  | 'resume'
  | 'activity'
  | 'screenshot'
  | 'clock-out';

export interface SessionEvent {
  type: SessionEventType;
  timestamp: number; // ms since epoch
  meta?: Record<string, unknown>;
}

export interface LocalSessionBuffer {
  sessionId: string;
  userId: string;
  startTime: number; // ms since epoch
  events: SessionEvent[];
  lastFlushed?: number; // timestamp of last upload attempt
}

/** active_sessions/{userId} — lightweight presence signal; deleted on clock-out */
export interface ActiveSessionDocument {
  sessionId: string;
  userId: string;
  startTime: Timestamp;
  lastUpdated: Timestamp; // updated by heartbeat (working state only)
  currentState: ActiveSessionState;
  userClockOut: boolean; // true = app closed gracefully without explicit clock-out
  lastActivityPercent?: number | null; // most recent activity % from screenshot interval
  enableScreenshots?: boolean; // user's screenshot setting as of clock-in — activity % only exists when true
  appVersion?: string | null; // installed desktop app version reported at clock-in
  platform?: string | null; // OS platform reported at clock-in (darwin/win32)
}

export interface SessionModification {
  modifiedBy: string;
  modifiedAt: Timestamp;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string;
}

export interface ParsedSessionTotals {
  workingSeconds: number;
  idleSeconds: number;
  breakSeconds: number;
  pauseSeconds: number;
}

/** time_entries/{sessionId} — permanent ledger; written once at clock-out or by Cloud Function */
export interface TimeEntryLedgerDocument {
  sessionId: string;
  userId: string;
  startTime: Timestamp;
  endTime: Timestamp;
  workingSeconds: number;
  idleSeconds: number;
  breakSeconds: number;
  pauseSeconds: number;
  didNotClockOut: boolean; // true if terminated by Cloud Function
  logUploadedAt: Timestamp | null; // null until client uploads local buffer
  eventLog: SessionEvent[];
  status: 'completed' | 'interrupted';
  isManual: boolean;
  modifications: SessionModification[];
  originalData: ParsedSessionTotals;
  enableIdleTimeout: boolean;
  timezone: string;
  createdAt: Timestamp;
}

// ─── Shifts ──────────────────────────────────────────────────────────

export interface ShiftRecurrence {
  frequency: 'daily' | 'weekly' | 'monthly';
  interval: number;
  daysOfWeek: number[];        // 0=Sun..6=Sat; only meaningful for weekly
  endDate: Timestamp | null;
  count: number | null;        // mutually exclusive with endDate
  parentShiftId: string | null; // null on root; set on per-instance overrides
}

export interface ShiftDocument {
  shiftId: string;
  userId: string;
  startTime: Timestamp;        // UTC
  endTime: Timestamp;          // UTC
  wallClockStart: string;      // "HH:mm" local time for DST-safe recurrence expansion
  wallClockEnd: string;        // "HH:mm" local time
  userTimezone: string;        // IANA timezone at creation time (e.g. "America/New_York")
  createdBy: string;           // admin UID
  createdAt: Timestamp;
  updatedAt: Timestamp;
  isRecurring: boolean;        // true when recurrence != null (for query efficiency)
  recurrence: ShiftRecurrence | null;
  seriesId: string | null;     // points to root recurring shift (on override docs)
  overrideDate: Timestamp | null; // UTC midnight of the date being overridden
  isDeleted: boolean;          // tombstone for "delete single occurrence"

  /**
   * Creator accounts the agent works during this shift.
   *
   * Absent on every shift created before creator assignment existed, which is
   * why the salary engine falls back to "distinct creators with a sale that day"
   * and flags the result as inferred — see `salaryEngine.ts`. On a recurring
   * root this is the assignment for the whole series; a per-occurrence override
   * document carries its own list.
   */
  creatorIds?: string[];

  /**
   * The subset of {@link creatorIds} the agent covers as **overtime inside this
   * shift** — extra accounts they work without extra pay.
   *
   * They keep the sales, but the accounts do not count toward the shift's wage
   * tier: an agent on 3 regular accounts who picks up 2 more during the same
   * hours is still paid the 3-account rate. Outside-shift overtime is the other
   * case entirely — a second shift with `isOvertime: true`, whose accounts *do*
   * pay (see documentation/ca-salary.md §6).
   *
   * Always a subset of `creatorIds`; the API intersects the two before writing,
   * so an id removed from the assignment cannot survive here as a ghost.
   */
  overtimeCreatorIds?: string[];

  /** True for a shift created to cover accounts released by someone else's leave. */
  isOvertime?: boolean;

  /** The coverage offer this shift was created from, when `isOvertime`. */
  coverageOfferId?: string | null;

  /**
   * False for accounts picked up *inside* an existing shift's hours: the agent
   * keeps the sales but earns no additional hours and the accounts do not raise
   * the wage tier. Defaults to true when absent.
   */
  paysWage?: boolean;
}

// ─── Chat-agent salary ───────────────────────────────────────────────
// The money surface for CA Portal. Every figure an agent sees is *derived* on
// read from these collections plus `shifts` and `time_entries` — nothing here
// stores a computed salary except `ca-salary-months`, which exists precisely to
// freeze one. See documentation/ca-salary.md.

/** `ca-sales/{saleId}` — one imported sale row. The id is a content hash; see `salesImport.ts`. */
export interface CaSaleDocument {
  saleId: string;
  /** Resolved at import time from the export's `Email` column. */
  userId: string;
  /** `YYYY-MM-DD` in the salary timezone — the bucketing key. */
  day: string;
  /** `YYYY-MM`, denormalised so a month reads with one range query. */
  month: string;
  occurredAt: Timestamp;
  employeeName: string;
  /** The `@bluurock.com` address the third-party tool still uses. Audit only. */
  sourceEmail: string;
  creatorName: string;
  fanName: string;
  fanId: string;
  grossRevenue: number;
  netRevenue: number;
  /** `grossRevenue`, negated for a reversal. The only column the engine sums. */
  signedGross: number;
  type: string;
  rule: string;
  assignedBy: string;
  status: 'complete' | 'reverse';
  importId: string;
  createdAt: Timestamp;
}

/** `ca-sales-imports/{importId}` — the audit record for one upload. */
export interface CaSalesImportDocument {
  importId: string;
  fileName: string;
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt: Timestamp;
  totalRows: number;
  imported: number;
  duplicates: number;
  skippedRows: number;
  /** Grouped by reason, so an unmapped address reports once with a count. */
  skipped: Array<{ reason: string; detail: string; rowCount: number; sampleRows: number[] }>;
  monthsTouched: string[];
  perUser: Array<{ userId: string; displayName: string; sourceEmail: string; gross: number; rows: number }>;
  rejectedFinalizedMonths: string[];
}

/**
 * `ca-salary-overrides/{userId}_{day}` — an admin's edits to one day.
 *
 * Sparse by design: only the fields actually edited are present, and each keeps
 * who set it and why. The engine recomputes everything downstream of an
 * override, so this document is an *instruction*, not a snapshot — it survives
 * a re-import, a rate change and a corrected shift.
 */
export interface CaSalaryOverrideDocument {
  userId: string;
  day: string;
  month: string;
  fields: Partial<
    Record<
      'grossEarnings' | 'hours' | 'accountCount' | 'hourlyRate' | 'commissionPercent' | 'commission' | 'wage' | 'salary',
      { value: number; setBy: string; setByName?: string; setAt: Timestamp; reason?: string }
    >
  >;
  note?: string | null;
  updatedAt: Timestamp;
}

/**
 * `ca-salary-months/{userId}_{month}` — the payout record.
 *
 * Absent while a month is open. Written when an admin finalises: the derived
 * figures are frozen into `days` and `totals`, and later sales for that month
 * are refused. Reopening keeps the document and appends to `history`, so what
 * was actually paid stays answerable.
 */
export interface CaSalaryMonthDocument {
  userId: string;
  month: string;
  status: 'finalized' | 'reopened';
  finalizedAt: Timestamp | null;
  finalizedBy: string | null;
  finalizedByName: string | null;
  /** The frozen day rows, serialised exactly as the engine produced them. */
  days: unknown[];
  totals: {
    grossEarnings: number;
    netEarnings: number;
    commission: number;
    wage: number;
    salary: number;
    hours: number;
    daysWorked: number;
    saleCount: number;
  };
  history: Array<{ action: 'finalized' | 'reopened'; by: string; byName: string; at: Timestamp; reason?: string }>;
  updatedAt: Timestamp;
}

/** `ca-salary-config/current` — the rate tables, editable by an admin without a deploy. */
export interface CaSalaryConfigDocument {
  deductionRate: number;
  commissionTiers: Array<{ minGross: number; percent: number }>;
  /** Account count → $/hour, keyed by the count as a string (Firestore map keys are strings). */
  wageTiers: Record<string, number>;
  graceMinutes: number;
  defaultShiftHours: number;
  wageRateBasis: 'per-shift' | 'per-day';
  updatedBy: string | null;
  updatedByName: string | null;
  updatedAt: Timestamp;
}

/**
 * `ca-coverage-offers/{offerId}` — one creator account, on one date, needing cover.
 *
 * Created automatically when an admin approves leave: the absent agent's shift
 * occurrence is tombstoned and each assigned creator becomes an offer. Agents
 * claim; an admin confirms a claim, which creates the overtime shift and moves
 * the offer to `assigned`. One document per creator rather than per shift so two
 * agents can split an absence.
 */
export interface CaCoverageOfferDocument {
  offerId: string;
  /** `YYYY-MM-DD` in the salary timezone. */
  day: string;
  creatorId: string;
  creatorName: string;
  /** The agent whose absence created this offer. */
  originalUserId: string;
  originalShiftId: string;
  /** Window the released shift occupied, ms UTC. */
  windowStart: number;
  windowEnd: number;
  status: 'available' | 'assigned' | 'cancelled';
  /** Claims, keyed by uid. First-come order is kept by `claimedAt`. */
  claims: Record<string, { claimedAt: Timestamp; note?: string }>;
  assignedTo: string | null;
  assignedShiftId: string | null;
  /** True when the assignment sits inside the claimant's own shift — sales only, no extra wage. */
  assignedInShift: boolean;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  leaveId: string | null;
}

// ─── Screenshots ─────────────────────────────────────────────────────

export interface ScreenshotDocument {
  userId: string;
  timestampUTC: Timestamp;
  storagePath: string;
  thumbnailPath: string;
  captureGroup: string; // shared ID to group multi-screen captures
  screenIndex: number;  // 0-based index of this screen in the capture group
  activityPercent?: number | null; // % of 1-min slots with input between this and previous screenshot
}

// ─── Analytics rollups ───────────────────────────────────────────────

/** Segment state codes used in AnalyticsDailyDocument.segments (compact form). */
export const SEG_WORKING = 0;
export const SEG_IDLE    = 1;
export const SEG_BREAK   = 2;
export const SEG_PAUSE   = 3;

export type SegmentCode = 0 | 1 | 2 | 3;

/** [startMs, endMs, stateCode] — a decoded timeline entry. */
export type CompactSegment = [number, number, SegmentCode];

/** [startMs, endMs] — a decoded session boundary. */
export type SessionBound = [number, number];

/**
 * Firestore cannot store nested arrays, so `segments` and `sessionBounds` are
 * persisted FLAT and decoded on read.
 *   segments      → [start, end, code, start, end, code, …]  (stride 3)
 *   sessionBounds → [start, end, start, end, …]              (stride 2)
 */
export function decodeSegments(flat: number[] | undefined): CompactSegment[] {
  const out: CompactSegment[] = [];
  if (!flat) return out;
  for (let i = 0; i + 2 < flat.length; i += 3) {
    out.push([flat[i], flat[i + 1], flat[i + 2] as SegmentCode]);
  }
  return out;
}

export function decodeSessionBounds(flat: number[] | undefined): SessionBound[] {
  const out: SessionBound[] = [];
  if (!flat) return out;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    out.push([flat[i], flat[i + 1]]);
  }
  return out;
}

/**
 * analytics_daily/{userId}_{YYYY-MM-DD} — one precomputed doc per user per
 * LOCAL day, written nightly by the `rollupDailyAnalytics` Cloud Function.
 *
 * Exists because no Firestore index supports querying `time_entries` without
 * `userId`, so company-wide analytics would otherwise fan out across every user.
 *
 * Aggregation rules (important):
 * - Every seconds/count field is SUMMABLE across users and days.
 * - Means are NEVER stored — store sum+count (`activitySum`/`activityCount`)
 *   and divide at read time, because means don't sum.
 * - Distributions are stored as histograms, which DO sum.
 * - `segments` lets schedule adherence be recomputed at read time against
 *   expanded shifts, so editing a shift never requires a rollup recompute.
 */
export interface AnalyticsDailyDocument {
  version: 1;
  userId: string;
  date: string;              // YYYY-MM-DD in the user's OWN timezone
  timezone: string;
  groupsSnapshot: string[];  // audit only — filtering uses CURRENT membership
  computedAt: Timestamp;

  // Core time (seconds)
  workingSeconds: number;
  idleSeconds: number;
  breakSeconds: number;
  /**
   * Derived from the event log, NOT copied from the ledger. The ledger's own
   * `pauseSeconds` under-reports: parseBuffer discards `pauseStart` on `resume`
   * without accumulating it, so it only ever counts a pause that was never
   * resumed. working/idle/break match the ledger exactly; only this differs.
   */
  pauseSeconds: number;
  /** Synthetic sleep-gap pauses — a SUBSET of pauseSeconds, not additional. */
  asleepSeconds: number;
  /** Last clock-out − first clock-in across the day's sessions. */
  clockedSpanSeconds: number;
  /** Span of interrupted sessions with no eventLog — time we cannot classify. */
  unknownSeconds: number;
  sessionCount: number;
  firstClockInMs: number | null;
  lastClockOutMs: number | null;

  // Activity
  /** Number of CAPTURES, deduped by captureGroup — not screen images. */
  screenshotCount: number;
  activitySum: number;
  activityCount: number;
  /** 10 deciles (0-9, 10-19, … 90-100). Histograms sum, so this survives aggregation. */
  activityHistogram: number[];

  // Timeline — stored flat (Firestore has no nested arrays); use decodeSegments()
  segments: number[];
  /**
   * Flat [startMs, endMs] pairs per session — what schedule-adherence needs
   * (clock-in times), which the merged `segments` array alone cannot express.
   * Use decodeSessionBounds().
   */
  sessionBounds: number[];
  /** 24 entries — working seconds per LOCAL hour. */
  hourBuckets: number[];

  // Focus
  focusBlockCount: number;
  focusSecondsInBlocks: number;
  longestFocusBlockSeconds: number;
  interruptionCount: number;

  // Wellbeing
  breakAllowanceSeconds: number;
  noBreakDay: boolean;

  // Provenance
  /** True if any session lacked an eventLog — the day's numbers may still move. */
  hasIncompleteLog: boolean;
  hasManualEntry: boolean;
  sessionIds: string[];
}

/** analytics_dirty/{userId}_{YYYY-MM-DD} — recompute queue drained by the CF. */
export interface AnalyticsDirtyDocument {
  userId: string;
  date: string;
  markedAt: Timestamp;
  reason: string;
}

// ─── Disputes ────────────────────────────────────────────────────────

export type ApprovalStatus = 'Pending' | 'Approved' | 'Rejected';

/** Serialised shape returned from the disputes API (Timestamps converted to ISO strings) */
export interface DisputeDocument {
  id: string;
  createdAt: string | null;
  assignedTo: string;              // UID or 'No One'
  assignedToName: string;          // resolved from users.displayName or 'No One'
  assignedToPhotoURL: string | null;
  CaApproval: ApprovalStatus;
  AdminApproval: ApprovalStatus;
  Creator: string;                 // creatorID (raw)
  creatorName: string;             // resolved from creators.stageName
  creatorPhotoURL: string | null;
  saleDate: string | null;         // UTC ISO string — convert to user tz on display
  saleAmount: number;
  fanName: string;
  Comment: string;
  createdBy: string;               // UID
  createdByName: string;           // resolved from users.displayName
  createdByPhotoURL: string | null;
}

export interface CreatorDocument {
  creatorID: string;
  stageName: string;
}

export interface CreatorFullDocument {
  uid: string;
  creatorID: string;        // same as uid
  stageName: string;
  userEmail: string;
  displayName: string;      // same as stageName
  photoURL: string | null;
  photoStoragePath: string | null;
  /**
   * 64px WebP as a `data:` URI, derived from the stored photo by
   * `creatorPhotoService`. Inlined on the doc so the roster endpoint can deliver
   * every avatar in one response — see rule 9's indexing note: this field is
   * exempted in `firestore.indexes.json` because nothing queries it.
   */
  photoThumb: string | null;
  OFID: string;             // '@handle' format
  isActive: boolean;
  isArchived: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  driveLink?: string;
  lastCRID?: number;
}

/**
 * `creator-subaccounts/{subAccountId}` — a second account belonging to a creator.
 *
 * A creator often runs more than one account (Cole on OnlyFans, "Cole (Fansly)"
 * on Fansly). For **shift assignment and pay these are peers**: one agent can be
 * assigned to Cole and a different agent to Cole (Fansly), and each counts as
 * one account toward the assignee's hourly wage tier.
 *
 * ## Why this is not a `creators` document
 *
 * A `creators` doc id **is a Firebase Auth uid** — creators sign into the
 * Telegram Mini App with it. A sub-account is an *account a person owns*, not a
 * person: it has no login, no Telegram binding and no portal. Modelling one as a
 * creator would mint an auth identity for something that can never use it, and
 * put it in the creator portal's own roster.
 *
 * ## One id space, deliberately
 *
 * Sub-account ids are Firestore auto-ids and creator ids are auth uids, so the
 * two can never collide. That is what lets `shifts.creatorIds` hold either kind
 * without a discriminator, and why the salary engine needed no change at all:
 * it counts ids, and a sub-account is simply another id.
 */
export interface CreatorSubAccountDocument {
  subAccountId: string;
  /** The `creators` doc that owns this account. */
  parentCreatorId: string;
  /** What distinguishes it from the parent — "Fansly", "VIP". */
  label: string;
  /** The displayed name, e.g. "Cole (Fansly)". Derived from the parent + label at write time. */
  stageName: string;
  /** '@handle' on the sub-account's own platform, when it has one. */
  OFID?: string;
  /**
   * Its own avatar, when it has one. Absent means it inherits the parent's —
   * resolved on read, so a parent's new photo flows to every sub-account that
   * never set its own.
   */
  photoURL?: string | null;
  photoThumb?: string | null;
  photoStoragePath?: string | null;
  isArchived: boolean;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Content Planning ────────────────────────────────────────────────

export interface ContentPlanningDescription {
  qty: string;
  content: string;
}

export interface ContentPlanningDocument {
  contentType: 'SFW' | 'NSFW';
  contentSummary: string;
  description: ContentPlanningDescription[];
  comment: string;
  dueDate: Timestamp;
  createdAt: Timestamp;
  completedAt: Timestamp | null;
  lastEditedAt: Timestamp | null;
  lastEditedBy: string | null;
  status: 'Outstanding' | 'Completed';
  creatorID: string;
  isArchived: boolean;
}

// ─── SMM Portal (Twitter/X) ──────────────────────────────────────────

export const SMM_ACCOUNT_TYPES = [
  'Twink', 'Twunk', 'Hunk/Jock', 'Couple', 'Daddy',
  'Artist', 'Animator', 'SFS', 'Upload', 'Bonus',
] as const;
export type SmmAccountType = typeof SMM_ACCOUNT_TYPES[number];

export const SMM_NETWORKS = ['Inhouse', 'X Managed', 'Twink', 'Other'] as const;
export type SmmNetwork = typeof SMM_NETWORKS[number];

export type SmmTier = 1 | 2;
export type SmmAccountStatus = 'active' | 'inactive';

/** Only accounts whose `type` contains this may hold a tier or submit for a bonus. */
export const SMM_BONUS_TYPE = 'Bonus';
export const isBonusAccountType = (type: string[] | undefined | null): boolean =>
  (type ?? []).includes(SMM_BONUS_TYPE);

/** Submission status values — single source of truth for these emoji-bearing
 * strings, which are compared for equality to drive bonus logic and badges. */
export const SMM_SUBMISSION_STATUSES = ['✅ Qualified', '❌ Late submission'] as const;
export type SmmSubmissionStatus = typeof SMM_SUBMISSION_STATUSES[number];
export const SMM_STATUS_QUALIFIED: SmmSubmissionStatus = SMM_SUBMISSION_STATUSES[0];
export const SMM_STATUS_LATE: SmmSubmissionStatus = SMM_SUBMISSION_STATUSES[1];

export type SmmAdminApproval = 'pending' | 'approved' | 'rejected';

/** Serialised twitterx-accounts doc (Timestamps converted to ISO strings) */
export interface SmmAccount {
  id: string;
  accountName: string;
  accountLink: string;
  type: string[];                    // multi-select of SMM_ACCOUNT_TYPES
  network: SmmNetwork;
  /** null unless `type` contains 'Bonus' — only bonus accounts are tiered. */
  tier: SmmTier | null;
  /** true when SMMs may copy viral posts from this account (Viral Accounts page). */
  isViralBonus: boolean;
  /** uid of the SMM whose page suggestion added this account — earns the $2 share. */
  suggestedBy: string | null;
  suggestedByName?: string;          // resolved server-side (viral + admin scopes)
  suggestedByPhotoURL?: string | null;
  assigned: string | null;           // uid, single value
  assignedName?: string;             // resolved server-side (admin scope only)
  assignedPhotoURL?: string | null;
  driveLink: string;
  comments: string;
  information: string;
  status: SmmAccountStatus;
  lastUpdatedTime: string | null;
  lastUpdatedBy: string;
  lastUpdatedByName?: string;        // resolved server-side (admin scope only)
}

/** Serialised twitterx-content-schedule/{accountId}/posts doc */
export interface SmmPost {
  id: string;
  accountId: string;                 // derived from the parent doc ref
  accountName: string;               // denormalized from twitterx-accounts
  caption: string;
  postDate: string | null;
  postLink: string;
  postedBy: string;                  // uid
  postedByName?: string;             // resolved server-side (admin content schedule)
  postedByPhotoURL?: string | null;
  createdTime: string | null;
  bonusSubmission: boolean;          // true once the post has been submitted for a bonus
  /**
   * Viral-copy declaration, captured (and server-verified) when the post is
   * scheduled — NOT when a bonus is applied for. A post flagged here has its
   * bonus halved at submission time.
   */
  isViralCopy: boolean;
  originalLink: string;              // '' unless isViralCopy
  originalAcc: string;               // twitterx-accounts id, '' unless isViralCopy
  /**
   * The creator page the content was uploaded FROM (a twitterx-accounts id).
   * Drives the network bonus and the suggester's share — both are properties
   * of the source creator, not of the page the SMM posted on.
   */
  sourceAcc: string;
  sourceAccName: string;             // denormalized for tables/dialogs
}

/** Serialised twitterx-bonus round doc (userTotals delivered separately per scope) */
export interface SmmBonusRound {
  id: string;
  roundDateStart: string | null;
  roundDateEnd: string | null;
}

/** Serialised twitterx-bonus/{roundId}/submissions doc */
export interface SmmSubmission {
  id: string;
  roundId: string;
  postLink: string;
  accountName: string;
  originalLink: string;              // '' when not a viral copy
  originalAcc: string;               // accountId, '' when not a viral copy
  submittedBy: string;               // uid
  submittedByName?: string;          // resolved server-side (admin scope only)
  submittedByPhotoURL?: string | null;
  screenshotLink: string;
  postDate: string | null;
  submissionDate: string | null;
  numLikes: number;
  status: SmmSubmissionStatus;
  network: SmmNetwork;               // frozen from the SOURCE creator page
  sourceAcc: string;                 // frozen source creator account id
  sourceAccName: string;             // frozen source creator name
  tier: SmmTier;                     // frozen from the posting page
  bonusAmount: number;               // dollars, may be fractional
  sysComments: string;               // '\n'-joined system comment lines
  adminApproval: SmmAdminApproval;
  isResidual: boolean;               // auto-created share (rule 3️⃣) — not filed by its recipient
}

/**
 * The full search behind the "Did you copy another viral post?" card's result
 * screen — every record found for the pasted link, categorized by what it
 * means, not just the single newest one the eligibility verdict needs.
 */
export interface ViralLinkReport {
  /** The post whose OWN postLink matches the pasted link — the original
   *  itself, if it was ever scheduled through this system. Null when the
   *  original was never posted here (e.g. it lives on a page the team
   *  doesn't manage). */
  originalPost: SmmPost | null;
  /** Other posts that declared this link as THEIR originalLink — siblings
   *  that also copied the same source, not the source itself. */
  copies: SmmPost[];
  /** Bonus submissions filed against this link as their originalLink. */
  submissions: SmmSubmission[];
}

/** Serialised twitterx-page-suggestions doc — an SMM nominating a viral account */
export interface SmmPageSuggestion {
  id: string;
  accountName: string;               // handle extracted from accountLink
  accountLink: string;
  submittedBy: string;               // uid
  submittedByName?: string;          // resolved server-side
  submittedByPhotoURL?: string | null;
  submissionDate: string | null;
  isApproved: boolean;
  isRejected: boolean;
}

// ─── Growth Tracking (smm-growth-tracking) ───────────────────────────
//
// Deliberately unrelated to SmmAccount / twitterx-accounts: no shared ids, no
// joins. See documentation/growth-tracking.md.

/** One day's reading for one account. Only `followers` is guaranteed. */
export interface GrowthSnapshot {
  followers: number;
  /**
   * Which scraper produced this reading.
   *
   * `profile` = the nightly `apidojo/twitter-user-scraper` or
   * `apify/facebook-pages-scraper` run. `post` = the follower count that rode
   * along inside a tweet result (see growthPostsService). Absent on the two
   * months of hand-collected history, which predate both.
   *
   * This exists so a day's number can be traced to its source after the fact.
   * Without it the two feeds are indistinguishable once written, and mixing
   * sources into one series becomes irreversible.
   */
  src?: 'profile' | 'post';
  // Facebook extras — returned inside the same billed result, so free.
  likes?: number;
  rating?: number;
  ratingCount?: number;
  // X extras — likewise free.
  following?: number;
  posts?: number;
  media?: number;
  favourites?: number;
}

/** Serialised growth-accounts/{platform}_{handleNormalized} doc */
export interface GrowthAccount {
  id: string;
  platform: 'facebook' | 'twitter';
  /**
   * The account's own handle, as the platform spells it. This is the only name
   * the subsystem has — there is no separate display name, so every surface
   * refers to an account by this, and it is the seed for the avatar fallback.
   */
  handle: string;
  handleNormalized: string;
  profileUrl: string;
  /**
   * The operational grouping this account belongs to (TWXNK, BONUS, CREATOR,
   * SFW REPOST, FACEBOOK) — a closed vocabulary, see `src/lib/growth/category.ts`.
   * `null` for an account nobody has filed yet. NOT part of the identity: the
   * document id is platform + handle, so a category can be corrected freely.
   */
  category: import('@/lib/growth/category').GrowthCategory | null;
  /**
   * The platform's own numeric account id, when the scraper reports one — X's
   * `id` (rest id) and, where present, the Facebook page id. It rides inside the
   * already-billed profile result, so storing it costs nothing extra, and it is
   * the one handle-independent way to search for an account: a renamed account
   * keeps this and loses its handle.
   */
  platformAccountId: string | null;
  /** false = tracking stopped. History is retained; the account can be resumed. */
  isActive: boolean;
  profilePictureUrl: string | null;
  isVerified: boolean;
  /** Most recent reading, denormalized so a list renders without a series read. */
  latest: (GrowthSnapshot & { date: string }) | null;
  /** The reading before `latest`, so a day-over-day delta needs no series read. */
  previous: (GrowthSnapshot & { date: string }) | null;
  lastScrapeAt: string | null;
  lastScrapeStatus: 'ok' | 'failed' | null;
  lastScrapeError: string | null;
  /**
   * Post-level tracking opt-in. When true the nightly discovery pass asks the
   * tweet scraper for this account's ~20 newest posts and starts tracking them.
   * Off by default: it is a separate, per-account line on the bill.
   */
  trackPosts: boolean;
  /** Last time the discovery pass ran for this account. */
  lastPostDiscoveryAt: string | null;
  lastPostDiscoveryStatus: 'ok' | 'failed' | null;
  lastPostDiscoveryError: string | null;
  /**
   * True when the last discovery filled its ~20-result window entirely with
   * posts under a day old — meaning this account posts faster than one nightly
   * read can see, and posts are being missed. Surfaced in the manage tab.
   */
  postsWindowSaturated: boolean;
  addedBy: string;
  addedTime: string | null;
}

/** Serialised growth-accounts/{id}/series/{YYYY} doc, flattened for the client. */
export interface GrowthSeries {
  accountId: string;
  /** Day key (`YYYY-MM-DD`) → reading, merged across every year document. */
  days: Record<string, GrowthSnapshot>;
}

// ─── Growth Tracking: post analytics ─────────────────────────────────
//
// Individual X post engagement, collected by /api/cron/growth-posts. Separate
// from GrowthSnapshot because the two answer different questions and are read
// on different cadences: an account is read once a night, a fresh post several
// times a day. See documentation/growth-tracking.md.

/**
 * One reading of one post. Every field arrives inside the same billed scraper
 * result, so storing all of them costs exactly what storing one would.
 *
 * A metric the scraper omitted is **absent, never 0** — X does not report views
 * or bookmarks consistently, and a zero would draw a cliff to the axis and read
 * as "engagement collapsed".
 */
export interface GrowthPostSnapshot {
  likes?: number;
  reposts?: number;
  replies?: number;
  quotes?: number;
  views?: number;
  bookmarks?: number;
  /**
   * The author's follower count at the moment this post was read — free inside
   * the same result.
   *
   * ═══ NEVER WRITTEN INTO THE FOLLOWER SERIES ═══
   * `growth-accounts/{id}/series` is fed exclusively by the nightly profile
   * scrape. This number comes from a different actor on a different cadence and
   * may be cached by the search index; mixing the two sources would corrupt two
   * months of hand-collected history with values nobody can audit afterwards.
   * It is shown on the post, and that is all it is for.
   */
  authorFollowers?: number;
}

/** Where a tracked post came from — decides what stopping it means. */
export type GrowthPostSource = 'manual' | 'account';

/** Serialised growth-posts/{tweetId} doc. */
export interface GrowthPost {
  /** The tweet id — also the document id, and the value sent as `tweetIDs`. */
  id: string;
  url: string;
  /** Author handle as the scraper spells it, or null before the first read. */
  authorHandle: string | null;
  authorHandleNormalized: string | null;
  authorName: string | null;
  authorProfilePictureUrl: string | null;
  authorIsVerified: boolean;
  /** Post text, truncated on write — the link is the source of truth. */
  text: string;
  lang: string | null;
  /** When the post was published (ISO), which drives the whole refresh ladder. */
  postedAt: string | null;
  isReply: boolean;
  isQuote: boolean;
  isRetweet: boolean;
  conversationId: string | null;
  /** Image/video URLs carried in the same result. */
  media: GrowthPostMedia[];
  /** 'manual' = pasted by someone; 'account' = found by the discovery pass. */
  source: GrowthPostSource;
  /** The tracked account that discovered it, when source is 'account'. */
  accountId: string | null;
  /** false = refreshing stopped. History is kept and the post can be resumed. */
  isActive: boolean;
  /** Most recent reading, denormalized so a list renders without extra reads. */
  latest: (GrowthPostSnapshot & { at: string }) | null;
  /** The reading before `latest`, so a velocity needs no history scan. */
  previous: (GrowthPostSnapshot & { at: string }) | null;
  /** Reading key (`YYYY-MM-DDTHH:mm`, UTC) → the metrics read at that moment. */
  history: Record<string, GrowthPostSnapshot>;
  /** When the next scheduled read is due (ISO). Far-future once frozen. */
  nextRefreshAt: string | null;
  lastReadAt: string | null;
  lastReadStatus: 'ok' | 'failed' | null;
  lastReadError: string | null;
  /** Server-enforced manual-sync cooldown — see RULE 4 in the service. */
  lastManualSyncAt: string | null;
  /** How many billed readings this post has cost so far. */
  readCount: number;
  addedBy: string;
  addedTime: string | null;
}

export interface GrowthPostMedia {
  type: string;
  url: string;
}

/** Serialised growth-spend/{YYYY-MM} — the rolling cost breaker's ledger. */
export interface GrowthSpendLedger {
  month: string;
  /** Billed scraper results this month, across every call shape. */
  results: number;
  usd: number;
  runs: number;
  updatedAt: string | null;
}

// ─── Resolved access (returned to client after permission resolution) ─

export interface ResolvedAccess {
  pageId: string;
  title: string;
  teamspaceId: string;
  href: string | null;
  icon: string | null;
  order: number;
  grantedVia: 'user' | 'group';
  grantingGroupId?: string;
}
