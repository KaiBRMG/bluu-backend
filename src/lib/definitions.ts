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

export const TEAMSPACES: TeamspaceDef[] = [
  { id: 'ca-portal', name: 'CA Portal', icon: '/Icons/ca-portal.svg', order: 0 },
  { id: 'admin', name: 'Admin', icon: '/Icons/shield-user.svg', order: 1 },
  { id: 'apps', name: 'Apps', icon: '/Icons/layout-panel-left.svg', order: 2 },
];

export const PAGES: PageDef[] = [
  // CA Portal
  { pageId: 'shifts', title: 'Shifts', teamspaceId: 'ca-portal', href: '/ca-portal/shifts', icon: '/Icons/calendar-clock.svg', order: 0 },
  // { pageId: 'documents', title: 'Documents', teamspaceId: 'ca-portal', href: '/ca-portal/documents', icon: null, order: 1 },
  // { pageId: 'calendar', title: 'Calendar', teamspaceId: 'ca-portal', href: '/ca-portal/calendar', icon: null, order: 2 },
  // Admin
  { pageId: 'user-management', title: 'User Management', teamspaceId: 'admin', href: '/admin/user-management', icon: '/Icons/user-round-cog.svg', order: 0 },
  { pageId: 'sharing', title: 'Sharing', teamspaceId: 'admin', href: '/admin/sharing', icon: '/Icons/share-2.svg', order: 1 },
  { pageId: 'shift-management', title: 'Shift Management', teamspaceId: 'admin', href: '/admin/shift-management', icon: '/Icons/calendar-cog.svg', order: 2 },
  // Apps
  { pageId: 'time-tracking', title: 'Time Tracking', teamspaceId: 'apps', href: '/applications/time-tracking', icon: '/Icons/time-tracking.svg', order: 0 },
  // { pageId: 'app-2', title: 'App 2 (Placeholder)', teamspaceId: 'apps', href: null, icon: null, order: 1 },
  // { pageId: 'app-3', title: 'App 3 (Placeholder)', teamspaceId: 'apps', href: null, icon: null, order: 2 },
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
