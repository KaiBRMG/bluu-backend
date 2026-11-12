/**
 * OnlyMonster identity → Bluu identity (onlymonster-migration.md §4.2).
 *
 * The rule decided on 2026-11-11: an OnlyFans account maps by handle against
 * Bluu accounts whose platform is `onlyfans` ONLY. The fixture is the real
 * collision the probe found: Noah Ryder is `@itsnoahryder` on OnlyFans and his
 * Fansly sub-account carries the same handle, which without the filter mapped
 * the OnlyFans account to nobody.
 */
import { normalizeEmail } from '@/lib/authEmail';
import {
  buildMemberEmailIndex,
  buildOnlyFansHandleIndex,
  foldHandle,
  isSuspectEmpty,
  resolveAccount,
  resolveAccountPinned,
  resolveMember,
  type BluuAccountForMatch,
} from '@/lib/onlymonster/mapping';
import { normaliseId } from '@/lib/onlymonster/types';

const accounts: BluuAccountForMatch[] = [
  { id: 'noah', stageName: 'Noah Ryder', OFID: '@itsnoahryder', platform: 'onlyfans' },
  { id: 'noah-fansly', stageName: 'Noah Ryder (Fansly)', OFID: '@Itsnoahryder', platform: 'fansly' },
  { id: 'cole-fansly', stageName: 'Cole Bentley (Fansly)', OFID: '@ColeBentley', platform: 'fansly' },
  { id: 'cole-jff', stageName: 'Cole Bentley (JFF)', OFID: '@colebentley', platform: 'justforfans' },
  { id: 'leo', stageName: 'Leo', OFID: '@TwinkLeo', platform: 'fansly' },
  { id: 'liam', stageName: 'Liam Heng', OFID: 'https://onlyfans.com/liamheng/', platform: 'onlyfans' },
  { id: 'legacy', stageName: 'Legacy', OFID: '@legacyhandle', platform: null },
];
const byId = new Map(accounts.map(a => [a.id, a]));
const index = buildOnlyFansHandleIndex(accounts);

describe('resolveAccount', () => {
  it('maps an OnlyFans account past a Fansly sub-account with the same handle', () => {
    expect(resolveAccount({ username: 'itsnoahryder' }, index, byId)).toEqual({ creatorId: 'noah', creatorName: 'Noah Ryder', match: 'handle' });
  });

  it('never maps to a non-OnlyFans account, even on an exact handle', () => {
    expect(resolveAccount({ username: 'TwinkLeo' }, index, byId).creatorId).toBeNull();
    expect(resolveAccount({ username: 'colebentley' }, index, byId).creatorId).toBeNull();
  });

  it('never maps to an account with no platform set (that would be a guess)', () => {
    expect(resolveAccount({ username: 'legacyhandle' }, index, byId)).toEqual({ creatorId: null, creatorName: null, match: 'none' });
  });

  it('folds every handle spelling', () => {
    expect(resolveAccount({ username: 'LiamHeng' }, index, byId).creatorId).toBe('liam');
    expect(foldHandle('https://www.onlyfans.com/LiamHeng/')).toBe('liamheng');
  });

  it('maps a handle two OnlyFans accounts claim to nobody', () => {
    const dup = buildOnlyFansHandleIndex([
      ...accounts,
      { id: 'noah-2', stageName: 'Noah Two', OFID: 'itsnoahryder', platform: 'onlyfans' },
    ]);
    expect(resolveAccount({ username: 'itsnoahryder' }, dup, byId)).toEqual({ creatorId: null, creatorName: null, match: 'none' });
  });

  it('lets a manual link win, and ignores one to a deleted account', () => {
    expect(resolveAccount({ username: 'nobody', manualCreatorId: 'liam' }, index, byId).match).toBe('manual');
    expect(resolveAccount({ username: 'itsnoahryder', manualCreatorId: 'gone' }, index, byId)).toEqual({
      creatorId: 'noah',
      creatorName: 'Noah Ryder',
      match: 'handle',
    });
  });

  it('maps an account not in Bluu to nobody', () => {
    expect(resolveAccount({ username: 'yetanotherluca' }, index, byId).match).toBe('none');
  });
});

describe('resolveMember', () => {
  const users = [
    { uid: 'u1', workEmail: 'Agent.One@gmail.com' },
    { uid: 'u2', workEmail: 'shared@bluurock.com' },
    { uid: 'u3', workEmail: 'shared@bluurock.com' },
  ];
  const emails = buildMemberEmailIndex(users, normalizeEmail);
  const known = new Set(users.map(u => u.uid));

  it('matches by the login fold', () => {
    expect(resolveMember({ email: 'agentone+om@gmail.com' }, emails, normalizeEmail, known)).toEqual({ uid: 'u1', match: 'email' });
  });

  it('maps an address two users share to nobody', () => {
    expect(resolveMember({ email: 'shared@bluurock.com' }, emails, normalizeEmail, known).uid).toBeNull();
  });

  it('lets a manual link win, and ignores one to a deleted user', () => {
    expect(resolveMember({ email: 'x@y.com', manualUid: 'u2' }, emails, normalizeEmail, known)).toEqual({ uid: 'u2', match: 'manual' });
    expect(resolveMember({ email: 'x@y.com', manualUid: 'gone' }, emails, normalizeEmail, known)).toEqual({ uid: null, match: 'none' });
  });

  it('never matches an empty email', () => {
    expect(resolveMember({ email: null }, emails, normalizeEmail, known).uid).toBeNull();
  });
});

describe('isSuspectEmpty', () => {
  it('distrusts an empty list only while stored docs exist', () => {
    expect(isSuspectEmpty(0, 9)).toBe(true);
    expect(isSuspectEmpty(0, 0)).toBe(false);
    expect(isSuspectEmpty(3, 9)).toBe(false);
  });
});

describe('normaliseId', () => {
  it('keeps a Fansly platform id beyond 2^53 exact, and stringifies integers', () => {
    expect(normaliseId('826344856635842562')).toBe('826344856635842562');
    expect(normaliseId(87963)).toBe('87963');
    expect(normaliseId('  ')).toBeNull();
    expect(normaliseId(null)).toBeNull();
  });
});

describe('resolveAccountPinned (the numeric-id pin, plan §4.2)', () => {
  const prev = { creatorId: 'noah', match: 'handle' as const, platformAccountId: '409603086' };

  it('agrees silently when the handle still matches', () => {
    expect(resolveAccountPinned({ username: 'itsnoahryder', platformAccountId: '409603086' }, prev, index, byId)).toEqual({
      creatorId: 'noah',
      creatorName: 'Noah Ryder',
      match: 'handle',
      warning: null,
    });
  });

  it('keeps the creator, with a warning, after an OnlyFans handle rename', () => {
    const r = resolveAccountPinned({ username: 'noahrenamed', platformAccountId: '409603086' }, prev, index, byId);
    expect(r.creatorId).toBe('noah');
    expect(r.warning).toMatch(/no longer matches Noah Ryder's OFID/);
  });

  it('never silently switches to a different creator the new handle matches', () => {
    const r = resolveAccountPinned({ username: 'liamheng', platformAccountId: '409603086' }, prev, index, byId);
    expect(r.creatorId).toBe('noah');
    expect(r.warning).toMatch(/now matches Liam Heng/);
  });

  it('does not pin across a different numeric account', () => {
    expect(resolveAccountPinned({ username: 'noahrenamed', platformAccountId: '999' }, prev, index, byId)).toEqual({
      creatorId: null,
      creatorName: null,
      match: 'none',
      warning: null,
    });
  });

  it('drops the pin once the creator is no longer on OnlyFans, or is gone', () => {
    const moved = new Map(byId);
    moved.set('noah', { ...byId.get('noah')!, platform: 'fansly' });
    const movedIndex = buildOnlyFansHandleIndex([...moved.values()]);
    expect(resolveAccountPinned({ username: 'itsnoahryder', platformAccountId: '409603086' }, prev, movedIndex, moved).creatorId).toBeNull();
    const gone = { ...prev, creatorId: 'deleted' };
    expect(resolveAccountPinned({ username: 'x', platformAccountId: '409603086' }, gone, index, byId).creatorId).toBeNull();
  });

  it('never pins a manual or unmatched previous state, and a manual link overrides the pin', () => {
    expect(resolveAccountPinned({ username: 'x', platformAccountId: '409603086' }, { ...prev, match: 'none' }, index, byId).creatorId).toBeNull();
    expect(resolveAccountPinned({ username: 'x', platformAccountId: '409603086', manualCreatorId: 'liam' }, prev, index, byId)).toEqual({
      creatorId: 'liam',
      creatorName: 'Liam Heng',
      match: 'manual',
      warning: null,
    });
  });
});
