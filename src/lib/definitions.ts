// ─── Teamspace definitions (code-only, not stored in Firestore) ─────

export interface TeamspaceDef {
  id: string;
  name: string;
  icon: string;
  order: number;
}

export interface PageDef {
  pageId: string;
  title: string;
  teamspaceId: string;
  href: string | null;
  icon: string | null;
  order: number;
}

/**
 * A page that sits **outside** the teamspace/permission system entirely, like
 * Home: every authenticated employee can reach it.
 *
 * These are deliberately **not** in `PAGES`. That is the whole mechanism — no
 * `page-permissions/{pageId}` doc, no `permittedPageIds` entry, and no row on
 * the Sharing page, so there is nothing for an admin to grant or revoke. The
 * sidebar renders them directly under Home and `AppLayout` exempts their hrefs
 * from the route guard (`ALWAYS_ACCESSIBLE`).
 *
 * Adding one is a decision that the page is org-wide. If access should ever be
 * narrowed, move it back into `PAGES` — and remember that a page moving in
 * either direction leaves an orphan in Firestore; see
 * [permissions.md](../../documentation/permissions.md).
 */
export interface UniversalPageDef {
  title: string;
  href: string;
  icon: string;
}

export const UNIVERSAL_PAGES: UniversalPageDef[] = [
  // Moved out of the Apps teamspace on 2026-08-26: the whole organisation uses
  // Resources, and the page filters its own contents by group anyway.
  { title: 'Resources', href: '/applications/apps-resources', icon: 'FileSearch' },
];

export const TEAMSPACES: TeamspaceDef[] = [
  { id: 'admin-portal', name: 'Admin Portal', icon: 'ShieldUser', order: 0 },
  { id: 'ca-portal', name: 'CA Portal', icon: 'MessageSquareQuote', order: 1 },
  { id: 'smm-portal', name: 'SMM Portal', icon: 'MessageSquareQuote', order: 2 },
  { id: 'creator-portal', name: 'Creator Portal', icon: 'ShieldUser', order: 3 },
  { id: 'apps', name: 'Apps', icon: 'PanelLeft', order: 4 },
];

export const PAGES: PageDef[] = [
  // Admin Portal
  { pageId: 'user-management', title: 'User Management', teamspaceId: 'admin-portal', href: '/admin-portal/user-management', icon: 'UserRoundCog', order: 0 },
  { pageId: 'sharing', title: 'Sharing', teamspaceId: 'admin-portal', href: '/admin-portal/sharing', icon: 'Share2', order: 1 },
  { pageId: 'shift-management', title: 'Shift Management', teamspaceId: 'admin-portal', href: '/admin-portal/shift-management', icon: 'CalendarCog', order: 2 },
  { pageId: 'admin-notifications', title: 'Notifications', teamspaceId: 'admin-portal', href: '/admin-portal/notifications', icon: 'BellPlus', order: 3 },
  { pageId: 'admin-creator-management', title: 'Creator Management', teamspaceId: 'admin-portal', href: '/admin-portal/creator-management', icon: 'UserStar', order: 4 },
  // Resource Management was merged into the Resources app page (apps-resources)
  // on 2026-08-26 — management is gated by group there, not by a separate page.

  // CA Portal
  { pageId: 'ca-admin', title: 'Admin', teamspaceId: 'ca-portal', href: '/ca-portal/admin', icon: 'Cog', order: 0 },
  { pageId: 'ca-dashboard', title: 'Dashboard', teamspaceId: 'ca-portal', href: '/ca-portal/dashboard', icon: 'LayoutDashboard', order: 1 },
  { pageId: 'ca-shifts', title: 'Shifts', teamspaceId: 'ca-portal', href: '/ca-portal/shifts', icon: 'CalendarClock', order: 2 },
  { pageId: 'ca-disputes', title: 'Disputes', teamspaceId: 'ca-portal', href: '/ca-portal/disputes', icon: 'MessageCircleQuestionMark', order: 3 },
  { pageId: 'ca-custom-requests', title: 'Custom Requests', teamspaceId: 'ca-portal', href: '/ca-portal/custom-requests', icon: 'ImagePlay', order: 4 },
  { pageId: 'ca-campaigns', title: 'Campaigns', teamspaceId: 'ca-portal', href: '/ca-portal/campaigns', icon: 'SquareStar', order: 5 },
  // { pageId: 'calendar', title: 'Calendar', teamspaceId: 'ca-portal', href: '/ca-portal/calendar', icon: null, order: 2 },
  
  // SMM Portal
  { pageId: 'smm-admin', title: 'Admin', teamspaceId: 'smm-portal', href: '/smm-portal/admin', icon: 'Cog', order: 0 },
  { pageId: 'smm-dashboard', title: 'Dashboard', teamspaceId: 'smm-portal', href: '/smm-portal/dashboard', icon: 'LayoutDashboard', order: 1 },
  { pageId: 'smm-xaccounts', title: 'Viral Accounts', teamspaceId: 'smm-portal', href: '/smm-portal/xaccounts', icon: 'BookHeart', order: 2 },

  
  // Creator Portal
  { pageId: 'creators-custom-requests', title: 'Custom Requests', teamspaceId: 'creator-portal', href: '/creator-portal/custom-requests', icon: 'ImagePlay', order: 0 },
  { pageId: 'creators-content-planning', title: 'Content Planning', teamspaceId: 'creator-portal', href: '/creator-portal/content-planning', icon: 'CalendarCheck', order: 1 },

  // Apps
  { pageId: 'time-tracking', title: 'Time Tracking', teamspaceId: 'apps', href: '/applications/time-tracking', icon: 'ClockFading', order: 0 },
  { pageId: 'apps-password-manager', title: 'Password Manager', teamspaceId: 'apps', href: '/applications/password-manager', icon: 'KeyRound', order: 2 },
  // Resources left this teamspace on 2026-08-26 — it is org-wide now, so it
  // lives in UNIVERSAL_PAGES above and has no page permission at all.
  // OF Manager opens in its own Electron window rather than navigating in-app,
  // so it deliberately has no href — the sidebar special-cases this pageId.
  // Its icon is the brand SVG at /Icons/onlyfans.svg (no lucide equivalent).
  { pageId: 'apps-ofmanager', title: 'OF Manager', teamspaceId: 'apps', href: null, icon: 'OnlyFans', order: 4 },
  { pageId: 'apps-model-submissions', title: 'Model Submissions', teamspaceId: 'apps', href: '/applications/apps-model-submissions', icon: 'FileUser', order: 3 },
  { pageId: 'apps-prompt-library', title: 'Prompt Library', teamspaceId: 'apps', href: '/applications/apps-prompt-library', icon: 'Astroid', order: 5 },

];

export function getTeamspace(id: string): TeamspaceDef | undefined {
  return TEAMSPACES.find(ts => ts.id === id);
}

export function getPagesByTeamspace(teamspaceId: string): PageDef[] {
  return PAGES.filter(p => p.teamspaceId === teamspaceId).sort((a, b) => a.order - b.order);
}

export function getPageDef(pageId: string): PageDef | undefined {
  return PAGES.find(p => p.pageId === pageId);
}
