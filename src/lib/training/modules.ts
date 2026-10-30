/**
 * Training modules — code-defined, the way `definitions.ts` defines pages.
 *
 * A MODULE is a switch an admin turns on and off; it holds a list of TESTS that
 * the admin opens one at a time. Nothing here is stored in Firestore: a module
 * doc records only whether it is on and which test is open, so changing a test's
 * wording, length or slots is a deploy. An attempt copies its own deadline at
 * Start, so a deploy never changes a running clock.
 *
 * Each test's briefing copy lives HERE, next to its slots, duration and dataset
 * rules, so the words and the mechanics cannot drift apart. Anything the brief
 * says that the code also knows — the submission file names, which identity goes
 * with which source, a correction's text — is rendered from the slots (see
 * `BriefBlock`), never typed twice.
 *
 * Shared by the public candidate surface, the API and the admin page, so it
 * must stay free of `server-only` and of anything heavy.
 */

export type TrainingModuleId = 'media-gen';

/** Identity datasets. The id is also the Drive folder name under `Datasets/`. */
export type DatasetId = 'ADAM' | 'COLE' | 'JACKSON' | 'JOE';

export const DATASETS: Record<DatasetId, { label: string }> = {
  ADAM: { label: 'Adam' },
  COLE: { label: 'Cole' },
  JACKSON: { label: 'Jackson' },
  JOE: { label: 'Joe' },
};
export const DATASET_IDS = Object.keys(DATASETS) as DatasetId[];

export type TestId = 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7';

/**
 * How a test is sat.
 *   edit      final images paired with source images (T1–T5)
 *   generate  final images from scratch, sources are viewing-only inspiration (T6)
 *   sequence  timed images shown one at a time, answered in text (T7)
 */
export type TestKind = 'edit' | 'generate' | 'sequence';

// ─── Briefing copy ───────────────────────────────────────────────────────────

/**
 * One block of briefing text. A string is a paragraph, a string array is a
 * bullet list, and the three objects are rendered from the test's slots so the
 * copy and the mechanics cannot disagree.
 */
export type BriefBlock =
  | string
  | string[]
  | { assignments: true }
  | { corrections: true };

export interface BriefSection {
  heading: string;
  /** Sub-headings sit one level under the section before them. */
  sub?: boolean;
  body: BriefBlock[];
}

export interface BriefDef {
  /** Opening blocks, before the first heading. The briefing shows the first paragraph only. */
  lead: BriefBlock[];
  sections: BriefSection[];
}

// ─── Slots ───────────────────────────────────────────────────────────────────

export interface SlotDef {
  /** Stable key: Firestore map key, Storage path part, API param. */
  id: string;
  /** The server-chosen name of the Drive copy (without extension): `T1 - 001`. */
  stem: string;
  /** Shown on the slot. */
  label: string;
  /** Source image code for `edit` tests — matched to a Drive file by its number. */
  code?: string;
  /** The identity this slot must use. */
  identity?: DatasetId;
  /** The candidate picks the identity for this slot (T4: each identity exactly once). */
  pickIdentity?: boolean;
  /** Which source group the slot belongs to (T6's three tiers). */
  group?: string;
  /** A correction brief shown inline on this slot's row (T5). */
  correction?: { title: string; body: string[] };
}

/** A folder of source media in Drive: `Source Media/{folder}`. */
export interface SourceFolderDef {
  /** Key suffix for the manifest: `source_T1`, `source_T6_sfw`. */
  id: string;
  /** Path under `Source Media/`. */
  folder: string;
  /** What the group is called to the candidate. Absent for a single-folder test. */
  label?: string;
}

export interface TestDef {
  id: TestId;
  title: string;
  kind: TestKind;
  durationMs: number;
  /** Generation budget in US dollars; absent for T7. */
  budgetUsd?: number;
  /** "Deliverables:" line, verbatim. */
  deliverables: string;
  /** "Dataset:" line, verbatim. Absent where the test uses none. */
  datasetLine?: string;
  /** Final-image slots, in display order. Empty for T7. */
  slots: SlotDef[];
  /** Identities the test's dataset modal offers. */
  datasets: DatasetId[];
  sources: SourceFolderDef[];
  /**
   * `sequence` only. `perImageMs` is the pace the brief recommends, not a limit: the test's whole
   * time is `count × perImageMs`, on one clock, and the candidate moves on with Next.
   */
  sequence?: { count: number; perImageMs: number };
  brief: BriefDef;
  /**
   * Known problems with this test's copy or slots that must be settled before a
   * candidate sees it. A test with entries here cannot be opened, and the admin
   * page says why. Remove an entry only when the plan's open question is answered.
   */
  pending?: string[];
}

export interface TrainingModuleDef {
  id: TrainingModuleId;
  title: string;
  blurb: string;
  /** Route segment under `/training`. */
  path: string;
  /** The module's folder under `Training/` in the shared Drive. */
  driveFolder: string;
  /** The explainer, shown to the candidate whenever the module is on. */
  explainer: BriefSection[];
  tests: TestDef[];
}

const MINUTE = 60_000;

/** A slot per source image, `T{n} - {code}`. */
const editSlots = (testId: TestId, codes: string[], identities?: Partial<Record<string, DatasetId>>): SlotDef[] =>
  codes.map((code) => ({
    id: code,
    stem: `${testId} - ${code}`,
    label: `${testId} - ${code}`,
    code,
    ...(identities?.[code] ? { identity: identities[code] } : {}),
  }));

const TIERS = [
  { n: '01', id: 'sfw', name: 'SFW' },
  { n: '02', id: 'teasing', name: 'Teasing' },
  { n: '03', id: 'explicit', name: 'Explicit' },
] as const;

const T6_SLOTS: SlotDef[] = DATASET_IDS.flatMap((identity) =>
  TIERS.map((t) => ({
    id: `${identity.toLowerCase()}-${t.n}`,
    stem: `T6 - ${DATASETS[identity].label} - ${t.n} - ${t.name}`,
    label: `${DATASETS[identity].label} · ${t.n} ${t.name}`,
    identity,
    group: t.id,
  })),
);

// ─── The explainer (Appendix A of the plan, verbatim) ────────────────────────

const EXPLAINER: BriefSection[] = [
  {
    heading: 'Purpose',
    body: [
      'These tests are built to assess whether you can consistently produce realistic, accurate, usable image and video content, follow a brief, identify defects, make controlled revisions, and hand over a repeatable workflow.',
      'A strong submission should demonstrate both good final results and sound judgement about what is ready to use.',
    ],
  },
  { heading: 'General Instructions', body: [] },
  {
    heading: 'Materials and permissions',
    sub: true,
    body: [
      'The agency will supply approved reference images, source images, source videos, and written briefs.',
      'All people depicted must be verified adults. References must be approved for the intended edits and for processing through the permitted tools.',
      'Use only the supplied or explicitly approved materials. Do not publish test materials or results, use them for unrelated work, or upload them to public galleries.',
    ],
  },
  {
    heading: 'Datasets',
    sub: true,
    body: [
      'You will be supplied with datasets for four different identities: Adam, Cole, Jackson, and Joe.',
      'Each task will specify which identity dataset to use. Use only the assigned dataset for that task, and review its reference images carefully before editing to familiarise yourself with the person’s appearance.',
      'Do not mix references from different identities.',
    ],
  },
  {
    heading: 'Tools and budget',
    sub: true,
    body: [
      'The agency will specify the permitted tools and a spending cap for each stage before work starts.',
      'Check the expected charge before submitting a generation. Keep a record of all spending, including failed attempts. Stop before exceeding the cap and explain what remains unfinished.',
      'Candidate payment is separate from generation credits.',
      '💡 To get the most out of your credits, we recommend 1k generations with medium quality and 420p quality for videos for test purposes only.',
      'Do not include API keys, passwords, or other account credentials in submitted files.',
    ],
  },
  {
    heading: 'Required submission for every practical task',
    sub: true,
    body: [
      'Submit:',
      [
        'Final files.',
        'Original source filenames or asset IDs.',
        'Tool and model names.',
        'Prompts and relevant settings, including seeds where available.',
        'Editable project or workflow files where supported.',
        'Attempt count, total cost, and working time.',
        'A short self-review identifying any remaining defects.',
        'Rejected attempts or a contact sheet of attempts, with brief rejection reasons.',
      ],
      'If a setting or workflow cannot be exported, explain the steps sufficiently for another team member to repeat the work.',
    ],
  },
  {
    heading: 'Quality expectations',
    sub: true,
    body: [
      'Unless the brief requests a change, preserve the subject’s identity, apparent age, body proportions, clothing, background, lighting, and overall image character.',
      'Do not hide defects through excessive smoothing, heavy filters, unnecessary cropping, or reduced resolution.',
      'If an issue cannot be corrected within the time or budget, disclose it.',
    ],
  },
  {
    heading: 'What We’re Looking For',
    body: [
      'We’re looking for someone who can produce excellent image and video content while working in an organised, efficient, and repeatable way.',
      'Strong organisational skills are essential. We will assess how you title your content, name your files, structure your folders, and organise your working materials and final deliverables. Another team member should be able to find the correct files and understand your work without needing additional explanations.',
      'We’re also looking for high-quality results with low credit spend. Choose appropriate tools and models, plan your generations carefully, and make targeted corrections. We value someone who can consistently achieve strong results within a small budget.',
      'Record your generation costs, including unsuccessful attempts. We will assess the quality of your final results alongside your total spend, number of attempts, and ability to avoid unnecessary generations. Low spending alone will not compensate for poor-quality work.',
    ],
  },
  {
    heading: 'Meaning of ID and Body',
    body: [
      'ID means matching the assigned identity\'s face, head, and hair. Body means matching that same identity\'s visible build and proportions using the supplied references, while maintaining natural anatomy. Use comparable reference angles where available. Flag insufficient references rather than inventing distinguishing details.',
    ],
  },
];

// ─── The tests (Appendix B of the plan, verbatim) ────────────────────────────

const T1: TestDef = {
  id: 'T1',
  title: 'ID Only',
  kind: 'edit',
  durationMs: 30 * MINUTE,
  budgetUsd: 1.5,
  deliverables: '4 identity swapped images',
  datasetLine: 'JOE',
  slots: editSlots('T1', ['001', '002', '003', '004']),
  datasets: ['JOE'],
  sources: [{ id: 'source_T1', folder: 'T1' }],
  brief: {
    lead: [
      'You will be supplied with 4 source selfie images and a set of identity reference images. Your task is to seamlessly replace the identity in each source selfie with the identity shown in the dataset (Joe).',
      'We will be looking for attention to detail in accurately matching the face, head and hair of the supplied identity. We will also assess image quality, looking for the best possible realism without a synthetic appearance or unwanted artefacts.',
      'Preserve the clothes, pose, expression, background, framing and image quality of each source image. Only change the identity. Match the identity naturally to the source lighting without introducing unnecessary changes.',
    ],
    sections: [
      {
        heading: 'Budget and Time',
        body: [
          'You will have a $1.50 WaveSpeed spending limit for all four images, including retries and corrections, and 30 minutes to complete the task.',
          'The 30 minutes includes reviewing your dataset and source images, generating results, checking your work, and organising your submission.',
          'We are looking for high-quality results with low credit spend. The $1.50 is a maximum allowance, not a spending target. Record your total spend and number of attempts, including unsuccessful generations.',
        ],
      },
      {
        heading: 'What Must Stay the Same',
        body: [
          'Preserve the clothes, pose, expression, background, lighting, overall framing and image quality of each source image.',
          'Only change the identity.',
        ],
      },
      {
        heading: 'Submission',
        body: [
          'Submit 4 final images: one completed image for each source selfie.',
          'Upload each image into its slot — it is named for you, so you do not need to rename anything.',
          'If you’d like to include rejected attempts, upload these under your working files.',
          'Once you have finished, take a screenshot of your credit balance and upload it as a working file.',
          'Include a short task record listing the tools and models used, prompts and relevant settings, number of attempts, total spend, and any remaining defects.',
          'Before submitting, check all four images for identity accuracy, hairline and jawline transitions, natural skin texture, and unintended changes to the source.',
        ],
      },
      {
        heading: 'Final Check',
        body: [
          'Compare each final with its source. Confirm that only the identity changed and that no body, pose, or background changes were introduced.',
        ],
      },
    ],
  },
};

const T2: TestDef = {
  id: 'T2',
  title: 'ID + Body',
  kind: 'edit',
  durationMs: 40 * MINUTE,
  budgetUsd: 1.5,
  deliverables: '4 final images',
  datasetLine: 'Mixed, assigned below',
  slots: editSlots('T2', ['005', '006', '007', '008'], {
    '005': 'JACKSON',
    '006': 'COLE',
    '007': 'JOE',
    '008': 'ADAM',
  }),
  datasets: ['JACKSON', 'COLE', 'JOE', 'ADAM'],
  sources: [{ id: 'source_T2', folder: 'T2' }],
  brief: {
    lead: [
      'You will be supplied with four source selfie images. Replace the identity and match the visible body build and proportions to the assigned person using their dataset. Apply both edits to all four images.',
      'Here are which identities to swap for which source images:',
      { assignments: true },
    ],
    sections: [
      {
        heading: 'What We’re Looking For',
        body: [
          'We will be looking for attention to detail in accurately matching the face, head and hair of the supplied identity, with consistent body proportions and a natural transition between the face, neck and visible skin.',
          'We will also assess image quality, looking for the best possible realism without a synthetic appearance or unwanted artefacts. Pay particular attention to skin texture, anatomy, hands, clothing fit, and how the body interacts with its surroundings.',
        ],
      },
      {
        heading: 'What Must Stay the Same',
        body: [
          'Preserve the clothes, pose, expression, background, lighting, overall framing and image quality of each source image.',
          'Clothing should keep its fit natural on the new body build. Keep the same level of coverage, with no nudity or unintended exposure.',
          'Only change the identity and the body.',
        ],
      },
      {
        heading: 'What We Will Assess',
        body: [
          'Accurate face, head, and hair; reference-based body proportions; natural transitions between face, neck, and body; realistic anatomy and skin texture; and believable clothing fit. Maintain source image clarity and avoid unwanted changes.',
        ],
      },
      {
        heading: 'Budget and Time',
        body: [
          'You will have a $1.50 WaveSpeed spending limit for all four images, including retries and corrections, and 40 minutes to complete the task.',
          'The 40 minutes includes reviewing your datasets and source images, generating results, checking your work, and organising your submission.',
          'We are looking for high-quality results with low credit spend. The $1.50 is a maximum allowance, not a spending target. Record your total spend and number of attempts, including unsuccessful generations.',
        ],
      },
      {
        heading: 'Submission',
        body: [
          'Submit 4 final images: one completed image for each source selfie.',
          'Upload each image into its slot — it is named for you, so you do not need to rename anything.',
          'Keep working files and rejected attempts and upload as your working files.',
          'Once you have finished, take a screenshot of your credit balance and upload it as a working file.',
          'Include a short task record listing:',
          [
            'The tools and models used.',
            'Prompts and relevant settings.',
            'Number of attempts and total spend.',
            'Any remaining defects.',
          ],
          'Before submitting, check all four images for identity accuracy, natural anatomy and skin texture, clothing consistency, and unintended changes.',
        ],
      },
      {
        heading: 'Final Check',
        body: [
          'Compare each final with its source. Confirm that only the identity and body changed and that no pose, or background changes were introduced.',
        ],
      },
    ],
  },
};

const T3: TestDef = {
  id: 'T3',
  title: 'ID + Body + Background Change',
  kind: 'edit',
  durationMs: 40 * MINUTE,
  budgetUsd: 1.5,
  deliverables: 'Four final images',
  datasetLine: 'Mixed, assigned below',
  slots: editSlots('T3', ['009', '010', '011', '012'], {
    '009': 'JACKSON',
    '010': 'JOE',
    '011': 'ADAM',
    '012': 'COLE',
  }),
  datasets: ['JACKSON', 'JOE', 'ADAM', 'COLE'],
  sources: [{ id: 'source_T3', folder: 'T3' }],
  brief: {
    lead: [
      'For each of the four supplied source images, replace the identity, match the assigned person\'s visible body build and proportions, and completely change the background. Preserve the original pose.',
    ],
    sections: [
      {
        heading: 'Background Changes',
        body: [
          'Each image must feature a clearly different environment. Simply changing the background colour, blurring the original setting, or replacing a few objects will not be accepted.',
          'Choose a new setting that naturally supports the existing pose. For example:',
          [
            'A leg resting on a bed: Replace the bed with a couch or padded bench at a suitable height, keeping the leg supported.',
            'Leaning over the edge of a pool: Change the setting to a balcony with a solid parapet or a terrace with a suitable ledge. The surface must support the original position of the hands, arms, and torso.',
            'Lying on a tree trunk: Replace the trunk with a garden bench, sun lounger, or upholstered bench that supports the body in the same position.',
            'Leaning against a bedroom wall: Move the subject to a courtyard wall or another clearly different setting, preserving believable contact with the surface.',
          ],
          'These are examples. You may choose other settings, provided they look natural and maintain the original pose.',
          'Here are which identities to swap for which source images:',
          { assignments: true },
        ],
      },
      {
        heading: 'What We’re Looking For',
        body: [
          'We will assess attention to detail in accurately matching the face, head and hair of the supplied identity.',
          'We will also assess whether the subject looks physically present in the new environment. Pay particular attention to:',
          [
            'Correct scale and perspective.',
            'Believable contact between the body and supporting surfaces.',
            'Natural contact shadows, lighting, and reflections.',
            'Clean edges around hair, skin, and clothing.',
            'Realistic anatomy and skin texture.',
            'Removal of objects or details left over from the original background.',
          ],
          'The final images should look like photographs taken in the new locations, without a synthetic appearance or unwanted artefacts.',
        ],
      },
      {
        heading: 'What Must Stay the Same',
        body: [
          'Preserve the pose, expression, clothing, body proportions, camera angle, overall framing, and image quality of each source image.',
          'Keep the same level of clothing coverage, with no nudity or unintended exposure.',
          'You may adapt the scene lighting and the subject’s colour balance to integrate them naturally into the new environment. Do not unnecessarily alter the subject’s appearance.',
        ],
      },
      {
        heading: 'Budget and Time',
        body: [
          'You will have a $1.50 WaveSpeed spending limit for all four images, including retries and corrections, and 40 minutes to complete the task.',
          'The 40 minutes includes reviewing the supplied materials, choosing suitable replacement settings, generating results, checking your work, and organising your submission.',
          'We are looking for high-quality results with low credit spend. The $1.50 is a maximum allowance, not a spending target. Record your total spend and number of attempts, including unsuccessful generations.',
        ],
      },
      {
        heading: 'Submission',
        body: [
          'Submit 4 final images: one completed image for each source image.',
          'Upload each image into its slot — it is named for you, so you do not need to rename anything.',
          'Keep working files and rejected attempts and upload as your working files.',
          'Once you have finished, take a screenshot of your credit balance and upload it as a working file.',
          'Include a short task record listing:',
          [
            'The replacement setting chosen for each image.',
            'The tools and models used.',
            'Prompts and relevant settings.',
            'Number of attempts and total spend.',
            'Any remaining defects.',
          ],
          'Before submitting, compare each result with its source. Confirm that the pose is preserved, the background is completely changed, and all points of contact with the new environment look believable.',
        ],
      },
    ],
  },
};

const T4: TestDef = {
  id: 'T4',
  title: 'ID + Body + Pose Change',
  kind: 'edit',
  durationMs: 40 * MINUTE,
  budgetUsd: 1.5,
  deliverables: 'Four final images',
  datasetLine: 'You will choose for each image',
  // Each identity is used exactly once: the candidate picks per slot and the server rejects a duplicate.
  slots: editSlots('T4', ['013', '014', '015', '016']).map((s) => ({ ...s, pickIdentity: true })),
  datasets: DATASET_IDS,
  sources: [{ id: 'source_T4', folder: 'T4' }],
  brief: {
    lead: [
      'You will be supplied with 4 source images and the datasets for all four identities.',
      'For each image, replace the identity, match the chosen person\'s visible body build and proportions, and change the pose, while preserving everything else as closely as possible.',
      'For this task, you will choose which dataset to use for each image. Each dataset must be used exactly once, so each of the four identities appears in one of your four final images.',
    ],
    sections: [
      {
        heading: 'Pose Requirements',
        body: [
          'The new pose must show an obvious, meaningful change in the overall body position. A simple head tilt or small arm or leg adjustment is not enough. Choose a pose that works naturally in the existing setting, such as changing a seated upright posture to sitting sideways, or changing a standing posture to a supported seated position where the scene allows it.',
          'The clothing should remain consistent with the source while its folds and positioning adapt naturally to the new pose. Keep the same level of coverage, with no nudity or unintended exposure.',
        ],
      },
      {
        heading: 'What Must Stay the Same',
        body: [
          'Keep the original background and location, outfit, expression, lighting style, camera viewpoint, and image quality. Clothing folds, contact shadows, and body overlap with the scene may change naturally with the new pose. Keep framing as close to the source as practical.',
        ],
      },
      {
        heading: 'What We Will Assess',
        body: [
          'Accurate ID and body matching; a clearly different pose in every image; natural anatomy and balance; believable contact with the environment; consistent clothing; and preservation of the original setting.',
        ],
      },
      {
        heading: 'Budget and Time',
        body: [
          'You will have a $1.50 WaveSpeed spending limit for all four images, including retries and corrections, and 40 minutes to complete the task.',
          'The 40 minutes includes reviewing the images and references, choosing a dataset and a new pose for each image, generating results, checking your work, and organising your submission.',
          'We are looking for high-quality generations with low credit spend. The allowance is a maximum, not a spending target.',
        ],
      },
      {
        heading: 'Submission',
        body: [
          'Submit 4 final images: one final version for each source image.',
          'Upload each image into its slot — it is named for you, so you do not need to rename anything.',
          'Keep working files and rejected attempts and upload as your working files.',
          'Once you have finished, take a screenshot of your credit balance and upload it as a working file.',
          'Include a short task record listing:',
          [
            'The dataset chosen for each image.',
            'The pose change made to each image.',
            'The tools and models used.',
            'Prompts and relevant settings.',
            'Number of attempts and total spend.',
            'Any remaining defects or unintended changes.',
          ],
          'Before submitting, compare each final with its source at full size. Confirm that every image shows a clearly different pose, that each dataset is used exactly once, and that the background, outfit, lighting and framing are unchanged.',
        ],
      },
    ],
  },
};

const T5: TestDef = {
  id: 'T5',
  title: 'Corrections',
  kind: 'edit',
  durationMs: 50 * MINUTE,
  budgetUsd: 2,
  deliverables: 'Five corrected images.',
  datasetLine: 'Use the identity dataset assigned to each image, if and when applicable.',
  // Five sources, 013–017, as the Drive folder holds them. Images 013 and 014 name no identity: the
  // datasets are there to use where a correction needs one, not assigned to every image.
  slots: editSlots('T5', ['013', '014', '015', '016', '017'], { '015': 'COLE', '016': 'JOE', '017': 'ADAM' }).map(
    (s): SlotDef => {
      const corrections: Record<string, SlotDef['correction']> = {
        '013': {
          title: 'Fingers Holding the Phone',
          body: [
            'Correct the fingers holding the phone so the hand has natural anatomy, believable finger placement, and a realistic grip.',
            'Preserve the phone’s shape, position, and perspective. Check that the fingers make natural contact with the phone and do not merge into it.',
          ],
        },
        '014': {
          title: 'Remove the Extra Limb',
          body: ['Remove the unwanted extra limb and reconstruct the affected area naturally.'],
        },
        '015': {
          title: 'Penis Proportion Correction',
          body: ['Using Cole’s Dataset, correct the size of his penis. The angle may change if necessary.'],
        },
        '016': {
          title: 'Body Proportions and Overall Realism',
          body: ['Using Joe’s Dataset, resize his body to be in correct proportions and perspective.'],
        },
        '017': {
          title: 'Face Change, Body Change and Overall Realism',
          body: [
            'Using Adam’s dataset, change the face and body to match him. Then work on the realism of the overall photograph and the cumshot to look as close to a genuine photo as possible.',
          ],
        },
      };
      return { ...s, correction: corrections[s.id] };
    },
  ),
  datasets: ['COLE', 'JOE', 'ADAM'],
  sources: [{ id: 'source_T5', folder: 'T5' }],
  brief: {
    lead: [
      'You will be supplied with a set of source images containing specific issues. Your task is to make the corrections below while preserving unrelated details.',
      { corrections: true },
    ],
    sections: [
      {
        heading: 'What Must Stay the Same',
        body: [
          'Preserve the source pose, expression, clothing, background, framing, and image quality unless a local change is necessary for the assigned correction.',
          'Make targeted edits. Do not introduce unnecessary changes to previously correct details.',
        ],
      },
      {
        heading: 'Budget and Time',
        body: [
          'You will have 50 minutes and a $2 WaveSpeed spending limit for all five images, including retries and corrections.',
          'The time includes reference review, editing, quality checks, and organising your submission.',
          'We are looking for high-quality corrections with low credit spend. The allowance is a maximum, not a spending target.',
        ],
      },
      {
        heading: 'Submission',
        body: [
          'Submit one final corrected version of each source image.',
          'Upload each image into its slot — it is named for you, so you do not need to rename anything.',
          'Keep working files and rejected attempts and upload as your working files.',
          'Once you have finished, take a screenshot of your credit balance and upload it as a working file.',
          'Include a short task record listing:',
          [
            'The corrections made to each image.',
            'Tools and models used.',
            'Prompts and relevant settings.',
            'Number of attempts and total spend.',
            'Any remaining defects or unintended changes.',
          ],
          'Before submitting, compare each result with its source at full size. Check that the assigned issue is corrected and that the edit has not introduced new problems elsewhere.',
        ],
      },
    ],
  },
};

const T6: TestDef = {
  id: 'T6',
  title: 'Original Image Generation',
  kind: 'generate',
  durationMs: 90 * MINUTE,
  budgetUsd: 5,
  deliverables: '12 final images',
  datasetLine: 'Each dataset',
  slots: T6_SLOTS,
  datasets: DATASET_IDS,
  sources: [
    { id: 'source_T6_sfw', folder: 'T6/#1 CANDID SFW', label: 'Candid SFW' },
    { id: 'source_T6_teasing', folder: 'T6/#2 TEASY', label: 'Teasy' },
    { id: 'source_T6_explicit', folder: 'T6/#3 EXPLICIT', label: 'Explicit' },
  ],
  brief: {
    lead: [
      'This task tests your creativity, identity consistency, photographic realism, and ability to produce varied content with low credit spend. Choose your own settings, outfits, poses, and compositions.',
      'You will be supplied with source media showing roughly the style, quality, and creative direction we are looking for.',
      'These photos are for viewing and inspiration only. Do not use them as generation inputs, edit or identity-swap them, or recreate their specific compositions. Continue to use the assigned datasets for identity references.',
      'Your submissions must be original. Any image found to copy or closely recreate a supplied reference photo will be disqualified from the final assessment. General similarities in style or theme are acceptable; reproducing a recognisable combination of pose, outfit, setting, and framing is not.',
    ],
    sections: [
      {
        heading: 'What We’re Looking For',
        body: [
          'For this task, you will have complete creative control. Using each dataset, you will produce 3 images each, 1 must be SFW, 1 must be teasy and 1 must be explicit.',
          'You will do this for:',
          ['Adam', 'Cole', 'Jackson', 'Joe'],
          'That means a total of 12 final images.',
        ],
      },
      {
        heading: 'Image 1 — Completely Safe for Work',
        sub: true,
        body: [
          'Create a fully clothed image suitable for a general audience.',
          'You may choose a lifestyle, fashion, fitness, travel, or everyday setting. The image should look natural and believable, with a clear creative direction.',
          'You must capture a candid, low resolution style image which matches the images given in your reference photos.',
        ],
      },
      {
        heading: 'Image 2 — Teasing',
        sub: true,
        body: [
          'Create a non-explicit image showing some body, such as a shirtless image or an image featuring shorts or boxers.',
          'Keep intimate areas fully covered. Pay attention to natural anatomy, clothing fit, skin texture, and believable posing.',
        ],
      },
      {
        heading: 'Image 3 — Explicit',
        sub: true,
        body: [
          'Create a more confidently styled, explicit image which features either full frontal or full rear nudity.',
          'Keep intimate areas visible. Make this image clearly different from Image 2 through its composition and creative direction.',
        ],
      },
      {
        heading: 'What We’re Looking For',
        body: [
          [
            'Accurate face, head, hair, and visible body proportions and genitalia for each dataset.',
            'Consistent identity across all 3 images per dataset.',
            'Creative variety rather than repeated poses or backgrounds.',
            'Realistic anatomy, hands, skin texture, lighting, and shadows.',
            'Strong composition without a synthetic appearance or unwanted artefacts.',
            'Efficient model selection, targeted corrections, and low credit spend.',
          ],
          'Use each dataset in isolation. Do not mix references between identities.',
        ],
      },
      {
        heading: 'Budget and Time',
        body: [
          'The 90 minutes includes reviewing references, planning, generating, checking, and organising all 12 images.',
          'The budget will be $5 covers all generations, retries, and corrections. It is a maximum allowance, not a spending target. Record your attempts and spending.',
        ],
      },
      {
        heading: 'Submission',
        body: [
          'Upload each image into its slot — it is named for you, so you do not need to rename anything.',
          'Upload working files.',
          'Once you have finished, take a screenshot of your credit balance and upload it as a working file.',
          'Include a short task record listing your creative concepts, tools and models, prompts and settings, number of attempts, total spend, and any remaining defects.',
          'Before submitting, review the images individually and as a set. Confirm that every dataset has three distinct images and that their identity remains consistent throughout.',
        ],
      },
      {
        heading: 'Optional Extra Points',
        body: [
          'For a chance to earn extra points, include any permitted source or reference images you used to create your submissions, clearly labelled alongside the relevant final image. Explain briefly how you used them. The supplied creative reference photos remain viewing-only and must not be used as generation inputs or copied.',
          'If you finish the required images with time and credit remaining, you may create additional original images. These must fit within the same $5 total task budget, including all required images, retries, corrections, and extras.',
          'Upload additional images as working files. Extra points will be based on quality, creativity, and useful variety—not quantity alone. Prioritise completing and checking the required images first.',
        ],
      },
    ],
  },
};

const T7_IMAGES = 10;
const T7_PER_IMAGE_MS = 30_000;

const T7: TestDef = {
  id: 'T7',
  title: 'Spot The Mistake',
  kind: 'sequence',
  // The whole test is the images times the time per image — one clock, like every other test.
  durationMs: T7_IMAGES * T7_PER_IMAGE_MS,
  deliverables: 'Completed timed assessment',
  slots: [],
  datasets: [],
  sources: [{ id: 'source_T7', folder: 'T7' }],
  sequence: { count: T7_IMAGES, perImageMs: T7_PER_IMAGE_MS },
  brief: {
    lead: [
      `You’ll be shown ${T7_IMAGES} images, one at a time. Allow about ${T7_PER_IMAGE_MS / 1000} seconds per image: identify what’s wrong, write it down, then press Next for the next image.`,
      `You have ${(T7_IMAGES * T7_PER_IMAGE_MS) / 60_000} minutes in total — ${T7_PER_IMAGE_MS / 1000} seconds for each of the ${T7_IMAGES} images.`,
      'You can go back and change an earlier answer. We recommend working through all the images as quickly as you can first, and only going back once you have seen them all and have time left.',
      'Each image appears only when you press Next, so you cannot look ahead.',
    ],
    sections: [],
  },
};

export const TRAINING_MODULES: Record<TrainingModuleId, TrainingModuleDef> = {
  'media-gen': {
    id: 'media-gen',
    title: 'Media Generation',
    blurb: 'Timed image tasks that show how you work with AI tools.',
    path: 'media-gen',
    driveFolder: 'Media-Gen',
    explainer: EXPLAINER,
    tests: [T1, T2, T3, T4, T5, T6, T7],
  },
};

export function getModule(id: string): TrainingModuleDef | null {
  return (TRAINING_MODULES as Record<string, TrainingModuleDef | undefined>)[id] ?? null;
}

export function getTest(moduleId: string, testId: string): TestDef | null {
  return getModule(moduleId)?.tests.find((t) => t.id === testId) ?? null;
}

// ─── Materials (what Drive must hold for a test) ─────────────────────────────

/** Manifest key for an identity dataset. Shared by every test that uses it. */
export const datasetKey = (id: DatasetId) => `dataset_${id}`;

/** Every manifest a test needs complete before it can open. */
export function materialKeysFor(test: TestDef): string[] {
  return [...test.datasets.map(datasetKey), ...test.sources.map((s) => s.id)];
}

/**
 * The number a source file's name carries, zero-padded to three digits, so
 * `0013.png`, `013.jpeg` and `13.jpg` are all code `013`. Null if it has none.
 */
export function sourceCodeFromName(name: string): string | null {
  const base = name.replace(/\.[^.]+$/, '');
  const m = base.match(/\d+/);
  return m ? String(parseInt(m[0], 10)).padStart(3, '0') : null;
}

// ─── Limits shared by client and server ──────────────────────────────────────

/**
 * The image types the training surface accepts, once: the file extension to
 * store under and the magic-byte signature the server proves the bytes against.
 * Candidates' final images, the synced materials and every `accept` attribute
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

/** A file in Drive larger than this is not copied into Storage as material. */
export const MAX_MATERIAL_BYTES = 25 * 1024 * 1024;
/** The most files one materials folder may hold — bounds the manifest document. */
export const MAX_MATERIALS_PER_FOLDER = 200;
export const MATERIAL_THUMB_PX = 480;

/** What a working file is signed and sent as — never the client's guess, so we never sign `text/html` on our bucket. */
export const WORK_CONTENT_TYPE = 'application/octet-stream';

/** Working files: any type, always served as a download, never inline. */
export const MAX_WORKING_FILE_BYTES = 250 * 1024 * 1024;
export const MAX_WORKING_FILES = 50;
/** The longest a working file's original name is kept. */
export const MAX_FILE_NAME_LENGTH = 120;

/** The task record. */
export const MAX_TEXT_LENGTH = 10_000;

/**
 * An upload whose URL was signed before the deadline may land this long after
 * it. Sized for a large file on a slow line that started in the last seconds;
 * anything not finalised inside it is rejected, and the signed URL itself stops
 * working at the same instant (it is capped at `deadline + grace`).
 */
export const UPLOAD_GRACE_MS = 30_000;
/** A working file may be 250 MB, so it is given longer to finish arriving. */
export const WORKING_GRACE_MS = 10 * MINUTE;

/** Upload slots one attempt may ever request — the bound on swap-and-retry. */
export const MAX_UPLOAD_ATTEMPTS = 120;

/** People one module may hold. Generous for a sitting; bounds a runaway paste. */
export const MAX_PARTICIPANTS_PER_MODULE = 100;

export const MAX_NAME_LENGTH = 80;
export const MIN_NAME_LENGTH = 2;

/** T7: an answer is still accepted this long after the clock ends — a save in flight at zero. */
export const SEQUENCE_ANSWER_GRACE_MS = 5_000;
export const MAX_ANSWER_LENGTH = 1_000;

/** Whole minutes, for "40 minutes". */
export const minutesOf = (ms: number) => Math.round(ms / 60_000);

/** Labels a milestone pulse: remaining ms at which the clock pulses once. */
export function milestonesFor(durationMs: number): number[] {
  const half = Math.round(durationMs / 2);
  return Array.from(new Set([half, 10 * MINUTE, 5 * MINUTE, 2 * MINUTE])).filter(
    (m) => m < durationMs && m > MINUTE,
  );
}
