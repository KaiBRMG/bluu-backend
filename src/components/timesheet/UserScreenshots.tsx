'use client';

import { useState, useMemo, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/hooks/useUserData';
import { useAdminScreenshots, ScreenshotGroup } from '@/hooks/useAdminScreenshots';
import { Loader } from '@/components/ui/loader';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ChevronDownIcon } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

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

export default function UserScreenshots() {
  const { user } = useAuth();
  const { userData } = useUserData();
  const viewerTimezone = userData?.timezone || 'UTC';
  const today = toDateString(new Date());

  const [selectedDate, setSelectedDate] = useState(today);
  const [dateOpen, setDateOpen] = useState(false);
  // Modal state: [groupIndex, screenIndexWithinGroup]
  const [modalPos, setModalPos] = useState<[number, number] | null>(null);

  const userId = user?.uid ?? null;

  const { groups, loading, error } = useAdminScreenshots(
    userId,
    selectedDate,
    viewerTimezone,
  );

  // Flatten all screens for modal navigation
  const flatScreens = useMemo(() => {
    const flat: Array<{ groupIndex: number; screenIndex: number; group: ScreenshotGroup }> = [];
    for (let gi = 0; gi < groups.length; gi++) {
      for (let si = 0; si < groups[gi].screens.length; si++) {
        flat.push({ groupIndex: gi, screenIndex: si, group: groups[gi] });
      }
    }
    return flat;
  }, [groups]);

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

  const currentModalScreen = modalPos ? groups[modalPos[0]]?.screens[modalPos[1]] : null;
  const currentModalGroup = modalPos ? groups[modalPos[0]] : null;

  const [modalImageLoaded, setModalImageLoaded] = useState(false);
  useEffect(() => {
    setModalImageLoaded(false);
  }, [currentModalScreen?.url]);

  return (
    <div>
      {/* Date picker */}
      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div>
          <label className="form-label block mb-1">Date</label>
          <Popover open={dateOpen} onOpenChange={setDateOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="form-input flex items-center justify-between gap-2"
                style={{ cursor: 'pointer' }}
              >
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
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
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
        <div className="grid grid-cols-4 gap-4">
          {groups.map((group, groupIndex) => {
            const firstScreen = group.screens[0];
            if (!firstScreen) return null;

            return (
              <div key={group.captureGroup} className="relative">
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
                <Loader />
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
    </div>
  );
}
