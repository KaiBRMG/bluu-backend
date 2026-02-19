import { adminDb } from '../firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
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
