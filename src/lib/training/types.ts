import type { SlotId, TrainingModuleId } from './modules';

/**
 * Wire types for the training API — what the browser sees. The Firestore
 * documents are richer (hashes, storage paths); none of that crosses the wire.
 */

export type PartState =
  /** Not open yet — the candidate sees a countdown to `opensAtMs`. */
  | 'scheduled'
  /** Open and not started. */
  | 'open'
  | 'in-progress'
  /** Finished early or with every slot in. */
  | 'submitted'
  /** The clock ran out. Whatever was uploaded in time is kept. */
  | 'timed-out'
  /** The session closed before it was started. */
  | 'missed'
  /** Open, but the admin has not attached the source images yet. */
  | 'not-ready';

export interface PartSummary {
  id: string;
  title: string;
  summary: string;
  durationMs: number;
  opensAtMs: number;
  state: PartState;
  /** Set while `in-progress`. */
  deadlineMs?: number;
}

export interface SessionSummary {
  id: string;
  label: string;
  moduleId: TrainingModuleId;
  closesAtMs: number;
  parts: PartSummary[];
}

export interface MeResponse {
  /** Server clock, so the client can correct for a wrong device clock. */
  nowMs: number;
  email: string;
  name: string | null;
  sessions: SessionSummary[];
}

export interface SourceView {
  id: string;
  name: string;
  /** Small preview for the grid. */
  thumbUrl: string;
  /** Full-size original, signed as an attachment so it saves rather than opens. */
  downloadUrl: string;
}

export interface SlotView {
  slotId: SlotId;
  sourceId: string;
  uploadedAtMs: number;
  bytes: number;
  /** Signed read URL for the candidate's own upload. */
  url: string;
}

export interface AttemptView {
  startedAtMs: number;
  deadlineMs: number;
  finishedAtMs: number | null;
  /**
   * The attempt is screen-recorded: edit uploads are refused while no recent
   * segment has arrived, so the page must hold a live screen share. False only
   * for attempts started before recording existed.
   */
  recording: boolean;
  slots: SlotView[];
}

/** Signed PUT URLs for the next segments of the recording, in order. */
export interface RecordingSlots {
  slots: { seq: number; url: string }[];
}

export interface PartResponse {
  nowMs: number;
  session: { id: string; label: string; closesAtMs: number };
  part: PartSummary;
  /** Present only once the attempt is in progress. Never on the briefing. */
  sources?: SourceView[];
  attempt?: AttemptView;
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export interface AdminSessionRow {
  id: string;
  label: string;
  moduleId: TrainingModuleId;
  createdAtMs: number;
  closesAtMs: number;
  participantCount: number;
  firstOpensAtMs: number;
}

export interface AdminPartState {
  opensAtMs: number;
  sources: { id: string; name: string; thumbUrl: string }[];
}

export interface AdminParticipantPart {
  state: PartState;
  startedAtMs: number | null;
  deadlineMs: number | null;
  finishedAtMs: number | null;
  /** Set when an admin reopened this attempt. */
  reopenedAtMs: number | null;
  slotsFilled: number;
}

export interface AdminParticipant {
  emailHash: string;
  email: string;
  name: string | null;
  addedAtMs: number;
  revokedAtMs: number | null;
  parts: Record<string, AdminParticipantPart>;
}

export interface AdminSessionDetail {
  nowMs: number;
  session: {
    id: string;
    label: string;
    moduleId: TrainingModuleId;
    createdAtMs: number;
    closesAtMs: number;
    parts: Record<string, AdminPartState>;
  };
  participants: AdminParticipant[];
}

export interface AdminSubmissionView {
  startedAtMs: number | null;
  finishedAtMs: number | null;
  slots: {
    slotId: SlotId;
    sourceId: string;
    uploadedAtMs: number;
    bytes: number;
    url: string;
  }[];
  /** Only the images this candidate actually used. */
  sources: { id: string; name: string; thumbUrl: string }[];
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
  /** The part is running: new segments are still arriving. */
  live: boolean;
  /** False for an attempt started before recording existed. */
  recorded: boolean;
  startedAtMs: number | null;
  /** Set when an admin reopened the attempt: the time before it is between runs, not a gap. */
  reopenedAtMs: number | null;
  /** When the attempt ends or ended: finished early, the deadline, or the session's stop — whichever came first. */
  endsAtMs: number | null;
  deletedAtMs: number | null;
  /** The still the candidate's browser grabbed at the screen check. Omitted on an `after` read. */
  check?: { atMs: number; url: string } | null;
  /** Only those after the `after` cursor when one was sent. */
  segments: AdminRecordingSegment[];
}

// ─── Admin: candidates across sessions ───────────────────────────────────────

/** A candidate's standing: the state of their most pressing part, or removal. */
export type CandidateStatus = PartState | 'removed';

export interface AdminCandidateRow {
  emailHash: string;
  email: string;
  /** Null until they have signed in and given their name. */
  name: string | null;
  status: CandidateStatus;
  /** What the status is about, e.g. "ID Swap (SFW) · October intake". Empty when removed. */
  statusDetail: string;
  /** Sessions they are currently on (not removed). */
  sessionCount: number;
  partsSubmitted: number;
  partsTotal: number;
  /** Latest sign of life: an upload, a start, a finish, or when they were added. */
  lastActivityMs: number;
}

export interface AdminCandidatePart {
  partId: string;
  state: PartState;
  startedAtMs: number | null;
  deadlineMs: number | null;
  finishedAtMs: number | null;
  reopenedAtMs: number | null;
  slots: AdminSubmissionView['slots'];
  sources: AdminSubmissionView['sources'];
}

export interface AdminCandidateSession {
  sessionId: string;
  label: string;
  moduleId: TrainingModuleId;
  /** When the session was created — what "newest first" sorts on. */
  createdAtMs: number;
  addedAtMs: number;
  revokedAtMs: number | null;
  closesAtMs: number;
  parts: AdminCandidatePart[];
}

export interface AdminCandidateDetail {
  email: string;
  name: string | null;
  /** Newest session first. */
  sessions: AdminCandidateSession[];
}
