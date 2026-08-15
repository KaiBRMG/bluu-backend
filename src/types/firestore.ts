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
  /** Google's stable account id (`sub`), recorded on login. Survives renames. */
  googleSub?: string | null;
  /** Set when the user moved off their @bluurock.com address. */
  emailMigratedAt?: Timestamp;
  /** The company address they migrated away from. Audit only. */
  previousWorkEmail?: string | null;
  isActive: boolean;
  isArchived?: boolean;
  role?: 'admin' | 'member';

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
    telegramHandle?: string;
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

  // Installed desktop app build, reported once per app start by the renderer
  // (see AppVersionReporter) and only written when it actually changes.
  appVersion?: string | null;
  appPlatform?: string | null; // darwin / win32
  appVersionUpdatedAt?: Timestamp;

  // Release note (APP_UPDATE.releaseNote) this user has already been sent, so a
  // "what's new" notification reaches each user once per release and never again.
  // Absent = never notified. Written only by /api/user/app-version.
  releaseNoteNotifiedVersion?: string | null;

  // Single active session enforcement: rotated on every login.
  // Client stores this locally; onSnapshot detects a mismatch and forces sign-out.
  sessionToken?: string;

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
  recipientCount: number;
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
  OFID: string;             // '@handle' format
  isActive: boolean;
  isArchived: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  driveLink?: string;
  lastCRID?: number;
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
