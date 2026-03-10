/**
 * Firestore Security Rules Test Suite
 *
 * Prerequisites:
 *   1. Firebase Emulator running: `firebase emulators:start --only firestore`
 *   2. Install deps: `cd tests/firestore-rules && npm install`
 *   3. Run: `npm test`
 *
 * The emulator must be running on the default port (8080) or the
 * FIRESTORE_EMULATOR_HOST env var must be set before running.
 */

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, collection, addDoc, query, where, getDocs } from 'firebase/firestore';
import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ID = 'bluu-rules-test';
const RULES_PATH = path.resolve(__dirname, '../../firestore.rules');

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(RULES_PATH, 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authedUser(uid: string, claims: Record<string, unknown> = {}) {
  return testEnv.authenticatedContext(uid, claims);
}

function adminUser(uid: string) {
  return authedUser(uid, { admin: true });
}

function unauthenticated() {
  return testEnv.unauthenticatedContext();
}

async function seedDoc(collectionPath: string, docId: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), collectionPath, docId), data);
  });
}

// ---------------------------------------------------------------------------
// 1. users collection
// ---------------------------------------------------------------------------

describe('users collection', () => {
  const UID_A = 'user-a';
  const UID_B = 'user-b';
  const ADMIN_UID = 'admin-user';

  beforeEach(async () => {
    await seedDoc('users', UID_A, { uid: UID_A, displayName: 'Alice', groups: ['ca'] });
    await seedDoc('users', UID_B, { uid: UID_B, displayName: 'Bob', groups: ['ca'] });
    await seedDoc('users', ADMIN_UID, { uid: ADMIN_UID, displayName: 'Admin', groups: ['admin'] });
  });

  it('allows a user to read their own document', async () => {
    const db = authedUser(UID_A).firestore();
    await assertSucceeds(getDoc(doc(db, 'users', UID_A)));
  });

  it('denies a user reading another user document', async () => {
    const db = authedUser(UID_A).firestore();
    await assertFails(getDoc(doc(db, 'users', UID_B)));
  });

  it('allows an admin to read any user document', async () => {
    const db = adminUser(ADMIN_UID).firestore();
    await assertSucceeds(getDoc(doc(db, 'users', UID_A)));
    await assertSucceeds(getDoc(doc(db, 'users', UID_B)));
  });

  it('denies unauthenticated reads', async () => {
    const db = unauthenticated().firestore();
    await assertFails(getDoc(doc(db, 'users', UID_A)));
  });

  it('denies all client writes', async () => {
    const db = authedUser(UID_A).firestore();
    await assertFails(setDoc(doc(db, 'users', UID_A), { displayName: 'Hacked' }));
  });

  it('denies admin client writes', async () => {
    const db = adminUser(ADMIN_UID).firestore();
    await assertFails(setDoc(doc(db, 'users', UID_B), { displayName: 'Hacked' }));
  });
});

// ---------------------------------------------------------------------------
// 2. groups collection
// ---------------------------------------------------------------------------

describe('groups collection', () => {
  const UID = 'user-a';

  beforeEach(async () => {
    await seedDoc('groups', 'ca', { name: 'CA', members: [UID] });
  });

  it('allows authenticated user to read groups', async () => {
    const db = authedUser(UID).firestore();
    await assertSucceeds(getDoc(doc(db, 'groups', 'ca')));
  });

  it('denies unauthenticated reads', async () => {
    const db = unauthenticated().firestore();
    await assertFails(getDoc(doc(db, 'groups', 'ca')));
  });

  it('denies all client writes', async () => {
    const db = authedUser(UID).firestore();
    await assertFails(setDoc(doc(db, 'groups', 'ca'), { name: 'Hacked' }));
  });
});

// ---------------------------------------------------------------------------
// 3. page-permissions collection
// ---------------------------------------------------------------------------

describe('page-permissions collection', () => {
  const UID = 'user-a';

  beforeEach(async () => {
    await seedDoc('page-permissions', 'time-tracking', { allowedGroups: ['ca', 'admin'] });
  });

  it('allows authenticated user to read page permissions', async () => {
    const db = authedUser(UID).firestore();
    await assertSucceeds(getDoc(doc(db, 'page-permissions', 'time-tracking')));
  });

  it('denies unauthenticated reads', async () => {
    const db = unauthenticated().firestore();
    await assertFails(getDoc(doc(db, 'page-permissions', 'time-tracking')));
  });

  it('denies all client writes', async () => {
    const db = authedUser(UID).firestore();
    await assertFails(setDoc(doc(db, 'page-permissions', 'time-tracking'), { allowedGroups: [] }));
  });
});

// ---------------------------------------------------------------------------
// 4. time-entries collection (legacy)
// ---------------------------------------------------------------------------

describe('time-entries collection', () => {
  const UID_A = 'user-a';
  const UID_B = 'user-b';
  const ENTRY_ID = 'entry-1';

  beforeEach(async () => {
    await seedDoc('time-entries', ENTRY_ID, { userId: UID_A, duration: 3600 });
  });

  it('allows a user to read their own time entry', async () => {
    const db = authedUser(UID_A).firestore();
    await assertSucceeds(getDoc(doc(db, 'time-entries', ENTRY_ID)));
  });

  it('denies a user reading another user time entry', async () => {
    const db = authedUser(UID_B).firestore();
    await assertFails(getDoc(doc(db, 'time-entries', ENTRY_ID)));
  });

  it('denies unauthenticated reads', async () => {
    const db = unauthenticated().firestore();
    await assertFails(getDoc(doc(db, 'time-entries', ENTRY_ID)));
  });

  it('denies all client writes', async () => {
    const db = authedUser(UID_A).firestore();
    await assertFails(setDoc(doc(db, 'time-entries', ENTRY_ID), { userId: UID_A, duration: 0 }));
  });
});

// ---------------------------------------------------------------------------
// 5. screenshots collection
// ---------------------------------------------------------------------------

describe('screenshots collection', () => {
  const UID_A = 'user-a';
  const UID_B = 'user-b';
  const SHOT_ID = 'shot-1';

  beforeEach(async () => {
    await seedDoc('screenshots', SHOT_ID, { userId: UID_A, url: 'https://example.com/shot.png' });
  });

  it('allows a user to read their own screenshot', async () => {
    const db = authedUser(UID_A).firestore();
    await assertSucceeds(getDoc(doc(db, 'screenshots', SHOT_ID)));
  });

  it('denies a user reading another user screenshot', async () => {
    const db = authedUser(UID_B).firestore();
    await assertFails(getDoc(doc(db, 'screenshots', SHOT_ID)));
  });

  it('denies all client writes', async () => {
    const db = authedUser(UID_A).firestore();
    await assertFails(setDoc(doc(db, 'screenshots', SHOT_ID), { userId: UID_A, url: 'x' }));
  });
});

// ---------------------------------------------------------------------------
// 6. active_sessions collection
// ---------------------------------------------------------------------------

describe('active_sessions collection', () => {
  const UID_A = 'user-a';
  const UID_B = 'user-b';
  const ADMIN_UID = 'admin-user';

  beforeEach(async () => {
    await seedDoc('active_sessions', UID_A, { userId: UID_A, userClockOut: false });
    await seedDoc('active_sessions', UID_B, { userId: UID_B, userClockOut: false });
  });

  it('allows a user to read their own session', async () => {
    const db = authedUser(UID_A).firestore();
    await assertSucceeds(getDoc(doc(db, 'active_sessions', UID_A)));
  });

  it('denies a user reading another user session', async () => {
    const db = authedUser(UID_A).firestore();
    await assertFails(getDoc(doc(db, 'active_sessions', UID_B)));
  });

  it('allows an admin to read any session', async () => {
    const db = adminUser(ADMIN_UID).firestore();
    await assertSucceeds(getDoc(doc(db, 'active_sessions', UID_A)));
    await assertSucceeds(getDoc(doc(db, 'active_sessions', UID_B)));
  });

  it('denies unauthenticated reads', async () => {
    const db = unauthenticated().firestore();
    await assertFails(getDoc(doc(db, 'active_sessions', UID_A)));
  });

  it('denies all client writes', async () => {
    const db = authedUser(UID_A).firestore();
    await assertFails(setDoc(doc(db, 'active_sessions', UID_A), { userId: UID_A, userClockOut: true }));
  });
});

// ---------------------------------------------------------------------------
// 7. time_entries collection (new session ledger)
// ---------------------------------------------------------------------------

describe('time_entries collection', () => {
  const UID_A = 'user-a';
  const UID_B = 'user-b';
  const ADMIN_UID = 'admin-user';
  const SESSION_ID = 'session-1';

  beforeEach(async () => {
    await seedDoc('time_entries', SESSION_ID, { userId: UID_A, duration: 7200 });
  });

  it('allows a user to read their own session entry', async () => {
    const db = authedUser(UID_A).firestore();
    await assertSucceeds(getDoc(doc(db, 'time_entries', SESSION_ID)));
  });

  it('denies a user reading another user session entry', async () => {
    const db = authedUser(UID_B).firestore();
    await assertFails(getDoc(doc(db, 'time_entries', SESSION_ID)));
  });

  it('allows an admin to read any session entry', async () => {
    const db = adminUser(ADMIN_UID).firestore();
    await assertSucceeds(getDoc(doc(db, 'time_entries', SESSION_ID)));
  });

  it('denies all client writes', async () => {
    const db = authedUser(UID_A).firestore();
    await assertFails(setDoc(doc(db, 'time_entries', SESSION_ID), { userId: UID_A, duration: 0 }));
  });
});

// ---------------------------------------------------------------------------
// 8. notifications collection
// ---------------------------------------------------------------------------

describe('notifications collection', () => {
  const UID_A = 'user-a';
  const UID_B = 'user-b';
  const NOTIF_ID = 'notif-1';

  beforeEach(async () => {
    await seedDoc('notifications', NOTIF_ID, { userId: UID_A, title: 'Test', read: false });
  });

  it('allows a user to read their own notification', async () => {
    const db = authedUser(UID_A).firestore();
    await assertSucceeds(getDoc(doc(db, 'notifications', NOTIF_ID)));
  });

  it('denies a user reading another user notification', async () => {
    const db = authedUser(UID_B).firestore();
    await assertFails(getDoc(doc(db, 'notifications', NOTIF_ID)));
  });

  it('denies unauthenticated reads', async () => {
    const db = unauthenticated().firestore();
    await assertFails(getDoc(doc(db, 'notifications', NOTIF_ID)));
  });

  it('denies all client writes', async () => {
    const db = authedUser(UID_A).firestore();
    await assertFails(setDoc(doc(db, 'notifications', NOTIF_ID), { userId: UID_A, read: true }));
  });
});

// ---------------------------------------------------------------------------
// 9. disputes collection
// ---------------------------------------------------------------------------

describe('disputes collection', () => {
  const UID_CREATOR = 'user-creator';
  const UID_ASSIGNED = 'user-assigned';
  const UID_OTHER = 'user-other';
  const ADMIN_UID = 'admin-user';
  const DISPUTE_ID = 'dispute-1';

  beforeEach(async () => {
    await seedDoc('disputes', DISPUTE_ID, {
      createdBy: UID_CREATOR,
      assignedTo: UID_ASSIGNED,
      status: 'open',
    });
  });

  it('allows the creator to read their dispute', async () => {
    const db = authedUser(UID_CREATOR).firestore();
    await assertSucceeds(getDoc(doc(db, 'disputes', DISPUTE_ID)));
  });

  it('allows the assigned user to read the dispute', async () => {
    const db = authedUser(UID_ASSIGNED).firestore();
    await assertSucceeds(getDoc(doc(db, 'disputes', DISPUTE_ID)));
  });

  it('denies an unrelated user reading the dispute', async () => {
    const db = authedUser(UID_OTHER).firestore();
    await assertFails(getDoc(doc(db, 'disputes', DISPUTE_ID)));
  });

  it('allows an admin to read any dispute', async () => {
    const db = adminUser(ADMIN_UID).firestore();
    await assertSucceeds(getDoc(doc(db, 'disputes', DISPUTE_ID)));
  });

  it('denies unauthenticated reads', async () => {
    const db = unauthenticated().firestore();
    await assertFails(getDoc(doc(db, 'disputes', DISPUTE_ID)));
  });

  it('denies all client writes', async () => {
    const db = authedUser(UID_CREATOR).firestore();
    await assertFails(setDoc(doc(db, 'disputes', DISPUTE_ID), { status: 'closed' }));
  });
});

// ---------------------------------------------------------------------------
// 10. shifts collection (defence-in-depth — all access denied)
// ---------------------------------------------------------------------------

describe('shifts collection', () => {
  const UID = 'user-a';
  const ADMIN_UID = 'admin-user';
  const SHIFT_ID = 'shift-1';

  beforeEach(async () => {
    await seedDoc('shifts', SHIFT_ID, { userId: UID, start: '09:00', end: '17:00' });
  });

  it('denies authenticated user reads', async () => {
    const db = authedUser(UID).firestore();
    await assertFails(getDoc(doc(db, 'shifts', SHIFT_ID)));
  });

  it('denies admin reads (client-side)', async () => {
    const db = adminUser(ADMIN_UID).firestore();
    await assertFails(getDoc(doc(db, 'shifts', SHIFT_ID)));
  });

  it('denies unauthenticated reads', async () => {
    const db = unauthenticated().firestore();
    await assertFails(getDoc(doc(db, 'shifts', SHIFT_ID)));
  });

  it('denies all client writes', async () => {
    const db = authedUser(UID).firestore();
    await assertFails(setDoc(doc(db, 'shifts', SHIFT_ID), { start: '08:00' }));
  });
});

// ---------------------------------------------------------------------------
// 11. creators collection (defence-in-depth — all access denied)
// ---------------------------------------------------------------------------

describe('creators collection', () => {
  const UID = 'user-a';
  const CREATOR_ID = 'creator-1';

  beforeEach(async () => {
    await seedDoc('creators', CREATOR_ID, { stageName: 'DJ Test', active: true });
  });

  it('denies authenticated user reads', async () => {
    const db = authedUser(UID).firestore();
    await assertFails(getDoc(doc(db, 'creators', CREATOR_ID)));
  });

  it('denies unauthenticated reads', async () => {
    const db = unauthenticated().firestore();
    await assertFails(getDoc(doc(db, 'creators', CREATOR_ID)));
  });

  it('denies all client writes', async () => {
    const db = authedUser(UID).firestore();
    await assertFails(setDoc(doc(db, 'creators', CREATOR_ID), { stageName: 'Hacked' }));
  });
});

// ---------------------------------------------------------------------------
// 12. bugs collection (defence-in-depth — all access denied)
// ---------------------------------------------------------------------------

describe('bugs collection', () => {
  const UID = 'user-a';

  it('denies authenticated user writes', async () => {
    const db = authedUser(UID).firestore();
    await assertFails(addDoc(collection(db, 'bugs'), { message: 'test error' }));
  });

  it('denies unauthenticated writes', async () => {
    const db = unauthenticated().firestore();
    await assertFails(addDoc(collection(db, 'bugs'), { message: 'test error' }));
  });

  it('denies reads', async () => {
    await seedDoc('bugs', 'bug-1', { message: 'existing bug' });
    const db = authedUser(UID).firestore();
    await assertFails(getDoc(doc(db, 'bugs', 'bug-1')));
  });
});
