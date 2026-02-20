'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useAdminUsers } from '@/hooks/useAdminUsers';
import { useAdminScreenshots, ScreenshotGroup } from '@/hooks/useAdminScreenshots';
import { useAuth } from '@/components/AuthProvider';

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

export default function AdminScreenshots({ selectedUserId, onUserChange }: AdminScreenshotsProps) {
  const { user } = useAuth();
  const { users, loading: usersLoading } = useAdminUsers();
  const today = toDateString(new Date());

  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  // Modal state: [groupIndex, screenIndexWithinGroup]
  const [modalPos, setModalPos] = useState<[number, number] | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const timeTrackedUsers = useMemo(() => {
    const tracked = users.filter((u) => u.timeTracking === true);
    return tracked.length > 0 ? tracked : users;
  }, [users]);

  const { groups, loading, error, refetch } = useAdminScreenshots(
    selectedUserId,
    selectedDate,
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

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
        Screenshots
      </h2>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div>
          <label className="form-label block mb-1">Employee</label>
          <select
            className="form-input"
            value={selectedUserId || ''}
            onChange={(e) => onUserChange(e.target.value || null)}
            disabled={usersLoading}
          >
            <option value="">Select a user...</option>
            {timeTrackedUsers.map((u) => (
              <option key={u.uid} value={u.uid}>
                {u.displayName || `${u.firstName} ${u.lastName}`}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="form-label block mb-1">Date</label>
          <input
            type="date"
            className="form-input"
            value={selectedDate}
            onChange={(e) => { if (e.target.value) setSelectedDate(e.target.value); }}
            max={today}
            required
          />
        </div>

        {selectedGroupIds.size > 0 && (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: '#ef4444',
              color: '#fff',
            }}
          >
            Delete Selected ({selectedGroupIds.size})
          </button>
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
          <span className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
            Loading screenshots...
          </span>
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
              <input
                type="checkbox"
                checked={selectedGroupIds.size === groups.length}
                onChange={selectAll}
                className="w-4 h-4"
                style={{ accentColor: '#3b82f6' }}
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
                    <input
                      type="checkbox"
                      checked={selectedGroupIds.has(group.captureGroup)}
                      onChange={() => toggleGroupSelect(group.captureGroup)}
                      className="w-4 h-4"
                      style={{ accentColor: '#3b82f6' }}
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
                    {formatTime(group.timestampUTC)} &bull; {group.screenCount} screen{group.screenCount !== 1 ? 's' : ''}
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
          <button
            onClick={() => setModalPos(null)}
            className="absolute top-4 right-4 text-white text-3xl leading-none hover:opacity-70 transition-opacity"
          >
            &times;
          </button>

          {/* Left arrow */}
          {modalFlatIndex > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const prev = flatScreens[modalFlatIndex - 1];
                setModalPos([prev.groupIndex, prev.screenIndex]);
              }}
              className="absolute left-4 text-white text-5xl leading-none hover:opacity-70 transition-opacity"
            >
              &#8249;
            </button>
          )}

          {/* Image + info */}
          <div
            className="flex flex-col items-center max-w-[90vw] max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={currentModalScreen.url}
              alt={`Screenshot at ${currentModalScreen.timestampUTC}`}
              className="max-w-full max-h-[85vh] object-contain rounded"
            />
            <p className="text-white mt-3 text-sm">
              {formatTime(currentModalGroup.timestampUTC)}
              {currentModalGroup.screenCount > 1 && (
                <span style={{ color: 'rgba(255,255,255,0.6)' }}>
                  {' '}&bull; Screen {currentModalScreen.screenIndex + 1} of {currentModalGroup.screenCount}
                </span>
              )}
            </p>
          </div>

          {/* Right arrow */}
          {modalFlatIndex < flatScreens.length - 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const next = flatScreens[modalFlatIndex + 1];
                setModalPos([next.groupIndex, next.screenIndex]);
              }}
              className="absolute right-4 text-white text-5xl leading-none hover:opacity-70 transition-opacity"
            >
              &#8250;
            </button>
          )}
        </div>
      )}

      {/* Delete confirmation dialog */}
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
            <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
              Delete Screenshots
            </h3>
            <p className="text-sm mb-6" style={{ color: 'var(--foreground-secondary)' }}>
              Delete {selectedGroupIds.size} capture group{selectedGroupIds.size !== 1 ? 's' : ''} ({selectedScreenshotIds.length} screenshot{selectedScreenshotIds.length !== 1 ? 's' : ''})? This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="btn-secondary"
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: '#ef4444',
                  color: '#fff',
                  opacity: isDeleting ? 0.6 : 1,
                }}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
