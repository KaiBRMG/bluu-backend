'use client';

import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import type { DisputeDocument, CreatorDocument, ApprovalStatus } from '@/types/firestore';

// ─── Types ────────────────────────────────────────────────────────────

export interface CaUser {
  uid: string;
  displayName: string;
}

export interface DisputeFetchResult {
  disputes: DisputeDocument[];
  total: number;
  totalPages: number;
}

export interface AdminFilters {
  createdBy?: string;
  assignedTo?: string;
  creator?: string;
}

export interface CreateDisputePayload {
  assignedTo: string;
  Creator: string;
  saleDate: string;    // ISO string (local tz)
  saleAmount: number;
  fanName: string;
  Comment: string;
}

// ─── Cache helpers (sessionStorage, 5 min TTL) ────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000;

function readCache<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data: T; cachedAt: number };
    if (Date.now() - parsed.cachedAt > CACHE_TTL_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, data: T): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({ data, cachedAt: Date.now() }));
  } catch {
    // non-fatal
  }
}

const CREATORS_KEY = 'bluu_disputes_creators_v1';
const CA_USERS_KEY = 'bluu_disputes_ca_users_v1';

// ─── Hook ─────────────────────────────────────────────────────────────

export function useDisputesData() {
  const { user } = useAuth();

  const [creators, setCreators] = useState<CreatorDocument[]>([]);
  const [caUsers, setCaUsers] = useState<CaUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Authenticated fetch helper ──────────────────────────────────────

  const authFetch = useCallback(async (url: string, options: RequestInit = {}) => {
    if (!user) throw new Error('Not authenticated');
    const idToken = await user.getIdToken();
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        ...(options.headers ?? {}),
      },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Request failed: ${res.status}`);
    }
    return res.json();
  }, [user]);

  // ── Load creators (cached) ──────────────────────────────────────────

  const loadCreators = useCallback(async () => {
    const cached = readCache<CreatorDocument[]>(CREATORS_KEY);
    if (cached) { setCreators(cached); return; }
    try {
      const data = await authFetch('/api/disputes/creators');
      setCreators(data.creators);
      writeCache(CREATORS_KEY, data.creators);
    } catch (err) {
      console.error('[useDisputesData] loadCreators failed:', err);
    }
  }, [authFetch]);

  // ── Load CA users (cached) ──────────────────────────────────────────

  const loadCaUsers = useCallback(async () => {
    const cached = readCache<CaUser[]>(CA_USERS_KEY);
    if (cached) { setCaUsers(cached); return; }
    try {
      const data = await authFetch('/api/disputes/ca-users');
      setCaUsers(data.users);
      writeCache(CA_USERS_KEY, data.users);
    } catch (err) {
      console.error('[useDisputesData] loadCaUsers failed:', err);
    }
  }, [authFetch]);

  useEffect(() => {
    if (!user) return;
    loadCreators();
    loadCaUsers();
  }, [user, loadCreators, loadCaUsers]);

  // ── Fetch disputes (not cached — always fresh) ─────────────────────

  const fetchDisputes = useCallback(async (
    filter: string,
    page: number,
    adminFilters?: AdminFilters,
  ): Promise<DisputeFetchResult> => {
    const params = new URLSearchParams({ filter, page: String(page) });
    if (adminFilters?.createdBy) params.set('createdBy', adminFilters.createdBy);
    if (adminFilters?.assignedTo) params.set('assignedTo', adminFilters.assignedTo);
    if (adminFilters?.creator) params.set('creator', adminFilters.creator);

    const data = await authFetch(`/api/disputes?${params}`);
    return { disputes: data.disputes, total: data.total, totalPages: data.totalPages };
  }, [authFetch]);

  // ── Create dispute ──────────────────────────────────────────────────

  const createDispute = useCallback(async (payload: CreateDisputePayload): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await authFetch('/api/disputes', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create dispute';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  // ── Set CA approval ─────────────────────────────────────────────────

  const setCaApproval = useCallback(async (
    disputeId: string,
    value: Extract<ApprovalStatus, 'Approved' | 'Rejected'>,
    reason?: string,
  ): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await authFetch(`/api/disputes/${disputeId}/ca-approval`, {
        method: 'PATCH',
        body: JSON.stringify({ CaApproval: value, reason }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update CA approval';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  // ── Set admin approval ──────────────────────────────────────────────

  const setAdminApproval = useCallback(async (
    disputeId: string,
    value: Extract<ApprovalStatus, 'Approved' | 'Rejected'>,
    reason?: string,
  ): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await authFetch(`/api/disputes/${disputeId}/admin-approval`, {
        method: 'PATCH',
        body: JSON.stringify({ AdminApproval: value, reason }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update admin approval';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  return {
    creators,
    caUsers,
    loading,
    error,
    fetchDisputes,
    createDispute,
    setCaApproval,
    setAdminApproval,
  };
}
