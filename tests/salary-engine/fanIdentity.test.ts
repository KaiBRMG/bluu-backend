/**
 * Fan identity: reading a custom's profile link into an OnlyFans id or handle,
 * the "name staff use" rule, name resolution order, and what a custom owes.
 */
import {
  automaticFanName,
  customMoney,
  fanKeyOf,
  isValidFanKey,
  parseProfileLink,
  pickCustomsName,
  profileLinkForKey,
  resolveFanName,
} from '@/lib/fans/fanIdentity';

describe('parseProfileLink', () => {
  it('reads the id from a /u link and ignores the rec referral code', () => {
    expect(parseProfileLink('https://onlyfans.com/u598208266?rec=123456789')).toEqual({ fanId: '598208266', handle: null });
  });
  it('reads a handle link, lower-cased', () => {
    expect(parseProfileLink('https://onlyfans.com/SomeHandle?rec=123456789')).toEqual({ fanId: null, handle: 'somehandle' });
    expect(parseProfileLink('onlyfans.com/somehandle/')).toEqual({ fanId: null, handle: 'somehandle' });
    expect(parseProfileLink('www.onlyfans.com/somehandle')).toEqual({ fanId: null, handle: 'somehandle' });
  });
  it('reads bare ids, u-ids and @handles', () => {
    expect(parseProfileLink('598208266')).toEqual({ fanId: '598208266', handle: null });
    expect(parseProfileLink('u598208266')).toEqual({ fanId: '598208266', handle: null });
    expect(parseProfileLink('@u3677198')).toEqual({ fanId: null, handle: 'u3677198' });
  });
  it('reads a chat link as the fan id', () => {
    expect(parseProfileLink('https://onlyfans.com/my/chats/chat/598208266/')).toEqual({ fanId: '598208266', handle: null });
  });
  it('refuses other platforms, app pages and junk', () => {
    expect(parseProfileLink('https://fansly.com/someone')).toBeNull();
    expect(parseProfileLink('https://onlyfans.com/my/notifications')).toBeNull();
    expect(parseProfileLink('https://onlyfans.com/')).toBeNull();
    expect(parseProfileLink('')).toBeNull();
    expect(parseProfileLink('not a link at all')).toBeNull();
  });
});

describe('fan keys', () => {
  it('keys an id as itself and a handle as h_<handle>', () => {
    expect(fanKeyOf({ fanId: '598208266', handle: null })).toBe('598208266');
    expect(fanKeyOf({ fanId: null, handle: 'someone' })).toBe('h_someone');
    expect(fanKeyOf(null)).toBeNull();
  });
  it('validates keys and builds canonical links', () => {
    expect(isValidFanKey('598208266')).toBe(true);
    expect(isValidFanKey('h_someone')).toBe(true);
    expect(isValidFanKey('h_')).toBe(false);
    expect(isValidFanKey('../etc')).toBe(false);
    expect(profileLinkForKey('598208266')).toBe('https://onlyfans.com/u598208266');
    expect(profileLinkForKey('h_someone')).toBe('https://onlyfans.com/someone');
  });
});

describe('pickCustomsName', () => {
  it('picks the most common name, case-insensitively, in its latest spelling', () => {
    expect(
      pickCustomsName([
        { name: 'mike', at: 1 },
        { name: 'Mikey', at: 2 },
        { name: 'Mike ', at: 3 },
      ]),
    ).toEqual({ name: 'Mike', votes: 2, total: 3 });
  });
  it('falls back to the most recent when no name repeats', () => {
    expect(pickCustomsName([{ name: 'Tom', at: 5 }, { name: 'Thomas', at: 9 }, { name: 'T', at: 1 }])?.name).toBe('Thomas');
  });
  it('breaks a tie between equally common names by recency', () => {
    expect(pickCustomsName([{ name: 'A', at: 1 }, { name: 'B', at: 2 }, { name: 'A', at: 3 }, { name: 'B', at: 4 }])?.name).toBe('B');
  });
  it('ignores blanks and returns null with nothing to go on', () => {
    expect(pickCustomsName([{ name: '  ', at: 1 }, { name: null, at: 2 }])).toBeNull();
  });
});

describe('resolveFanName', () => {
  it('ranks manual over customs over the synced name', () => {
    expect(resolveFanName({ manualName: 'M', customsName: 'C', name: 'S', source: 'buddyx-link' })).toEqual({ name: 'M', source: 'manual' });
    expect(resolveFanName({ customsName: 'C', name: 'S', source: 'infloww' })).toEqual({ name: 'C', source: 'customs' });
    expect(resolveFanName({ name: 'S', source: 'infloww' })).toEqual({ name: 'S', source: 'infloww' });
    expect(resolveFanName({ name: 'S', source: 'buddyx-link' })).toEqual({ name: 'S', source: 'buddyx' });
    expect(resolveFanName({})).toEqual({ name: null, source: null });
  });
  it('reverting drops only the manual name', () => {
    expect(automaticFanName({ manualName: 'M', customsName: 'C' })).toEqual({ name: 'C', source: 'customs' });
  });
});

describe('customMoney', () => {
  const cr = { type: 'CR', status: 'In Progress', totalAmount: 100, amountPaid: 40 };
  it('counts what a live custom still owes', () => {
    expect(customMoney(cr)).toMatchObject({ outstanding: 60, abandoned: false });
    expect(customMoney({ ...cr, status: 'Completed', amountPaid: 100 })).toMatchObject({ outstanding: 0 });
  });
  it('treats a rejected custom as neither owing nor abandoned', () => {
    expect(customMoney({ ...cr, status: 'Rejected' })).toMatchObject({ outstanding: 0, abandoned: false, rejected: true });
  });
  it('counts an archived custom as abandoned by its original total', () => {
    expect(customMoney({ ...cr, status: 'Archived', totalAmount: 40, originalTotalAmount: 100 })).toMatchObject({ abandoned: true, abandonedAmount: 60 });
    expect(customMoney({ ...cr, status: 'Archived', totalAmount: 100, amountPaid: 100, originalTotalAmount: 100 })).toMatchObject({ abandoned: false });
  });
  it('counts a legacy archived custom as abandoned with no amount', () => {
    expect(customMoney({ ...cr, status: 'Archived', totalAmount: 40 })).toMatchObject({ abandoned: true, abandonedAmount: null });
  });
  it('reads a campaign by isArchived and its original paid amount', () => {
    const bfe = { type: 'BFE', status: 'In Progress', totalAmount: 200, amountPaid: 50 };
    expect(customMoney(bfe)).toMatchObject({ outstanding: 150 });
    expect(customMoney({ ...bfe, isArchived: true, amountPaid: 200, originalAmountPaid: 50 })).toMatchObject({ abandoned: true, abandonedAmount: 150 });
    expect(customMoney({ ...bfe, isArchived: true, amountPaid: 200 })).toMatchObject({ abandoned: false, outstanding: 0 });
  });
});
