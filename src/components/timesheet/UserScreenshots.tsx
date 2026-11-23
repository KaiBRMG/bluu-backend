'use client';

import { useState, useMemo, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/hooks/useUserData';
import { useAdminScreenshots, ScreenshotGroup } from '@/hooks/useAdminScreenshots';
import { Loader } from '@/components/ui/loader';
import { Skeleton } from '@/components/ui/skeleton';
import { SURFACE } from '@/lib/surfaces';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ChevronDownIcon, ChevronLeft, ChevronRight, Info, X } from 'lucide-react';
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
    <div className={cn('rounded-xl p-6', SURFACE)}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-sm text-zinc-400">
          <Info aria-hidden="true" className="size-3.5 shrink-0" />
          You must contact management if you wish to delete one or more screenshots
        </p>
      {/* Date picker */}
        <div>
          <Popover open={dateOpen} onOpenChange={setDateOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`Screenshots for ${selectedDate}`}
                className="form-input flex items-center justify-between gap-2 tabular-nums"
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
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="aspect-video w-full rounded-md" />
              <Skeleton className="mx-auto mt-1.5 h-3 w-20" />
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <p className="py-2 text-sm text-zinc-400">No screenshots for this date.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {groups.map((group, groupIndex) => {
            const firstScreen = group.screens[0];
            if (!firstScreen) return null;
            const time = formatTime(group.timestampUTC, viewerTimezone);
            const count = `${group.screenCount} screen${group.screenCount !== 1 ? 's' : ''}`;

            return (
              <li key={group.captureGroup}>
                <button
                  type="button"
                  onClick={() => setModalPos([groupIndex, 0])}
                  aria-label={`Open screenshot from ${time}, ${count}`}
                  className="group block w-full rounded-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <img
                    src={firstScreen.thumbnailUrl || firstScreen.url}
                    alt=""
                    loading="lazy"
                    className="aspect-video w-full rounded-md border border-white/[0.07] object-cover transition-opacity duration-[120ms] group-hover:opacity-80"
                  />
                  <span className="mt-1.5 block text-center text-xs text-zinc-400 tabular-nums">
                    {time} · {count}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
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
            aria-label="Close"
            className="absolute top-4 right-4 text-white hover:opacity-70 hover:bg-transparent"
          >
            <X aria-hidden="true" className="size-6" />
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
              size="icon"
              aria-label="Previous screenshot"
              className="absolute left-4 size-12 text-white hover:opacity-70 hover:bg-transparent"
            >
              <ChevronLeft aria-hidden="true" className="size-8" />
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
                  {' '}· Screen {currentModalScreen.screenIndex + 1} of {currentModalGroup.screenCount}
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
              size="icon"
              aria-label="Next screenshot"
              className="absolute right-4 size-12 text-white hover:opacity-70 hover:bg-transparent"
            >
              <ChevronRight aria-hidden="true" className="size-8" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
