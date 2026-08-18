/**
 * The chat list's saved filter and sort.
 *
 * `localStorage`, not `sessionStorage`, and for the same reason drafts are: a
 * satellite window gets closed casually, and an operator who works the unread
 * queue sorted by spend should not have to re-choose that every time they reopen
 * the inbox. It is a preference, not session state.
 *
 * **Deliberately not scoped per account.** Exactly one account is operated
 * today, and the account id is not always known on the first paint — scoping the
 * key now would mean either reading it under `unknown` on a cold session or
 * re-reading it in an effect once the id lands, both to solve a problem that
 * does not exist until Phase 4 builds the account switcher. Scope it there,
 * alongside everything else that stops being implicit.
 */

export type ChatFilter = 'all' | 'unread' | 'pinned';
export type ChatSort = 'recent' | 'unread' | 'spend';

export interface ListPrefs {
  filter: ChatFilter;
  sort: ChatSort;
}

export const DEFAULT_LIST_PREFS: ListPrefs = { filter: 'all', sort: 'recent' };

const FILTERS: ChatFilter[] = ['all', 'unread', 'pinned'];
const SORTS: ChatSort[] = ['recent', 'unread', 'spend'];

const KEY = 'bluu_of_list_prefs_v1';

export function loadListPrefs(): ListPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_LIST_PREFS;
    const parsed = JSON.parse(raw) as Partial<ListPrefs>;
    return {
      // Validated rather than cast: a value from an older build (or a hand-edited
      // store) would otherwise select nothing and leave the list looking broken
      // with no chip lit.
      filter: FILTERS.includes(parsed.filter as ChatFilter)
        ? (parsed.filter as ChatFilter)
        : DEFAULT_LIST_PREFS.filter,
      sort: SORTS.includes(parsed.sort as ChatSort)
        ? (parsed.sort as ChatSort)
        : DEFAULT_LIST_PREFS.sort,
    };
  } catch {
    return DEFAULT_LIST_PREFS;
  }
}

export function saveListPrefs(prefs: ListPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Quota or private mode. A forgotten preference is not a broken list.
  }
}
