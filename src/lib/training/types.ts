import type { DatasetId, TestId, TrainingModuleId } from './modules';

/**
 * Wire types for the training API — what the browser sees. The Firestore
 * documents are richer (hashes, storage paths, Drive ids); none of that crosses
 * the wire.
 */

/** The admin's switch on one test. `preparing` = files are being copied from Drive. */
export type TestStatus = 'closed' | 'preparing' | 'open';

/** Where one test stands for one candidate. Derived on read — no cron flips it. */
export type TestState =
  /** Not open (never opened, or being prepared). */
  | 'locked'
  /** Open, and this candidate has not started it. */
  | 'open'
  | 'in-progress'
  /** Finished early or with every slot in. */
  | 'submitted'
  /** The clock ran out (or the module was switched off). Whatever was uploaded in time is kept. */
  | 'timed-out'
  /** The test was closed before this candidate started it. */
  | 'missed';

/** Whether a stored file has reached the Drive mirror. */
export type MirrorState = 'synced' | 'pending' | 'failed';

export interface TestSummary {
  id: TestId;
  title: string;
  durationMs: number;
  state: TestState;
  /** Set while `in-progress`. */
  deadlineMs?: number;
}

export interface ModuleSummary {
  id: TrainingModuleId;
  title: string;
  blurb: string;
  openTestId: TestId | null;
  tests: TestSummary[];
}

export interface MeResponse {
  /** Server clock, so the client can correct for a wrong device clock. */
  nowMs: number;
  email: string;
  name: string | null;
  /** Modules that are switched on and that this person is on. Empty = nothing is running. */
  modules: ModuleSummary[];
}

/** One module for one candidate — what `/training/<module>` shows and polls. */
export interface ModuleResponse {
  nowMs: number;
  /** The candidate's own address, as typed by the admin — shown beside their name in the header. */
  email: string;
  name: string | null;
  module: ModuleSummary;
}

export interface SourceView {
  /** The Drive file id — opaque and stable. */
  id: string;
  name: string;
  /** The edit slot this source belongs to (`edit` tests), matched by its code. */
  slotId?: string;
  /** The source group (`generate`: Candid SFW / Teasy / Explicit). */
  group?: string;
  /** Small preview for the grid. */
  thumbUrl: string;
  /** Full-size original, signed as an attachment so it saves rather than opens. */
  downloadUrl: string;
  width: number;
  height: number;
}

export interface SlotView {
  slotId: string;
  uploadedAtMs: number;
  bytes: number;
  /** Signed read URL for the candidate's own upload. */
  url: string;
}

export interface WorkingFileView {
  id: string;
  name: string;
  bytes: number;
  uploadedAtMs: number;
}

export interface AttemptView {
  attemptId: string;
  startedAtMs: number;
  deadlineMs: number;
  finishedAtMs: number | null;
  /**
   * The attempt is screen-recorded: final-image uploads are refused while no
   * recent segment has arrived, so the page must hold a live screen share.
   */
  recording: boolean;
  slots: SlotView[];
  workingFiles: WorkingFileView[];
  /** The task record, as last autosaved. */
  text: string;
  textUpdatedAtMs: number | null;
  /** T4: the identity chosen for each slot. */
  datasetChoices: Record<string, DatasetId>;
}

export interface TestResponse {
  nowMs: number;
  module: { id: TrainingModuleId; title: string };
  test: TestSummary;
  /** Present only once the attempt is in progress. Never on the briefing. */
  sources?: SourceView[];
  attempt?: AttemptView;
}

/** One identity's images, for the dataset modal. Only while the attempt is in progress. */
export interface DatasetView {
  id: DatasetId;
  label: string;
  images: { id: string; name: string; thumbUrl: string; downloadUrl: string }[];
}

export interface DatasetsResponse {
  nowMs: number;
  datasets: DatasetView[];
}

/**
 * T7: every image shown so far, each with the answer saved for it. Nothing beyond `revealed` is
 * signed or sent, so the candidate cannot look ahead; everything up to it stays, so they can go back.
 */
export interface SequenceResponse {
  nowMs: number;
  count: number;
  /** The recommended pace — the test's time is `count × perImageMs`, on the attempt's one clock. */
  perImageMs: number;
  deadlineMs: number;
  images: { index: number; imageUrl: string; answer: string }[];
}

/** Signed PUT URLs for the next segments of the recording, in order. */
export interface RecordingSlots {
  slots: { seq: number; url: string }[];
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export interface AdminModuleRow {
  id: TrainingModuleId;
  title: string;
  isOn: boolean;
  openTestId: TestId | null;
  participantCount: number;
}

export interface AdminTestRow {
  id: TestId;
  title: string;
  durationMs: number;
  slotCount: number;
  status: TestStatus;
  openedAtMs: number | null;
  closedAtMs: number | null;
  /** Copy problems that stop this test being opened — see `TestDef.pending`. */
  pending: string[];
}

export interface AdminAttemptCell {
  state: TestState;
  startedAtMs: number | null;
  deadlineMs: number | null;
  finishedAtMs: number | null;
  /** Set when an admin reopened this attempt. */
  reopenedAtMs: number | null;
  /** Set when an admin ended this attempt early (cleared by a reopen). */
  endedByAdminAtMs: number | null;
  slotsFilled: number;
  slotsTotal: number;
  /** The worst Drive mirror state across this attempt's files; null when it has none. */
  mirror: MirrorState | null;
}

export interface AdminParticipant {
  emailHash: string;
  email: string;
  name: string | null;
  addedAtMs: number;
  revokedAtMs: number | null;
  tests: Partial<Record<TestId, AdminAttemptCell>>;
}

export interface AdminModuleDetail {
  nowMs: number;
  module: { id: TrainingModuleId; title: string; isOn: boolean; openTestId: TestId | null };
  tests: AdminTestRow[];
  participants: AdminParticipant[];
}

export interface AdminSubmissionView {
  startedAtMs: number | null;
  finishedAtMs: number | null;
  slots: {
    slotId: string;
    label: string;
    stem: string;
    identity: DatasetId | null;
    uploadedAtMs: number;
    bytes: number;
    url: string;
    mirror: MirrorState | null;
    /** The source it started from, when the test has one per slot. */
    source: { name: string; thumbUrl: string } | null;
  }[];
  workingFiles: {
    id: string;
    name: string;
    bytes: number;
    uploadedAtMs: number;
    downloadUrl: string;
    mirror: MirrorState | null;
  }[];
  text: string;
  /** T7: every image in order, with the answer given (null = "No answer"). */
  answers: { index: number; imageUrl: string; text: string | null; atMs: number | null }[] | null;
  /** The candidate's folder for this attempt in the shared drive. Null until something is mirrored. */
  driveUrl: string | null;
}

export interface AdminRecordingSegment {
  seq: number;
  /** When it finished uploading (server clock). It covers roughly the `SEGMENT_MS` before. */
  endedAtMs: number;
  bytes: number;
  url: string;
}

export interface AdminRecordingView {
  nowMs: number;
  /** The test is running: new segments are still arriving. */
  live: boolean;
  /** False for an attempt started before recording existed. */
  recorded: boolean;
  startedAtMs: number | null;
  /** Set when an admin reopened the attempt: the time before it is between runs, not a gap. */
  reopenedAtMs: number | null;
  /** When the attempt ends or ended: finished early, the deadline, or the module's switch-off — whichever came first. */
  endsAtMs: number | null;
  deletedAtMs: number | null;
  /** The still the candidate's browser grabbed at the screen check. Omitted on an `after` read. */
  check?: { atMs: number; url: string } | null;
  /** Only those after the `after` cursor when one was sent. */
  segments: AdminRecordingSegment[];
}

// ─── Admin: Drive materials ──────────────────────────────────────────────────

export interface MaterialFolderCheck {
  key: string;
  label: string;
  /** The folder as an admin would find it in Drive. */
  folder: string;
  unchanged: number;
  /** Not copied, and why — wrong type, no checksum, too big. */
  skipped: { name: string; reason: string }[];
  added: string[];
  changed: string[];
  removed: string[];
}

/** Check Drive: a dry run of what Open would copy, and whether the test has what it needs. Writes nothing. */
export interface MaterialCheck {
  testId: string;
  /** Nothing to copy and nothing missing. */
  upToDate: boolean;
  /** The test can open once its files are copied (no blocking problems). */
  ok: boolean;
  problems: string[];
  folders: MaterialFolderCheck[];
}

export interface SyncTodo {
  key: string;
  driveId: string;
  name: string;
}

export interface SyncPlan {
  todo: SyncTodo[];
  /** Files deleted from Storage because Drive no longer has them. */
  removed: number;
  unchanged: number;
}
