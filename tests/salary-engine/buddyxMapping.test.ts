/**
 * BuddyX identity → Bluu identity. Neither join may guess: a chatter maps by
 * email (folded as login folds it), a model by OnlyFans handle, an admin's
 * manual link wins over both, and anything else maps to nobody.
 */
import {
  buildEmailIndex,
  buildHandleIndex,
  foldHandle,
  resolveChatter,
  resolveModel,
} from '@/lib/buddyx/mapping';
import { normalizeEmail } from '@/lib/authEmail';
import { normaliseId } from '@/lib/buddyx/types';

describe('normaliseId', () => {
  it('turns the numbers the live API sends into strings', () => {
    expect(normaliseId(4711)).toBe('4711');
    expect(normaliseId('4711')).toBe('4711');
    expect(normaliseId(null)).toBeNull();
    expect(normaliseId('  ')).toBeNull();
  });
});

describe('chatter → user', () => {
  const users = [
    { uid: 'u-queen', workEmail: 'AgboolaQ20@gmail.com' },
    { uid: 'u-jen', workEmail: 'jenelle.monterde77@gmail.com' },
  ];
  const index = buildEmailIndex(users, normalizeEmail);

  it('matches by email, case-insensitively', () => {
    expect(resolveChatter({ email: 'agboolaq20@GMAIL.com' }, index, normalizeEmail)).toEqual({ uid: 'u-queen', match: 'email' });
  });

  it('never guesses — an unknown email maps to nobody', () => {
    expect(resolveChatter({ email: 'queen@elsewhere.com' }, index, normalizeEmail)).toEqual({ uid: null, match: 'none' });
    expect(resolveChatter({ email: null }, index, normalizeEmail)).toEqual({ uid: null, match: 'none' });
  });

  it('lets a manual link win over the email match', () => {
    expect(resolveChatter({ email: 'agboolaq20@gmail.com', manualUid: 'u-jen' }, index, normalizeEmail)).toEqual({
      uid: 'u-jen',
      match: 'manual',
    });
  });

  it('ignores a manual link to a user who no longer exists', () => {
    expect(
      resolveChatter({ email: 'agboolaq20@gmail.com', manualUid: 'u-gone' }, index, normalizeEmail, new Set(['u-queen', 'u-jen'])),
    ).toEqual({ uid: 'u-queen', match: 'email' });
  });
});

describe('model → creator', () => {
  const creators = [
    { id: 'c-adam', stageName: 'Adam Horváth', OFID: '@AdamH' },
    { id: 'c-cole', stageName: 'Cole Bentley', OFID: 'onlyfans.com/colebentley/' },
    { id: 'sub-cole-vip', stageName: 'Cole (VIP)', OFID: '@colevip' },
    { id: 'c-dup-1', stageName: 'Dup One', OFID: '@same' },
    { id: 'c-dup-2', stageName: 'Dup Two', OFID: '@same' },
  ];
  const index = buildHandleIndex(creators);
  const byId = new Map(creators.map(c => [c.id, c]));

  it('folds every spelling of a handle to one key', () => {
    expect(foldHandle('@AdamH')).toBe('adamh');
    expect(foldHandle('https://onlyfans.com/ColeBentley/')).toBe('colebentley');
    expect(foldHandle('  adamh ')).toBe('adamh');
  });

  it('matches creators and sub-accounts alike (rule 9h)', () => {
    expect(resolveModel({ handle: 'adamh' }, index, byId).creatorId).toBe('c-adam');
    expect(resolveModel({ handle: 'colebentley' }, index, byId).creatorId).toBe('c-cole');
    expect(resolveModel({ handle: 'colevip' }, index, byId).creatorId).toBe('sub-cole-vip');
  });

  it('maps an ambiguous handle to nobody', () => {
    expect(resolveModel({ handle: 'same' }, index, byId)).toEqual({ creatorId: null, creatorName: null, match: 'none' });
  });

  it('lets a manual link win', () => {
    expect(resolveModel({ handle: 'adamh', manualCreatorId: 'c-cole' }, index, byId)).toEqual({
      creatorId: 'c-cole',
      creatorName: 'Cole Bentley',
      match: 'manual',
    });
  });
});
