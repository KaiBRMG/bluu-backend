import { Timestamp } from 'firebase/firestore';

// ─── Group hierarchy ────────────────────────────────────────────────

export type GroupSlug = 'unassigned' | 'CA' | 'SMM' | 'OFAM' | 'admin';

/** Numeric level for each group. Higher = more privileged. */
export const GROUP_HIERARCHY: Record<string, number> = {
  'unassigned': -1,
  'CA': 0,
  'SMM': 0,
  'OFAM': 1,
  'admin': 2,
};

/** Human-readable display names. */
export const GROUP_DISPLAY_NAMES: Record<string, string> = {
  'unassigned': 'Unassigned',
  'CA': 'Chat Agents',
  'SMM': 'Social Media Manager',
  'OFAM': 'Account Manager',
  'admin': 'Admin',
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

  timezone?: string;
  timezoneOffset?: string;
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

// ─── Page permission (Firestore document) ───────────────────────────

export interface PagePermissionDoc {
  pageId: string;
  groups: Record<string, true>;  // groupSlug -> true (presence = access)
  users: Record<string, true>;   // uid -> true (presence = access)
}

// ─── Resolved access (returned to client after permission resolution) ─

export interface ResolvedAccess {
  pageId: string;
  title: string;
  teamspaceId: string;
  href: string | null;
  icon: string | null;
  order: number;
  grantedVia: 'user' | 'group';
  grantingGroupId?: string;
}
