import { Timestamp } from 'firebase/firestore';

// ─── Group hierarchy ────────────────────────────────────────────────

export type GroupSlug =
  | 'general'
  | 'chat-agents'
  | 'social-media-manager'
  | 'account-manager'
  | 'admin';

/** Numeric level for each group. Higher = more privileged. */
export const GROUP_HIERARCHY: Record<string, number> = {
  'general': -1,
  'chat-agents': 0,
  'social-media-manager': 0,
  'account-manager': 1,
  'admin': 2,
};

/** Human-readable display names (singular). */
export const GROUP_DISPLAY_NAMES: Record<string, string> = {
  'general': 'General',
  'chat-agents': 'Chat Agent',
  'social-media-manager': 'Social Media Manager',
  'account-manager': 'Account Manager',
  'admin': 'Admin',
};

// ─── Permission types ───────────────────────────────────────────────

export type PermissionRole = 'full_access' | 'can_edit' | 'can_view';

/** Permission role ranking — higher index = more permissive. */
export const PERMISSION_ROLE_RANK: Record<PermissionRole, number> = {
  'can_view': 0,
  'can_edit': 1,
  'full_access': 2,
};

// ─── User ───────────────────────────────────────────────────────────

export interface UserDocument {
  uid: string;
  workEmail: string;
  displayName: string;
  photoURL?: string;
  firstName: string;
  lastName: string;
  groups: string[];
  createdAt: Timestamp;
  lastLoginAt: Timestamp;
  isActive: boolean;
  role?: 'admin' | 'member';

  address?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
  };

  gender?: string;
  DOB?: Timestamp;
  jobTitle?: string;
  employmentType?: string;

  contactInfo?: {
    phoneNumber?: string;
    countryCode?: string;
    personalEmail?: string;
    telegramHandle?: string;
    emergencyContactName?: string;
    emergencyContactNumber?: string;
    emergencyContactEmail?: string;
  };

  paymentMethod?: string;
  paymentInfo?: string;

  userComments?: string;
}

// ─── Group ──────────────────────────────────────────────────────────

export interface GroupDocument {
  id: string;
  name: string;
  description?: string;
  members: string[];
  createdAt: Timestamp;
  isDefault: boolean;
  level: number;
}

// ─── Teamspace ──────────────────────────────────────────────────────

export interface TeamspaceDocument {
  id: string;
  name: string;
  icon: string;
  order: number;
  createdAt: Timestamp;
}

// ─── Page ───────────────────────────────────────────────────────────

export interface PageDocument {
  pageId: string;
  title: string;
  teamspaceId: string;
  href: string | null;
  icon: string | null;
  order: number;
  ownerId: string;
  permissions: {
    users: Record<string, PermissionRole>;
    groups: Record<string, PermissionRole>;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Resolved access (returned by permission resolver) ──────────────

export interface ResolvedAccess {
  pageId: string;
  title: string;
  teamspaceId: string;
  href: string | null;
  icon: string | null;
  order: number;
  effectiveRole: PermissionRole;
  grantedVia: 'user' | 'group';
  grantingGroupId?: string;
}
