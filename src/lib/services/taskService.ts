import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { htmlToPlainText, sanitizePromptHtml, hasRichFormatting } from '@/lib/promptHtml';
import {
  defaultStatus,
  isAssignableUser,
  isOutstanding,
  isTaskKind,
  isValidDueDate,
  isValidStatus,
  remapStatus,
  type TaskVerdict,
} from '@/lib/taskAccess';
import {
  TASK_TEXT_MAX,
  TASK_TITLE_MAX,
  type BlockingTask,
  type TaskDocument,
  type TaskKind,
  type TaskPayload,
} from '@/types/task';

const TASKS_COLLECTION = 'tasks';

/** Responses are per-user and the page patches its own state after a write — see /api/tasks. */
export const NO_STORE = { 'Cache-Control': 'no-store' };

/** A validated write: any subset of what a client may send. */
export type TaskWrite = Partial<TaskPayload>;

type TaskWriteResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'not-found' | 'forbidden' | 'invalid'; message?: string };

/** Display name of a user doc, for naming who set a task. */
export function nameOf(
  u: { displayName?: string; firstName?: string; lastName?: string } | null
): string | null {
  if (!u) return null;
  return u.displayName || `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || null;
}

/** Can this uid be given a task? A real, active, unarchived employee. */
export async function isAssignable(uid: string): Promise<boolean> {
  const u = await getUserById(uid);
  return !!u && isAssignableUser(u);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function iso(v: any): string {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  return typeof v === 'string' ? v : new Date(0).toISOString();
}

function mapDoc(doc: FirebaseFirestore.DocumentSnapshot): TaskDocument {
  const d = doc.data() ?? {};
  const kind: TaskKind = isTaskKind(d.kind) ? d.kind : 'once-off';
  const html = sanitizePromptHtml(d.textHtml);
  return {
    id: doc.id,
    title: typeof d.title === 'string' ? d.title : '',
    text: typeof d.text === 'string' ? d.text : '',
    textHtml: html || null,
    kind,
    status: isValidStatus(kind, d.status) ? d.status : defaultStatus(kind),
    assigneeUid: typeof d.assigneeUid === 'string' ? d.assigneeUid : '',
    createdBy: typeof d.createdBy === 'string' ? d.createdBy : '',
    createdByName: null,
    dueDate: isValidDueDate(d.dueDate) ? d.dueDate : null,
    blocksClockOut: d.blocksClockOut === true,
    completedAt: typeof d.completedAt === 'string' ? d.completedAt : null,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Validates and normalises a client payload. Returns an error string instead of
 * throwing so the route can answer 400 with it. Unknown keys are ignored —
 * nothing the client sends is spread into Firestore.
 */
export function parseTaskWrite(
  body: unknown,
  { partial }: { partial: boolean }
): { ok: true; write: TaskWrite } | { ok: false; message: string } {
  if (!body || typeof body !== 'object') return { ok: false, message: 'Malformed request' };
  const b = body as Record<string, unknown>;
  const write: TaskWrite = {};

  if (b.title !== undefined || !partial) {
    if (typeof b.title !== 'string' || !b.title.trim()) {
      return { ok: false, message: 'A title is required' };
    }
    if (b.title.trim().length > TASK_TITLE_MAX) {
      return { ok: false, message: `Title exceeds ${TASK_TITLE_MAX} characters` };
    }
    write.title = b.title.trim();
  }
  if (b.textHtml !== undefined) {
    if (typeof b.textHtml !== 'string') return { ok: false, message: 'Malformed task body' };
    write.textHtml = b.textHtml;
  }
  if (b.kind !== undefined) {
    if (!isTaskKind(b.kind)) return { ok: false, message: 'Unknown task kind' };
    write.kind = b.kind;
  } else if (!partial) {
    write.kind = 'once-off';
  }
  if (b.status !== undefined) {
    if (typeof b.status !== 'string') return { ok: false, message: 'Unknown status' };
    write.status = b.status as TaskPayload['status']; // checked against the merged kind later
  }
  if (b.dueDate !== undefined) {
    if (b.dueDate !== null && !isValidDueDate(b.dueDate)) {
      return { ok: false, message: 'Due date must be a valid YYYY-MM-DD date' };
    }
    write.dueDate = b.dueDate as string | null;
  }
  if (b.blocksClockOut !== undefined) {
    if (typeof b.blocksClockOut !== 'boolean') return { ok: false, message: 'Malformed request' };
    write.blocksClockOut = b.blocksClockOut;
  }
  if (b.assigneeUid !== undefined) {
    if (typeof b.assigneeUid !== 'string' || !b.assigneeUid) {
      return { ok: false, message: 'Choose who the task is for' };
    }
    write.assigneeUid = b.assigneeUid;
  }
  return { ok: true, write };
}

/**
 * The stored shape of a body: sanitised HTML in, plain text derived. The
 * client's own `text` is never trusted.
 */
function resolveBody(textHtml: string): { text: string; textHtml: string | null } | { error: string } {
  const clean = sanitizePromptHtml(textHtml);
  const text = htmlToPlainText(clean);
  if (text.length > TASK_TEXT_MAX) {
    return { error: `Task text exceeds the ${TASK_TEXT_MAX.toLocaleString()} character limit` };
  }
  return { text, textHtml: hasRichFormatting(clean) ? clean : null };
}

const STATUS_MISMATCH = 'That status does not apply to this kind of task';
/** A role is standing work — a due date has no meaning for it. */
const dueFor = (kind: TaskKind, due: string | null | undefined) => (kind === 'once-off' ? (due ?? null) : null);

/** Every task, or just one person's. A single-field equality query: no composite index. */
export async function getTasks(scope: { assigneeUid: string } | 'all'): Promise<TaskDocument[]> {
  const col = adminDb.collection(TASKS_COLLECTION);
  const snap = await (scope === 'all' ? col.get() : col.where('assigneeUid', '==', scope.assigneeUid).get());
  return snap.docs.map(mapDoc);
}

/**
 * The caller's outstanding tasks that block clock-out — read on the Clock Out
 * click, so it asks Firestore for only the flagged few (two equality filters, no
 * composite index) and projects four fields, instead of loading and sanitising a
 * person's whole history.
 */
export async function getBlockingTasks(uid: string): Promise<BlockingTask[]> {
  const snap = await adminDb
    .collection(TASKS_COLLECTION)
    .where('assigneeUid', '==', uid)
    .where('blocksClockOut', '==', true)
    .select('title', 'kind', 'status', 'dueDate')
    .get();
  return snap.docs
    .map(doc => {
      const d = doc.data();
      const kind: TaskKind = isTaskKind(d.kind) ? d.kind : 'once-off';
      return {
        id: doc.id,
        title: typeof d.title === 'string' ? d.title : '',
        kind,
        status: isValidStatus(kind, d.status) ? d.status : defaultStatus(kind),
        dueDate: isValidDueDate(d.dueDate) ? d.dueDate : null,
      };
    })
    .filter(isOutstanding);
}

/**
 * Names the creator on tasks someone else set, so an assignee — who cannot read
 * the staff directory — still sees who gave it to them. `known` seeds names the
 * caller already holds (their own) so they cost no read. A creator who has since
 * been deleted stays null and renders as a deleted user.
 */
export async function attachCreatorNames(
  tasks: TaskDocument[],
  known: Map<string, string | null> = new Map()
): Promise<TaskDocument[]> {
  const assigned = tasks.filter(t => t.createdBy !== t.assigneeUid);
  const missing = [...new Set(assigned.map(t => t.createdBy))].filter(id => !known.has(id));
  const names = new Map(known);
  await Promise.all(missing.map(async id => names.set(id, nameOf(await getUserById(id)))));
  return tasks.map(t => (t.createdBy !== t.assigneeUid ? { ...t, createdByName: names.get(t.createdBy) ?? null } : t));
}

export async function createTask(
  input: TaskWrite & { title: string; kind: TaskKind; assigneeUid: string },
  createdBy: string
): Promise<TaskWriteResult<TaskDocument>> {
  const status = input.status ?? defaultStatus(input.kind);
  if (!isValidStatus(input.kind, status)) return { ok: false, reason: 'invalid', message: STATUS_MISMATCH };
  const body = resolveBody(input.textHtml ?? '');
  if ('error' in body) return { ok: false, reason: 'invalid', message: body.error };

  const now = new Date().toISOString();
  const ref = adminDb.collection(TASKS_COLLECTION).doc();
  const data = {
    title: input.title,
    text: body.text,
    textHtml: body.textHtml,
    kind: input.kind,
    status,
    assigneeUid: input.assigneeUid,
    createdBy,
    dueDate: dueFor(input.kind, input.dueDate),
    blocksClockOut: input.blocksClockOut === true,
    completedAt: status === 'Done' ? now : null,
  };
  await ref.set({ ...data, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  return { ok: true, value: { id: ref.id, ...data, createdByName: null, createdAt: now, updatedAt: now } };
}

/**
 * Applies a write to a stored task. The read, the authorization verdict and the
 * write happen in ONE transaction, so a reassignment landing between them cannot
 * be written over on the strength of a stale owner.
 */
export async function updateTask(
  id: string,
  write: TaskWrite,
  authorize: (existing: TaskDocument) => TaskVerdict
): Promise<TaskWriteResult<{ task: TaskDocument; previous: TaskDocument }>> {
  const ref = adminDb.collection(TASKS_COLLECTION).doc(id);
  return adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, reason: 'not-found' } as const;
    const existing = mapDoc(snap);
    const verdict = authorize(existing);
    if (verdict !== 'ok') return { ok: false, reason: verdict } as const;

    const kind = write.kind ?? existing.kind;
    // A kind change carries the status across; an explicit status wins.
    const status = write.status ?? (kind !== existing.kind ? remapStatus(existing.status, kind) : existing.status);
    if (!isValidStatus(kind, status)) return { ok: false, reason: 'invalid', message: STATUS_MISMATCH } as const;

    const body = write.textHtml !== undefined ? resolveBody(write.textHtml) : null;
    if (body && 'error' in body) return { ok: false, reason: 'invalid', message: body.error } as const;

    const now = new Date().toISOString();
    // completedAt follows the status: stamped on entering Done, cleared on leaving.
    const completedAt =
      status === 'Done' ? (existing.status === 'Done' && existing.completedAt ? existing.completedAt : now) : null;
    const task: TaskDocument = {
      ...existing,
      title: write.title ?? existing.title,
      ...(body ? { text: body.text, textHtml: body.textHtml } : {}),
      kind,
      status,
      dueDate: dueFor(kind, write.dueDate !== undefined ? write.dueDate : existing.dueDate),
      assigneeUid: write.assigneeUid ?? existing.assigneeUid,
      blocksClockOut: write.blocksClockOut ?? existing.blocksClockOut,
      completedAt,
      updatedAt: now,
    };
    tx.update(ref, {
      title: task.title,
      text: task.text,
      textHtml: task.textHtml,
      kind,
      status,
      dueDate: task.dueDate,
      assigneeUid: task.assigneeUid,
      blocksClockOut: task.blocksClockOut,
      completedAt,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, value: { task, previous: existing } } as const;
  });
}

export async function deleteTask(
  id: string,
  authorize: (existing: TaskDocument) => TaskVerdict
): Promise<TaskWriteResult<true>> {
  const ref = adminDb.collection(TASKS_COLLECTION).doc(id);
  return adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, reason: 'not-found' } as const;
    const verdict = authorize(mapDoc(snap));
    if (verdict !== 'ok') return { ok: false, reason: verdict } as const;
    tx.delete(ref);
    return { ok: true, value: true } as const;
  });
}
