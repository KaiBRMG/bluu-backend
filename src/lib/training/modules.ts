/**
 * Training modules — code-defined, the way `definitions.ts` defines pages.
 *
 * A module is a list of timed parts a candidate sits on a trial. Nothing here
 * is stored in Firestore: a session records only WHICH module it runs and WHEN
 * each part opens, so changing a part's wording or length is a deploy, and a
 * session already under way keeps the `durationMs` it was started with (the
 * attempt copies its own deadline at Start).
 *
 * Shared by the public candidate surface, the API and the admin page, so it
 * must stay free of `server-only` and of anything heavy.
 */

export type TrainingModuleId = 'media-gen';

/** The four edit levels of the ID Swap part, in increasing difficulty. */
export type SlotId = 'face' | 'face-pose' | 'face-pose-body' | 'face-pose-body-bg';

export interface SlotDef {
  id: SlotId;
  /** Short name, shown on the slot and in the admin viewer. */
  label: string;
  /** One line telling the candidate what must change in this edit. */
  hint: string;
}

export interface IdSwapTask {
  kind: 'id-swap';
  /** Source images the candidate works from. */
  pickCount: number;
  /** Edits made from each picked source — `pickCount × editsPerSource` = slots. */
  editsPerSource: number;
  slots: SlotDef[];
}

export interface TrainingPartDef {
  id: string;
  title: string;
  durationMs: number;
  /** One line for the run-of-show and the home card. */
  summary: string;
  /** What the part asks, shown on the briefing and again during the task. */
  brief: string[];
  task: IdSwapTask;
}

export interface TrainingModuleDef {
  id: TrainingModuleId;
  title: string;
  blurb: string;
  /** Route segment under `/training`. */
  path: string;
  parts: TrainingPartDef[];
}

const MINUTE = 60_000;

export const TRAINING_MODULES: Record<TrainingModuleId, TrainingModuleDef> = {
  'media-gen': {
    id: 'media-gen',
    title: 'Media Generation',
    blurb: 'Timed image tasks that show how you work with AI tools.',
    path: 'media-gen',
    parts: [
      {
        id: 'id-swap-sfw',
        title: 'ID Swap (SFW)',
        durationMs: 20 * MINUTE,
        summary: 'Four edits from two images, each a different level.',
        brief: [
          'You are given a set of images. Choose 2 of them to work with.',
          'Make 4 edits in total. Each image gets 2 edits, and every one of the 4 levels below is used exactly once, so the two images never repeat a level between them.',
        ],
        task: {
          kind: 'id-swap',
          pickCount: 2,
          editsPerSource: 2,
          slots: [
            { id: 'face', label: 'Face only', hint: 'Swap only the face.' },
            { id: 'face-pose', label: 'Face + pose', hint: 'Swap the face and change the pose.' },
            { id: 'face-pose-body', label: 'Face + pose + body', hint: 'Swap the face, change the pose and the body.' },
            {
              id: 'face-pose-body-bg',
              label: 'Face + pose + body + background',
              hint: 'Change the face, pose, body and the background.',
            },
          ],
        },
      },
    ],
  },
};

export function getModule(id: string): TrainingModuleDef | null {
  return (TRAINING_MODULES as Record<string, TrainingModuleDef | undefined>)[id] ?? null;
}

export function getPart(moduleId: string, partId: string): TrainingPartDef | null {
  return getModule(moduleId)?.parts.find((p) => p.id === partId) ?? null;
}

// ─── Limits shared by client and server ──────────────────────────────────────

/**
 * The image types the training surface accepts, once: the file extension to
 * store under and the magic-byte signature the server proves the bytes against.
 * Candidates' uploads, the admin's source images and every `accept` attribute
 * derive from this, so adding a type is one line.
 */
export const IMAGE_TYPES = {
  'image/jpeg': { ext: 'jpg', sniff: 'jpeg' },
  'image/png': { ext: 'png', sniff: 'png' },
  'image/webp': { ext: 'webp', sniff: 'webp' },
} as const;
export type ImageSniff = (typeof IMAGE_TYPES)[keyof typeof IMAGE_TYPES]['sniff'];
/** The accepted types as a person says them, for messages. */
export const IMAGE_LABEL = 'JPG, PNG or WebP';
export const OUTPUT_ACCEPT = Object.keys(IMAGE_TYPES).join(',');
export const MAX_OUTPUT_BYTES = 25 * 1024 * 1024;

/**
 * The most source images one part may hold. Not a design limit — the admin may
 * attach as many as they like — but the list lives in the session document, so
 * it is bounded well inside Firestore's 1 MiB document size.
 */
export const MAX_SOURCES_PER_PART = 500;

/** Source images the admin attaches. A full-size original plus a small preview. */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
export const MAX_SOURCE_PREVIEW_BYTES = 2 * 1024 * 1024;

/**
 * An upload whose URL was signed before the deadline may land this long after
 * it. Sized for a large file on a slow line that started in the last seconds;
 * anything not finalised inside it is rejected, and the signed URL itself stops
 * working at the same instant (it is capped at `deadline + grace`).
 */
export const UPLOAD_GRACE_MS = 30_000;

/** Upload slots one attempt may ever request — the bound on swap-and-retry. */
export const MAX_UPLOAD_ATTEMPTS = 40;

/** Participants one session may hold. Generous for a sitting; bounds a runaway paste. */
export const MAX_PARTICIPANTS_PER_SESSION = 100;

export const MAX_NAME_LENGTH = 80;
export const MIN_NAME_LENGTH = 2;

/** Labels a milestone pulse: remaining ms at which the clock pulses once. */
export function milestonesFor(durationMs: number): number[] {
  const half = Math.round(durationMs / 2);
  return Array.from(new Set([half, 10 * MINUTE, 5 * MINUTE, 2 * MINUTE])).filter(
    (m) => m < durationMs && m > MINUTE,
  );
}
