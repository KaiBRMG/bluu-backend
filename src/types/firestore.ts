import { Timestamp } from 'firebase/firestore';

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
