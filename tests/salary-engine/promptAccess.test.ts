/**
 * Prompt Library access — who may see and edit a prompt. The organisation
 * (admins) owns every prompt; everyone else holds a view/edit grant, direct or
 * through a group. A prompt nobody can see must resolve to null (→ 404).
 */
import {
  buildPromptViewer,
  grantedRole,
  isValidAccessKey,
  resolveRole,
} from '@/lib/promptAccess';
import type { PromptAccess, PromptGrant } from '@/types/promptLibrary';

const g = (role: 'view' | 'edit'): PromptGrant => ({ role, grantedBy: 'u0', grantedAt: '2026-11-13T00:00:00.000Z' });
const none: PromptAccess = { users: {}, groups: {} };
const staff = (uid: string, groups: string[] = []) => buildPromptViewer(uid, groups, false);

describe('buildPromptViewer', () => {
  it('treats the admin claim and the admin group alike', () => {
    expect(buildPromptViewer('a', [], true).isAdmin).toBe(true);
    expect(buildPromptViewer('a', ['admin'], false).isAdmin).toBe(true);
    expect(buildPromptViewer('a', ['CA'], false).isAdmin).toBe(false);
    expect(buildPromptViewer('a', undefined, false).groups).toEqual([]);
  });
});

describe('resolveRole', () => {
  it('hides a prompt with no grants from non-admins', () => {
    expect(resolveRole(none, staff('u1', ['CA']))).toBeNull();
  });

  it('gives admins edit on an ungranted prompt, flagged viaAdmin', () => {
    expect(resolveRole(none, buildPromptViewer('a', ['admin'], false))).toEqual({
      role: 'edit',
      viaAdmin: true,
    });
  });

  it('does not flag an admin who also holds a grant', () => {
    const access: PromptAccess = { users: { a: g('view') }, groups: {} };
    expect(resolveRole(access, buildPromptViewer('a', ['admin'], false))).toEqual({
      role: 'edit',
      viaAdmin: false,
    });
  });

  it('resolves a direct grant', () => {
    expect(resolveRole({ users: { u1: g('view') }, groups: {} }, staff('u1'))).toEqual({
      role: 'view',
      viaAdmin: false,
    });
  });

  it('resolves a group grant live from current membership', () => {
    const access: PromptAccess = { users: {}, groups: { CA: g('edit') } };
    expect(resolveRole(access, staff('u1', []))).toBeNull();
    // Joining the group later grants access with no change to the prompt.
    expect(resolveRole(access, staff('u1', ['CA']))?.role).toBe('edit');
  });

  it('unions grants — the highest role wins, in either order', () => {
    const viewThenEdit: PromptAccess = { users: { u1: g('view') }, groups: { CA: g('edit') } };
    const editThenView: PromptAccess = { users: { u1: g('edit') }, groups: { CA: g('view') } };
    expect(grantedRole(viewThenEdit, staff('u1', ['CA']))).toBe('edit');
    expect(grantedRole(editThenView, staff('u1', ['CA']))).toBe('edit');
    const twoViews: PromptAccess = { users: {}, groups: { CA: g('view'), SMM: g('view') } };
    expect(grantedRole(twoViews, staff('u1', ['CA', 'SMM']))).toBe('view');
  });

  it('ignores grants to other people and other groups', () => {
    const access: PromptAccess = { users: { other: g('edit') }, groups: { SMM: g('edit') } };
    expect(resolveRole(access, staff('u1', ['CA']))).toBeNull();
  });
});

describe('isValidAccessKey', () => {
  it('accepts uids and group ids, refuses anything path-like', () => {
    expect(isValidAccessKey('k3J9xQ2mZpL0aB7cD1eF4gH8iJ5k')).toBe(true);
    expect(isValidAccessKey('CA')).toBe(true);
    for (const bad of ['', 'a/b', 'a.b', '__proto__!', 'x'.repeat(129), 5, null, undefined]) {
      expect(isValidAccessKey(bad)).toBe(false);
    }
  });
});
