'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useAdminUsers } from '@/hooks/useAdminUsers';
import { useAdminScreenshots, ScreenshotGroup } from '@/hooks/useAdminScreenshots';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/hooks/useUserData';
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader } from "@/components/ui/loader";
import { ChevronDownIcon } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatTime(isoString: string, timezone?: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    timeZone: timezone || undefined,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

interface AdminScreenshotsProps {
  selectedUserId: string | null;
  onUserChange: (userId: string | null) => void;
}

// ---------------------------------------------------------------------------
// Batch Delete Dialog
// ---------------------------------------------------------------------------

interface BatchDeleteDialogProps {
  onClose: () => void;
  onDeleted: () => void;
}

function BatchDeleteDialog({ onClose, onDeleted }: BatchDeleteDialogProps) {
  const { user } = useAuth();
  const { users, loading: usersLoading } = useAdminUsers();
  const today = toDateString(new Date());

  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState(today);
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [countsLoading, setCountsLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timeTrackedUsers = useMemo(() => users, [users]);

  // Fetch screenshot counts for all time-tracked users once they load
  useEffect(() => {
    if (!user || timeTrackedUsers.length === 0) return;
    let cancelled = false;

    const fetchCounts = async () => {
      setCountsLoading(true);
      try {
        const idToken = await user.getIdToken();
        const userIds = timeTrackedUsers.map((u) => u.uid).join(',');
        const res = await fetch(
          `/api/time-tracking/screenshots/counts?userIds=${encodeURIComponent(userIds)}`,
          { headers: { Authorization: `Bearer ${idToken}` } },
        );
        if (!res.ok) throw new Error('Failed to fetch counts');
        const data = await res.json();
        if (!cancelled) setCounts(data.counts || {});
      } catch (err) {
        console.error('[BatchDeleteDialog] Failed to load counts:', err);
      } finally {
        if (!cancelled) setCountsLoading(false);
      }
    };

    fetchCounts();
    return () => { cancelled = true; };
  }, [user, timeTrackedUsers]);

  // Only show users that have at least 1 screenshot
  const usersWithScreenshots = useMemo(
    () => timeTrackedUsers.filter((u) => (counts[u.uid] ?? 0) > 0),
    [timeTrackedUsers, counts],
  );

  const toggleUser = (uid: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const canDelete =
    selectedUserIds.size > 0 && startDate.length > 0 && endDate.length > 0 && startDate <= endDate;

  const handleDeleteConfirmed = async () => {
    if (!user || !canDelete) return;
    setIsDeleting(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/time-tracking/screenshots/batch-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          userIds: Array.from(selectedUserIds),
          startDate,
          endDate,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Batch delete failed');
      }
      setShowConfirm(false);
      onDeleted();
      onClose();
    } catch (err) {
      console.error('[BatchDeleteDialog] Delete failed:', err);
      setError(err instanceof Error ? err.message : 'Delete failed');
      setShowConfirm(false);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={() => !isDeleting && onClose()}
    >
      <div
        className="rounded-lg p-6 w-full max-w-md mx-4 flex flex-col gap-5"
        style={{
          background: 'var(--background)',
          border: '1px solid var(--border-subtle)',
          maxHeight: '85vh',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold tracking-tight">
          Batch Delete Screenshots
        </h3>

        {/* Date range */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="form-label block mb-1">Start date</label>
            <Popover open={startOpen} onOpenChange={setStartOpen}>
              <PopoverTrigger asChild>
                <button type="button" className="form-input w-full flex items-center justify-between gap-2" style={{ cursor: 'pointer' }}>
                  {startDate || 'Select date'}
                  <ChevronDownIcon style={{ width: '14px', height: '14px', flexShrink: 0 }} />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto overflow-hidden p-0" align="start">
                <Calendar
                  mode="single"
                  selected={startDate ? new Date(startDate + 'T00:00:00') : undefined}
                  captionLayout="dropdown"
                  disabled={{ after: new Date(today + 'T00:00:00') }}
                  onSelect={(date: Date | undefined) => {
                    if (date) setStartDate(date.toLocaleDateString('en-CA'));
                    setStartOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex-1">
            <label className="form-label block mb-1">End date</label>
            <Popover open={endOpen} onOpenChange={setEndOpen}>
              <PopoverTrigger asChild>
                <button type="button" className="form-input w-full flex items-center justify-between gap-2" style={{ cursor: 'pointer' }}>
                  {endDate || 'Select date'}
                  <ChevronDownIcon style={{ width: '14px', height: '14px', flexShrink: 0 }} />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto overflow-hidden p-0" align="start">
                <Calendar
                  mode="single"
                  selected={endDate ? new Date(endDate + 'T00:00:00') : undefined}
                  captionLayout="dropdown"
                  disabled={{ after: new Date(today + 'T00:00:00') }}
                  onSelect={(date: Date | undefined) => {
                    if (date) setEndDate(date.toLocaleDateString('en-CA'));
                    setEndOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
        {startDate && endDate && startDate > endDate && (
          <p className="text-xs" style={{ color: '#ef4444', marginTop: -12 }}>
            Start date must be before end date.
          </p>
        )}

        {/* User list */}
        <div>
          <label className="form-label block mb-2">Select employees</label>
          {usersLoading || countsLoading ? (
            <div className="py-4"><Loader /></div>
          ) : usersWithScreenshots.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
              No employees have screenshots in storage.
            </p>
          ) : (
            <div
              className="flex flex-col gap-1 overflow-y-auto"
              style={{ maxHeight: '220px' }}
            >
              {usersWithScreenshots.map((u) => {
                const count = counts[u.uid] ?? 0;
                const checked = selectedUserIds.has(u.uid);
                return (
                  <label
                    key={u.uid}
                    className="flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors"
                    style={{
                      background: checked ? 'var(--active-background)' : 'transparent',
                    }}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleUser(u.uid)}
                      className="flex-shrink-0"
                    />
                    <span
                      className="flex-1 text-sm"
                      style={{ color: 'var(--foreground)' }}
                    >
                      {u.displayName || `${u.firstName} ${u.lastName}`}
                    </span>
                    <span
                      className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                      style={{
                        background: 'var(--hover-background)',
                        color: 'var(--foreground-secondary)',
                      }}
                    >
                      {count}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {error && (
          <p className="text-sm" style={{ color: '#ef4444' }}>
            {error}
          </p>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-1">
          <Button
            onClick={onClose}
            variant="outline"
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            onClick={() => setShowConfirm(true)}
            disabled={!canDelete || isDeleting}
            variant="destructive"
          >
            Delete All Screenshots
          </Button>
        </div>
      </div>

      {/* Confirmation dialog */}
      {showConfirm && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => !isDeleting && setShowConfirm(false)}
        >
          <div
            className="rounded-lg p-6 max-w-sm w-full mx-4"
            style={{
              background: 'var(--background)',
              border: '1px solid var(--border-subtle)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold tracking-tight mb-2">
              Confirm Batch Delete
            </h3>
            <p className="text-sm text-muted-foreground mb-1">
              All screenshots between <strong>{startDate}</strong> and <strong>{endDate}</strong> for{' '}
              <strong>{selectedUserIds.size} employee{selectedUserIds.size !== 1 ? 's' : ''}</strong> will be
              permanently deleted. This cannot be undone.
            </p>
            <div className="flex justify-end gap-3 mt-6">
              <Button
                onClick={() => setShowConfirm(false)}
                variant="outline"
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleDeleteConfirmed}
                disabled={isDeleting}
                variant="destructive"
              >
                {isDeleting ? 'Deleting...' : 'Confirm Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AdminScreenshots({ selectedUserId, onUserChange }: AdminScreenshotsProps) {
  const { user } = useAuth();
  const { users, loading: usersLoading } = useAdminUsers();
  const { userData: viewerData } = useUserData();
  const viewerTimezone = viewerData?.timezone || 'UTC';
  const today = toDateString(new Date());

  const [selectedDate, setSelectedDate] = useState(today);
  const [dateOpen, setDateOpen] = useState(false);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  // Modal state: [groupIndex, screenIndexWithinGroup]
  const [modalPos, setModalPos] = useState<[number, number] | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showBatchDelete, setShowBatchDelete] = useState(false);

  const timeTrackedUsers = useMemo(() => users, [users]);

  const { groups, loading, error, refetch } = useAdminScreenshots(
    selectedUserId,
    selectedDate,
    viewerTimezone,
  );

  // Clear selection when user or date changes
  useEffect(() => {
    setSelectedGroupIds(new Set());
  }, [selectedUserId, selectedDate]);

  const toggleGroupSelect = useCallback((captureGroup: string) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(captureGroup)) {
        next.delete(captureGroup);
      } else {
        next.add(captureGroup);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (selectedGroupIds.size === groups.length) {
      setSelectedGroupIds(new Set());
    } else {
      setSelectedGroupIds(new Set(groups.map((g) => g.captureGroup)));
    }
  }, [selectedGroupIds.size, groups]);

  // Collect all screenshot IDs from selected groups for deletion
  const selectedScreenshotIds = useMemo(() => {
    const ids: string[] = [];
    for (const group of groups) {
      if (selectedGroupIds.has(group.captureGroup)) {
        for (const screen of group.screens) {
          ids.push(screen.id);
        }
      }
    }
    return ids;
  }, [groups, selectedGroupIds]);

  const handleDelete = async () => {
    if (!user || selectedScreenshotIds.length === 0) return;
    setIsDeleting(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/time-tracking/screenshots/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ screenshotIds: selectedScreenshotIds }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Delete failed');
      }
      setSelectedGroupIds(new Set());
      setShowDeleteConfirm(false);
      await refetch();
    } catch (err) {
      console.error('[AdminScreenshots] Delete failed:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  // Flatten all screens for modal navigation: group by group, screen by screen
  const flatScreens = useMemo(() => {
    const flat: Array<{ groupIndex: number; screenIndex: number; group: ScreenshotGroup }> = [];
    for (let gi = 0; gi < groups.length; gi++) {
      for (let si = 0; si < groups[gi].screens.length; si++) {
        flat.push({ groupIndex: gi, screenIndex: si, group: groups[gi] });
      }
    }
    return flat;
  }, [groups]);

  // Convert modalPos [groupIndex, screenIndex] to flat index
  const modalFlatIndex = useMemo(() => {
    if (!modalPos) return -1;
    const [gi, si] = modalPos;
    return flatScreens.findIndex((f) => f.groupIndex === gi && f.screenIndex === si);
  }, [modalPos, flatScreens]);

  // Keyboard navigation for modal
  useEffect(() => {
    if (modalPos === null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setModalPos(null);
      } else if (e.key === 'ArrowLeft' && modalFlatIndex > 0) {
        const prev = flatScreens[modalFlatIndex - 1];
        setModalPos([prev.groupIndex, prev.screenIndex]);
      } else if (e.key === 'ArrowRight' && modalFlatIndex < flatScreens.length - 1) {
        const next = flatScreens[modalFlatIndex + 1];
        setModalPos([next.groupIndex, next.screenIndex]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modalPos, modalFlatIndex, flatScreens]);

  const currentModalScreen = modalPos
    ? groups[modalPos[0]]?.screens[modalPos[1]]
    : null;
  const currentModalGroup = modalPos ? groups[modalPos[0]] : null;

  // Track whether the current modal image has finished loading.
  // Reset to false whenever the URL changes so the spinner shows immediately.
  const [modalImageLoaded, setModalImageLoaded] = useState(false);
  useEffect(() => {
    setModalImageLoaded(false);
  }, [currentModalScreen?.url]);

  return (
    <div>
      {/* Header row with Batch Delete button */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold tracking-tight">
          Screenshots
        </h2>
        <Button
          onClick={() => setShowBatchDelete(true)}
          variant="outline"
          size="sm"
        >
          Batch Delete
        </Button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div>
          <label className="form-label block mb-1">Employee</label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="form-input flex items-center justify-between gap-2"
                style={{ cursor: 'pointer', minWidth: '180px' }}
                disabled={usersLoading}
              >
                <span>
                  {selectedUserId
                    ? (() => { const u = timeTrackedUsers.find((u) => u.uid === selectedUserId); return u ? (u.displayName || `${u.firstName} ${u.lastName}`) : 'Select a user...'; })()
                    : 'Select a user...'}
                </span>
                <ChevronDownIcon style={{ width: '14px', height: '14px', flexShrink: 0 }} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="dark min-w-[180px]">
              <DropdownMenuItem onSelect={() => onUserChange(null)}>
                Select a user...
              </DropdownMenuItem>
              {timeTrackedUsers.map((u) => (
                <DropdownMenuItem key={u.uid} onSelect={() => onUserChange(u.uid)}>
                  {u.displayName || `${u.firstName} ${u.lastName}`}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div>
          <label className="form-label block mb-1">Date</label>
          <Popover open={dateOpen} onOpenChange={setDateOpen}>
            <PopoverTrigger asChild>
              <button type="button" className="form-input flex items-center justify-between gap-2" style={{ cursor: 'pointer' }}>
                {selectedDate}
                <ChevronDownIcon style={{ width: '14px', height: '14px', flexShrink: 0 }} />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto overflow-hidden p-0" align="start">
              <Calendar
                mode="single"
                selected={selectedDate ? new Date(selectedDate + 'T00:00:00') : undefined}
                captionLayout="dropdown"
                disabled={{ after: new Date(today + 'T00:00:00') }}
                onSelect={(date: Date | undefined) => {
                  if (date) setSelectedDate(date.toLocaleDateString('en-CA'));
                  setDateOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        </div>

        {selectedGroupIds.size > 0 && (
          <Button
            onClick={() => setShowDeleteConfirm(true)}
            variant="destructive"
          >
            Delete Selected ({selectedGroupIds.size})
          </Button>
        )}
      </div>

      {error && (
        <div className="text-sm text-red-400 mb-4">{error}</div>
      )}

      {!selectedUserId ? (
        <div className="flex items-center justify-center py-16">
          <span className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
            Select an employee to view their screenshots.
          </span>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader />
        </div>
      ) : groups.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <span className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
            No screenshots found for this date.
          </span>
        </div>
      ) : (
        <>
          {/* Select all */}
          <div className="flex items-center gap-2 mb-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={selectedGroupIds.size === groups.length}
                onCheckedChange={selectAll}
              />
              <span className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>
                Select all ({groups.length})
              </span>
            </label>
          </div>

          {/* Thumbnail grid — one thumbnail per capture group */}
          <div className="grid grid-cols-4 gap-4">
            {groups.map((group, groupIndex) => {
              const firstScreen = group.screens[0];
              if (!firstScreen) return null;

              return (
                <div key={group.captureGroup} className="relative group">
                  <div className="absolute top-2 left-2 z-10">
                    <Checkbox
                      checked={selectedGroupIds.has(group.captureGroup)}
                      onCheckedChange={() => toggleGroupSelect(group.captureGroup)}
                    />
                  </div>
                  <img
                    src={firstScreen.thumbnailUrl || firstScreen.url}
                    alt={`Screenshot at ${firstScreen.timestampUTC}`}
                    loading="lazy"
                    className="w-full rounded cursor-pointer transition-opacity hover:opacity-80"
                    style={{ border: '1px solid var(--border-subtle)', aspectRatio: '16/9', objectFit: 'cover' }}
                    onClick={() => setModalPos([groupIndex, 0])}
                  />
                  <p
                    className="text-xs mt-1 text-center"
                    style={{ color: 'var(--foreground-muted)' }}
                  >
                    {formatTime(group.timestampUTC, viewerTimezone)} &bull; {group.screenCount} screen{group.screenCount !== 1 ? 's' : ''}
                  </p>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Full-screen modal */}
      {modalPos !== null && currentModalScreen && currentModalGroup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0, 0, 0, 0.85)' }}
          onClick={() => setModalPos(null)}
        >
          {/* Close button */}
          <Button
            onClick={() => setModalPos(null)}
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 text-white text-3xl leading-none hover:opacity-70 hover:bg-transparent"
          >
            &times;
          </Button>

          {/* Left arrow */}
          {modalFlatIndex > 0 && (
            <Button
              onClick={(e) => {
                e.stopPropagation();
                const prev = flatScreens[modalFlatIndex - 1];
                setModalPos([prev.groupIndex, prev.screenIndex]);
              }}
              variant="ghost"
              className="absolute left-4 text-white text-5xl leading-none hover:opacity-70 hover:bg-transparent"
            >
              &#8249;
            </Button>
          )}

          {/* Image + info */}
          <div
            className="flex flex-col items-center max-w-[90vw] max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {!modalImageLoaded && (
              <div
                className="flex items-center justify-center rounded"
                style={{ width: '60vw', height: '33.75vw', background: 'rgba(255,255,255,0.05)' }}
              >
                <svg
                  className="animate-spin"
                  style={{ width: 40, height: 40, color: 'rgba(255,255,255,0.5)' }}
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              </div>
            )}
            <img
              src={currentModalScreen.url}
              alt={`Screenshot at ${currentModalScreen.timestampUTC}`}
              className="max-w-full max-h-[85vh] object-contain rounded"
              style={{ display: modalImageLoaded ? 'block' : 'none' }}
              onLoad={() => setModalImageLoaded(true)}
            />
            <p className="text-white mt-3 text-sm">
              {formatTime(currentModalGroup.timestampUTC, viewerTimezone)}
              {currentModalGroup.screenCount > 1 && (
                <span style={{ color: 'rgba(255,255,255,0.6)' }}>
                  {' '}&bull; Screen {currentModalScreen.screenIndex + 1} of {currentModalGroup.screenCount}
                </span>
              )}
            </p>
          </div>

          {/* Right arrow */}
          {modalFlatIndex < flatScreens.length - 1 && (
            <Button
              onClick={(e) => {
                e.stopPropagation();
                const next = flatScreens[modalFlatIndex + 1];
                setModalPos([next.groupIndex, next.screenIndex]);
              }}
              variant="ghost"
              className="absolute right-4 text-white text-5xl leading-none hover:opacity-70 hover:bg-transparent"
            >
              &#8250;
            </Button>
          )}
        </div>
      )}

      {/* Delete confirmation dialog (for selected groups) */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0, 0, 0, 0.5)' }}
          onClick={() => !isDeleting && setShowDeleteConfirm(false)}
        >
          <div
            className="rounded-lg p-6 max-w-sm w-full mx-4"
            style={{
              background: 'var(--background)',
              border: '1px solid var(--border-subtle)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold tracking-tight mb-2">
              Delete Screenshots
            </h3>
            <p className="text-sm text-muted-foreground mb-6">
              Delete {selectedGroupIds.size} capture group{selectedGroupIds.size !== 1 ? 's' : ''} ({selectedScreenshotIds.length} screenshot{selectedScreenshotIds.length !== 1 ? 's' : ''})? This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <Button
                onClick={() => setShowDeleteConfirm(false)}
                variant="outline"
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleDelete}
                variant="destructive"
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Batch delete dialog */}
      {showBatchDelete && (
        <BatchDeleteDialog
          onClose={() => setShowBatchDelete(false)}
          onDeleted={refetch}
        />
      )}
    </div>
  );
}
