import { Timestamp } from 'firebase/firestore';

export interface UserDocument {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  firstName: string;
  lastName: string;
  groups: string[];
  createdAt: Timestamp;
  lastLoginAt: Timestamp;
  isActive: boolean;
  role?: 'admin' | 'member';
}

export interface GroupDocument {
  id: string;
  name: string;
  description?: string;
  members: string[];
  createdAt: Timestamp;
  isDefault: boolean;
  workspaceId?: string;
}

// Future: Page permissions
export type PermissionRole = 'full_access' | 'can_edit' | 'can_view';

export interface PageDocument {
  pageId: string;
  title: string;
  parentPageId: string | null;
  ownerId: string;
  inheritPermissions: boolean;
  permissions: {
    users: Record<string, PermissionRole>;
    groups: Record<string, PermissionRole>;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
