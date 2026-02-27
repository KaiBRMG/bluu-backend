import { Timestamp } from 'firebase/firestore';

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
  workEmail: string;
  displayName: string;
  photoURL?: string;
  firstName: string;
  lastName: string;
  groups: string[];
  createdAt: Timestamp;
  lastLoginAt: Timestamp;
  isActive: boolean;
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
  timeTracking?: boolean;
  hasPaidLeave?: boolean;
  includeIdleTime?: boolean;
  enableScreenshots?: boolean;

  // Denormalized: page IDs this user can access (kept in sync by server on group/permission changes)
  permittedPageIds?: string[];
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
  includeIdleTime: boolean;
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
