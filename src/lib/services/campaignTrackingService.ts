import { adminDb } from '@/lib/firebase-admin';

export async function getOFAMUids(): Promise<string[]> {
  const snap = await adminDb.collection('groups').doc('OFAM').get();
  return (snap.data()?.members as string[]) ?? [];
}
