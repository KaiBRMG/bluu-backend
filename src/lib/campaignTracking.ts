import type { Timestamp } from '@/types/firestore';

export type CRStatus = 'Awaiting Approval' | 'In Progress' | 'Rejected' | 'Completed';
export type CRType = 'CR' | 'Call' | 'Item';
export type CRPriority = 'Low' | 'Medium' | 'High';
export type CallType = 'Clean Video' | 'Clean Voice' | 'NSFW Video' | 'NSFW Voice';

export interface CampaignEntry {
  id: string;
  CR: string;
  creatorID: string;
  type: CRType;
  status: CRStatus;
  priority?: CRPriority | null;
  fanName: string;
  profileLink: string;
  description: string;
  length?: string;
  totalAmount: number;
  amountPaid: number;
  address?: string;
  socialUsername?: string;
  socialPlatform?: string;
  callType?: CallType;
  dueDate?: string | null;
  dueDateTimezone?: string | null;
  managerComment?: string;
  createdBy: string;
  lastEditedBy: string;
  createdTime: string;
  lastEditedTime: string;
  isArchived: boolean;
}

export interface CampaignEntryFirestore extends Omit<CampaignEntry, 'id' | 'createdTime' | 'lastEditedTime' | 'dueDate'> {
  createdTime: Timestamp;
  lastEditedTime: Timestamp;
  dueDate?: string | null;
  dueDateTimezone?: string | null;
}

export const STATUS_COLORS: Record<CRStatus, string> = {
  'Awaiting Approval': 'text-orange-400 bg-orange-500/10',
  'Rejected': 'text-red-400 bg-red-500/10',
  'In Progress': 'text-blue-400 bg-blue-500/10',
  'Completed': 'text-green-400 bg-green-500/10',
};

export const STATUS_DOT: Record<CRStatus, string> = {
  'Awaiting Approval': 'bg-orange-400',
  'Rejected': 'bg-red-400',
  'In Progress': 'bg-blue-400',
  'Completed': 'bg-green-400',
};

export const STATUS_SORT: Record<CRStatus, number> = {
  'Rejected': 0,
  'Awaiting Approval': 1,
  'In Progress': 2,
  'Completed': 3,
};

export const PRIORITY_COLORS: Record<CRPriority, string> = {
  'High': 'text-red-400 bg-red-500/10',
  'Medium': 'text-yellow-400 bg-yellow-500/10',
  'Low': 'text-zinc-400 bg-zinc-500/10',
};

export function formatCR(n: number): string {
  return `CR${String(n).padStart(4, '0')}`;
}

export function truncate(text: string, limit = 80): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + '…';
}

export function formatAmount(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export const PRIORITY_RANK: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

export function sortByStatus(entries: CampaignEntry[]): CampaignEntry[] {
  return [...entries].sort((a, b) => STATUS_SORT[a.status] - STATUS_SORT[b.status]);
}

export function sortByPriority(entries: CampaignEntry[]): CampaignEntry[] {
  return [...entries].sort((a, b) => {
    const pa = a.priority ? (PRIORITY_RANK[a.priority] ?? 3) : 3;
    const pb = b.priority ? (PRIORITY_RANK[b.priority] ?? 3) : 3;
    if (pa !== pb) return pa - pb;
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  });
}

/** Format a UTC ISO timestamp for display in the given IANA timezone. */
export function formatInTimezone(isoString: string | null | undefined, timezone: string | null | undefined): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    timeZone: timezone || undefined,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Format a dueDate string ("YYYY-MM-DD" or ISO) — no timezone conversion, just pretty-print. */
export function formatDueDate(dueDate: string | null | undefined): string {
  if (!dueDate) return '—';
  const datePart = dueDate.split('T')[0];
  if (!datePart || !/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return dueDate;
  const [y, m, d] = datePart.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export const COMMON_TIMEZONES = [
  { label: 'UTC', value: 'UTC' },
  { label: 'Eastern Time (US)', value: 'America/New_York' },
  { label: 'Central Time (US)', value: 'America/Chicago' },
  { label: 'Mountain Time (US)', value: 'America/Denver' },
  { label: 'Pacific Time (US)', value: 'America/Los_Angeles' },
  { label: 'São Paulo (BRT)', value: 'America/Sao_Paulo' },
  { label: 'London (GMT/BST)', value: 'Europe/London' },
  { label: 'Paris / Berlin (CET)', value: 'Europe/Paris' },
  { label: 'South Africa (SAST, GMT+2)', value: 'Africa/Johannesburg' },
  { label: 'Dubai (GST, GMT+4)', value: 'Asia/Dubai' },
  { label: 'Tokyo (JST, GMT+9)', value: 'Asia/Tokyo' },
  { label: 'Sydney (AEST)', value: 'Australia/Sydney' },
];

export function firestoreToEntry(id: string, data: Record<string, unknown>): CampaignEntry {
  // dueDate may be a legacy Firestore Timestamp or a plain "YYYY-MM-DD" string (new format)
  const rawDue = data.dueDate as { toDate?: () => Date } | string | null | undefined;
  const dueDate = !rawDue
    ? null
    : typeof rawDue === 'string'
      ? rawDue
      : typeof rawDue.toDate === 'function'
        ? rawDue.toDate().toISOString().split('T')[0]
        : null;

  return {
    id,
    CR: data.CR as string,
    creatorID: data.creatorID as string,
    type: data.type as CRType,
    status: data.status as CRStatus,
    priority: (data.priority as CampaignEntry['priority']) ?? null,
    fanName: data.fanName as string,
    profileLink: data.profileLink as string,
    description: data.description as string,
    length: data.length as string | undefined,
    totalAmount: data.totalAmount as number,
    amountPaid: data.amountPaid as number,
    address: data.address as string | undefined,
    socialUsername: data.socialUsername as string | undefined,
    socialPlatform: data.socialPlatform as string | undefined,
    callType: data.callType as CallType | undefined,
    dueDate,
    dueDateTimezone: (data.dueDateTimezone as string | null | undefined) ?? null,
    managerComment: data.managerComment as string | undefined,
    createdBy: data.createdBy as string,
    lastEditedBy: data.lastEditedBy as string,
    createdTime: (data.createdTime as { toDate?: () => Date } | null)?.toDate?.()?.toISOString() ?? '',
    lastEditedTime: (data.lastEditedTime as { toDate?: () => Date } | null)?.toDate?.()?.toISOString() ?? '',
    isArchived: data.isArchived as boolean,
  };
}

