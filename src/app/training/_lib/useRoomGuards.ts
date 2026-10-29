'use client';

import { useEffect } from 'react';

/** Marks a drop zone that takes a file. Everything else on the page refuses one. */
export const DROPZONE_ATTR = 'data-dropzone';
/** Marks a link that downloads a file. The browser starts one as a navigation, which must not raise the leave prompt. */
export const DOWNLOAD_ATTR = 'data-download';
/** How long after clicking a download link a leave prompt is suppressed. */
const DOWNLOAD_QUIET_MS = 3000;

const carriesFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
const inOpenZone = (e: Event) => e.target instanceof Element && !!e.target.closest(`[${DROPZONE_ATTR}="on"]`);

/**
 * Two guards for a live room.
 *
 * A file dropped anywhere that is not a drop zone — between two slots, on a slot
 * that is uploading, on a locked one — makes the browser open it, which unloads
 * the room, ends the screen share and kills every upload in flight. So a file
 * dragged over the page is refused everywhere except an open zone (the cursor
 * says so), and the browser is asked before the tab is closed or refreshed:
 * a refresh costs the share, and the lock that follows costs the clock.
 *
 * Dragged text is left alone, so selecting words and dropping them into a field
 * still works. A click on a download link is let through without the prompt: a
 * signed Storage URL that answers as an attachment is still a navigation until
 * the browser sees the response, and asking "leave site?" on the action a
 * candidate repeats for every source would make Cancel — the safe-looking answer —
 * cancel the download.
 */
export function useRoomGuards() {
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!carriesFiles(e) || inOpenZone(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    };
    const drop = (e: DragEvent) => {
      if (!carriesFiles(e) || inOpenZone(e)) return;
      e.preventDefault();
    };
    let downloadingUntil = 0;
    const click = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest(`[${DOWNLOAD_ATTR}]`)) downloadingUntil = Date.now() + DOWNLOAD_QUIET_MS;
    };
    const leave = (e: BeforeUnloadEvent) => {
      if (Date.now() < downloadingUntil) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    window.addEventListener('beforeunload', leave);
    window.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('click', click, true);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
      window.removeEventListener('beforeunload', leave);
    };
  }, []);
}
