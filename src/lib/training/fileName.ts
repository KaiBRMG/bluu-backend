import { MAX_FILE_NAME_LENGTH } from '@/lib/training/modules';

/**
 * A candidate's file name made safe to store and to put in a Drive name: no path
 * separators or control characters, no leading dots, bounded length with the
 * extension kept. It is used for DISPLAY and the Drive copy's name only — the
 * Storage path is always server-chosen.
 */
export function cleanFileName(raw: string): string {
  let name = raw.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  if (!name) return 'file';
  if (name.length > MAX_FILE_NAME_LENGTH) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : '';
    name = name.slice(0, MAX_FILE_NAME_LENGTH - ext.length) + ext;
  }
  return name;
}
