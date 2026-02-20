import { adminDb } from '../firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { TimeEntryState } from '@/types/firestore';

const COLLECTION = 'time-entries';

export async function createTimeEntry(
  userId: string,
  state: TimeEntryState,
): Promise<string> {
  const now = FieldValue.serverTimestamp();
  const docRef = await adminDb.collection(COLLECTION).add({
    userId,
    state,
    createdTime: now,
    lastTime: now,
    userClockOut: false,
  });
  return docRef.id;
}

export async function updateEntryLastTime(
  entryId: string,
  userId: string,
): Promise<void> {
  const ref = adminDb.collection(COLLECTION).doc(entryId);
  const doc = await ref.get();
  if (!doc.exists || doc.data()?.userId !== userId) {
    throw new Error('Entry not found or unauthorized');
  }
  await ref.update({ lastTime: FieldValue.serverTimestamp() });
}

export async function markUserClockOut(
  entryId: string,
  userId: string,
): Promise<void> {
  const ref = adminDb.collection(COLLECTION).doc(entryId);
  const doc = await ref.get();
  if (!doc.exists || doc.data()?.userId !== userId) {
    throw new Error('Entry not found or unauthorized');
  }
  await ref.update({
    lastTime: FieldValue.serverTimestamp(),
    userClockOut: true,
  });
}

export async function getActiveEntry(
  userId: string,
): Promise<{ id: string; data: FirebaseFirestore.DocumentData } | null> {
  const snap = await adminDb
    .collection(COLLECTION)
    .where('userId', '==', userId)
    .orderBy('createdTime', 'desc')
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, data: doc.data() };
}

export async function getEntriesByDateRange(
  userId: string,
  startDate: Date,
  endDate: Date,
): Promise<Array<{ id: string; data: FirebaseFirestore.DocumentData }>> {
  const startTs = Timestamp.fromDate(startDate);
  const endTs = Timestamp.fromDate(endDate);

  // Main query: entries created within the date range
  const mainSnap = await adminDb
    .collection(COLLECTION)
    .where('userId', '==', userId)
    .where('createdTime', '>=', startTs)
    .where('createdTime', '<=', endTs)
    .orderBy('createdTime', 'asc')
    .get();

  const results = mainSnap.docs.map(doc => ({ id: doc.id, data: doc.data() }));

  // Also check for an entry created just before the range that may extend into it
  const priorSnap = await adminDb
    .collection(COLLECTION)
    .where('userId', '==', userId)
    .where('createdTime', '<', startTs)
    .orderBy('createdTime', 'desc')
    .limit(1)
    .get();

  if (!priorSnap.empty) {
    const priorDoc = priorSnap.docs[0];
    const priorData = priorDoc.data();
    const lastTime = priorData.lastTime?.toDate?.();
    if (lastTime && lastTime >= startDate) {
      results.unshift({ id: priorDoc.id, data: priorData });
    }
  }

  return results;
}
