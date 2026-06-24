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
  { id: 'ca-portal', name: 'CA Portal', icon: 'MessageSquareQuote', order: 0 },
  { id: 'smm-portal', name: 'SMM Portal', icon: 'MessageSquareQuote', order: 1 },
  { id: 'creators', name: 'Creators', icon: 'ShieldUser', order: 2 },
  { id: 'admin', name: 'Admin', icon: 'ShieldUser', order: 3 },
  { id: 'apps', name: 'Apps', icon: 'PanelLeft', order: 4 },
];

export const PAGES: PageDef[] = [
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
  { pageId: 'smm-twitterx', title: 'Twitter/X', teamspaceId: 'smm-portal', href: '/smm-portal/twitterx', icon: 'LayoutDashboard', order: 2 },


  // Admin
  { pageId: 'user-management', title: 'User Management', teamspaceId: 'admin', href: '/admin/user-management', icon: 'UserRoundCog', order: 0 },
  { pageId: 'sharing', title: 'Sharing', teamspaceId: 'admin', href: '/admin/sharing', icon: 'Share2', order: 1 },
  { pageId: 'shift-management', title: 'Shift Management', teamspaceId: 'admin', href: '/admin/shift-management', icon: 'CalendarCog', order: 2 },
  { pageId: 'admin-notifications', title: 'Notifications', teamspaceId: 'admin', href: '/admin/notifications', icon: 'BellPlus', order: 3 },
  { pageId: 'admin-creator-management', title: 'Creator Management', teamspaceId: 'admin', href: '/admin/creator-management', icon: 'UserStar', order: 4 },
  
  // Creators
  { pageId: 'creators-custom-requests', title: 'Custom Requests', teamspaceId: 'creators', href: '/creators/custom-requests', icon: 'ImagePlay', order: 0 },
  { pageId: 'creators-content-planning', title: 'Content Planning', teamspaceId: 'creators', href: '/creators/content-planning', icon: 'CalendarCheck', order: 1 },

  // Apps
  { pageId: 'time-tracking', title: 'Time Tracking', teamspaceId: 'apps', href: '/applications/time-tracking', icon: 'ClockFading', order: 0 },
  { pageId: 'apps-password-manager', title: 'Password Manager', teamspaceId: 'apps', href: '/applications/password-manager', icon: 'KeyRound', order: 5 },
  { pageId: 'apps-resources', title: 'Resources', teamspaceId: 'apps', href: '/applications/apps-resources', icon: 'BookOpen', order: 1 },
  // { pageId: 'apps-onlyfans', title: 'OnlyFans', teamspaceId: 'apps', href: '/applications/apps-onlyfans', icon: '', order: 2 },

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
