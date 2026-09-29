/**
 * Creator onboarding — the question model, shared by the public form
 * (`/join/[token]`), its API routes, and the internal Onboarding page.
 *
 * Every question is declared ONCE here, as data. The browser renders from it,
 * the server validates against it, and the staff page labels answers from it —
 * so a question added here appears, validates and reads back everywhere with no
 * second list to keep in step (the same "one schema, three places" rule the
 * application form follows; see documentation/creator-onboarding.md).
 *
 * The source of the questions is `model-onboarding.md` at the repo root: track
 * "1. NO OF" / "2. OF" differ only in Part I; Parts II and III are shared.
 *
 * Answers are a FLAT `Record<string, string>` keyed by question id. Flat, and
 * strings only, because the form autosaves field-by-field: each save is a
 * Firestore `update` on `answers.<id>` paths, which merges without a read and
 * cannot clobber a field the save did not mention. Multi-choice values are
 * joined with `MULTI_SEP`.
 *
 * Keep this module free of `server-only` imports.
 */

export type OnboardingTrack = 'of' | 'no-of';

export type OnboardingStatus = 'invited' | 'started' | 'completed';

export type QuestionKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'money'
  | 'date'
  | 'choice'
  | 'multi'
  | 'handle';

export interface QuestionOption {
  value: string;
  label: string;
}

export type Answers = Record<string, string>;

export interface Question {
  /** Answer key. `[a-zA-Z0-9]` only — it becomes a Firestore field path. */
  id: string;
  label: string;
  /** One quiet line under the label. */
  help?: string;
  kind: QuestionKind;
  required?: boolean;
  /** Only asked on these tracks. Omitted = both. */
  tracks?: OnboardingTrack[];
  options?: QuestionOption[];
  placeholder?: string;
  /** A fixed lead-in, e.g. `@` or `$`. Chrome, never stored. */
  prefix?: string;
  /** A fixed trailing unit, e.g. `hrs / week`. */
  suffix?: string;
  /** Hidden (and so never required) unless this holds. */
  showIf?: (answers: Answers) => boolean;
  /** Required only when this holds — on top of `required` being set. */
  requiredIf?: (answers: Answers) => boolean;
  /** Longest accepted value. Defaults by kind. */
  max?: number;
  /** Where a value is pre-filled from, shown to the creator as "from your application". */
  prefilled?: boolean;
  /** Half-width on wide screens — for short measurements. */
  half?: boolean;
}

export interface Screen {
  id: string;
  title: string;
  blurb?: string;
  questions: Question[];
}

export interface Chapter {
  id: 'you' | 'limits' | 'persona';
  title: string;
  /** The chapter's promise, one sentence. */
  blurb: string;
  /** Honest estimate, shown on the landing page and the chapter map. */
  minutes: number;
  screens: Screen[];
}

export const MULTI_SEP = ' · ';

const DEFAULT_MAX: Record<QuestionKind, number> = {
  text: 160,
  textarea: 2000,
  number: 6,
  money: 12,
  date: 10,
  choice: 60,
  multi: 400,
  handle: 40,
};

export function maxLength(q: Question): number {
  return q.max ?? DEFAULT_MAX[q.kind];
}

// ─── Shared option sets ──────────────────────────────────────────────────────

const YES_NO_MAYBE: QuestionOption[] = [
  { value: 'Yes', label: 'Yes' },
  { value: 'Maybe', label: 'Maybe' },
  { value: 'No', label: 'No' },
];

const ORIENTATION: QuestionOption[] = [
  { value: 'Straight', label: 'Straight' },
  { value: 'Gay', label: 'Gay' },
  { value: 'Bi', label: 'Bi' },
  { value: 'Other', label: 'Other' },
];

const POSITION: QuestionOption[] = [
  { value: 'Top', label: 'Top' },
  { value: 'Bottom', label: 'Bottom' },
  { value: 'Vers', label: 'Vers' },
  { value: 'Side', label: 'Side' },
  { value: 'Prefer not to say', label: 'Prefer not to say' },
];

const notStraight = (key: string) => (a: Answers) => !!a[key] && a[key] !== 'Straight';

/** The application stores sexuality as a lowercase enum; the form speaks in labels. */
export const SEXUALITY_TO_ORIENTATION: Record<string, string> = {
  straight: 'Straight',
  gay: 'Gay',
  bi: 'Bi',
  other: 'Other',
};

// ─── Part II — content limits ────────────────────────────────────────────────

/**
 * The content-limits deck. Each item is answered Yes / No (required) with an
 * optional note. Stored as `lim_<id>` = `'Yes' | 'No'` and `limn_<id>` = note.
 *
 * Wording is tidied from the source list (typos fixed — "Webcam-Facebook" was
 * FaceTime — and brackets turned into readable qualifiers); the meaning of each
 * item is unchanged.
 */
export const LIMIT_ITEMS: { id: string; label: string; detail?: string }[] = [
  { id: 'callsClean', label: 'Phone calls', detail: 'Clean' },
  { id: 'callsDirty', label: 'Phone calls', detail: 'Dirty talk' },
  { id: 'videoClean', label: 'Video chat / FaceTime', detail: 'Clean' },
  { id: 'videoDirty', label: 'Video chat / FaceTime', detail: 'Dirty' },
  { id: 'usedClothing', label: '“Used” panties, socks & clothing', detail: 'Can be staged' },
  { id: 'bjDildo', label: 'Blowjob video', detail: 'With a dildo' },
  { id: 'bjReal', label: 'Blowjob / handjob video', detail: 'Real' },
  { id: 'vocal', label: 'Being vocal on camera', detail: 'Dirty talk, moaning' },
  { id: 'sextape', label: 'Real sex tapes' },
  { id: 'feet', label: 'Feet pics & videos' },
  { id: 'femboy', label: 'Femboy content' },
  { id: 'ass', label: 'Ass pics & videos' },
  { id: 'hole', label: 'Hole pics & videos', detail: 'Close-up' },
  { id: 'analPlay', label: 'Anal play', detail: 'Fingers or toys' },
  { id: 'roleplay', label: 'Role play' },
  { id: 'gfe', label: 'Boyfriend / girlfriend experience', detail: 'Video calls and chat over a set period' },
  { id: 'cockRating', label: 'Cock rating videos' },
  { id: 'orgasm', label: 'Orgasm videos' },
  { id: 'twerk', label: 'Twerking & dance videos' },
  { id: 'bdsm', label: 'BDSM' },
  { id: 'cockWorship', label: 'Cock worship' },
  { id: 'dressUp', label: 'Themed dress-up' },
  { id: 'cum', label: 'Creampie / cumshots' },
  { id: 'watersports', label: 'Watersports' },
  { id: 'findom', label: 'Findom', detail: 'Financial domination' },
];

export const limitKey = (id: string) => `lim_${id}`;
export const limitNoteKey = (id: string) => `limn_${id}`;
export const LIMIT_EXTRA_KEY = 'limExtra';

export const LIMITS_INTRO =
  'Below is every kind of content you might make with us, as timeline posts or in private messages. ' +
  'Tell us what you’re comfortable with and what you’re not — our chat team reads this before they ' +
  'ever speak to one of your subscribers, so nobody offers a fan something you won’t make. ' +
  'Answer for what you can see yourself doing over time, not just on day one. ' +
  'Nothing here is required of you, and you can change your answers later.';

export const PERSONA_INTRO =
  'This is the character our chatters play when your subscribers ask about you. It can match your ' +
  'real life, or not at all — it only has to be the story you want told, told consistently.';

// ─── The chapters ────────────────────────────────────────────────────────────

export const CHAPTERS: Chapter[] = [
  {
    id: 'you',
    title: 'You',
    blurb: 'Your setup, your schedule and what you want out of this.',
    minutes: 6,
    screens: [
      {
        id: 'basics',
        title: 'The basics',
        blurb: 'We kept what you told us in your application — check it and fill the gaps.',
        questions: [
          {
            id: 'stageName',
            label: 'What is your stage name?',
            help: 'The name fans know you by. Not sure yet? Put a working one — it can change.',
            kind: 'text',
            required: true,
            max: 60,
          },
          {
            id: 'telegram',
            label: 'Your Telegram',
            help: 'Your creator portal lives inside Telegram, and it’s where we’ll talk day to day.',
            kind: 'handle',
            prefix: '@',
            required: true,
            prefilled: true,
          },
          {
            id: 'dob',
            label: 'Date of birth',
            kind: 'date',
            required: true,
          },
          {
            id: 'city',
            label: 'City',
            kind: 'text',
            required: true,
            prefilled: true,
            max: 80,
            half: true,
          },
          {
            id: 'country',
            label: 'Country',
            kind: 'text',
            required: true,
            prefilled: true,
            max: 80,
            half: true,
          },
        ],
      },
      {
        id: 'online',
        title: 'Where people find you',
        questions: [
          {
            id: 'socials',
            label: 'All your social media links',
            help: 'Twitter, Instagram, Linktree and anything else — one per line.',
            kind: 'textarea',
            required: true,
            prefilled: true,
            max: 1500,
          },
          {
            id: 'tiktok',
            label: 'Have you made TikTok videos before?',
            help: 'Add the account link. If it was deleted but you still have drafts, say so and we’ll ask for them.',
            kind: 'textarea',
            max: 600,
          },
        ],
      },
      {
        id: 'identity',
        title: 'A little about you',
        questions: [
          {
            id: 'orientation',
            label: 'Sexual orientation',
            kind: 'choice',
            options: ORIENTATION,
            required: true,
            prefilled: true,
          },
          {
            id: 'position',
            label: 'Your position',
            kind: 'choice',
            options: POSITION,
            showIf: notStraight('orientation'),
          },
        ],
      },
      {
        id: 'setup',
        title: 'Your setup',
        questions: [
          {
            id: 'equipment',
            label: 'What do you create content with?',
            help: 'Phone make and model, camera, ring light, tripod — whatever you have.',
            kind: 'textarea',
            required: true,
            max: 800,
          },
          {
            id: 'locations',
            label: 'Where can you shoot?',
            kind: 'multi',
            required: true,
            options: [
              { value: 'Bedroom', label: 'Bedroom' },
              { value: 'Bathroom', label: 'Bathroom' },
              { value: 'Apartment', label: 'Apartment' },
              { value: 'House', label: 'House' },
              { value: 'Outdoors', label: 'Outdoors' },
              { value: 'Car', label: 'Car' },
              { value: 'Hotel', label: 'Hotel' },
              { value: 'Studio', label: 'Studio' },
            ],
          },
        ],
      },
      {
        id: 'time',
        title: 'Your time',
        blurb: 'Solo means anything from clean to x-rated to specialised or kink — photos and video.',
        questions: [
          {
            id: 'soloHours',
            label: 'Hours a week for solo content',
            kind: 'number',
            suffix: 'hrs / week',
            required: true,
            half: true,
          },
          {
            id: 'duoHours',
            label: 'Duo content, if it applies',
            help: 'Full videos to photo sets. A week or a month — whichever is easier.',
            kind: 'text',
            placeholder: 'e.g. 4 hrs a month',
            max: 80,
            half: true,
          },
        ],
      },
      {
        id: 'ofNow',
        title: 'Your OnlyFans today',
        blurb: 'So we start from where you are, not from zero.',
        questions: [
          {
            id: 'ofTrialLink',
            label: '7-day free trial link to your OnlyFans',
            help: 'Create one under Settings → Subscription while signed in to OnlyFans.',
            kind: 'text',
            placeholder: 'onlyfans.com/action/trial/…',
            required: true,
            prefilled: true,
            tracks: ['of'],
            max: 500,
          },
          {
            id: 'ofSubPrice',
            label: 'Current subscription price',
            kind: 'money',
            prefix: '$',
            suffix: '/ month',
            required: true,
            tracks: ['of'],
            half: true,
          },
          {
            id: 'ofTopPercent',
            label: 'Best top % you’ve reached',
            kind: 'text',
            placeholder: 'e.g. Top 4.5%',
            tracks: ['of'],
            max: 40,
            half: true,
          },
          {
            id: 'ofPriceHistory',
            label: 'Has your price changed? How?',
            kind: 'textarea',
            tracks: ['of'],
            max: 600,
          },
          {
            id: 'ofNet1',
            label: 'Net profit — last month',
            kind: 'money',
            prefix: '$',
            required: true,
            tracks: ['of'],
            half: true,
          },
          {
            id: 'ofNet2',
            label: 'Two months ago',
            kind: 'money',
            prefix: '$',
            tracks: ['of'],
            half: true,
          },
          {
            id: 'ofNet3',
            label: 'Three months ago',
            kind: 'money',
            prefix: '$',
            tracks: ['of'],
            half: true,
          },
        ],
      },
      {
        id: 'ofSelling',
        title: 'How you sell',
        questions: [
          {
            id: 'ofPpvFrequency',
            label: 'How often do you send PPVs?',
            kind: 'choice',
            required: true,
            tracks: ['of'],
            options: [
              { value: 'Daily', label: 'Daily' },
              { value: 'A few times a week', label: 'A few times a week' },
              { value: 'Weekly', label: 'Weekly' },
              { value: 'Rarely', label: 'Rarely' },
              { value: 'Never', label: 'Never' },
            ],
          },
          {
            id: 'ofPpvPrice',
            label: 'What do you usually price them at?',
            kind: 'text',
            placeholder: 'e.g. $8–25',
            required: true,
            requiredIf: (a) => a.ofPpvFrequency !== 'Never',
            showIf: (a) => a.ofPpvFrequency !== 'Never',
            tracks: ['of'],
            max: 80,
          },
          {
            id: 'ofPpvContent',
            label: 'What goes in them?',
            kind: 'textarea',
            showIf: (a) => a.ofPpvFrequency !== 'Never',
            tracks: ['of'],
            max: 800,
          },
          {
            id: 'ofSales',
            label: 'Sales or campaigns you’ve run',
            help: 'How often, when, and for how much.',
            kind: 'textarea',
            tracks: ['of'],
            max: 800,
          },
          {
            id: 'ofCustoms',
            label: 'Do you take custom requests? At what price?',
            kind: 'textarea',
            tracks: ['of'],
            max: 800,
          },
        ],
      },
      {
        id: 'ambition',
        title: 'Where you want to go',
        questions: [
          {
            id: 'earningsGoal',
            label: 'Monthly earnings that would make you happy to stay with us',
            kind: 'money',
            prefix: '$',
            suffix: '/ month',
            required: true,
          },
          {
            id: 'duration',
            label: 'How long do you plan to work in this industry?',
            kind: 'choice',
            required: true,
            options: [
              { value: 'Under 6 months', label: 'Under 6 months' },
              { value: '6–12 months', label: '6–12 months' },
              { value: '1–2 years', label: '1–2 years' },
              { value: '2+ years', label: '2+ years' },
              { value: 'Not sure yet', label: 'Not sure yet' },
            ],
          },
          {
            id: 'otherPlatforms',
            label: 'Open to other platforms where your content earns?',
            help: 'Fansly, Pornhub and similar.',
            kind: 'choice',
            options: YES_NO_MAYBE,
            required: true,
          },
          {
            id: 'contentHouses',
            label: 'Interested in our content houses?',
            help: 'We run them from time to time for creators with growth potential — across the USA, Europe, Asia and Africa, paid for by the agency.',
            kind: 'choice',
            options: YES_NO_MAYBE,
            required: true,
          },
        ],
      },
      {
        id: 'privacy',
        title: 'Privacy, and anything else',
        blurb: 'Only the Bluu Rock team sees this.',
        questions: [
          {
            id: 'publicKnown',
            label: 'Do people in your life know you’re an adult creator?',
            kind: 'choice',
            required: true,
            options: [
              { value: 'Yes, it’s public', label: 'Yes, it’s public' },
              { value: 'Some people know', label: 'Some people know' },
              { value: 'No, it’s private', label: 'No, it’s private' },
            ],
          },
          {
            id: 'bigAudience',
            label: 'Any issue growing an audience of 100k+?',
            kind: 'choice',
            required: true,
            options: [
              { value: 'No issue', label: 'No issue' },
              { value: 'Some concerns', label: 'Some concerns' },
              { value: 'I’d rather stay small', label: 'I’d rather stay small' },
            ],
          },
          {
            id: 'headsUp',
            label: 'Anything we should know now that could affect how we work?',
            help: 'Being in the closet, a criminal record, a legal situation — it changes how we protect you, not whether we work with you.',
            kind: 'textarea',
            max: 1500,
          },
          {
            id: 'anythingElse',
            label: 'Anything else you’d like to add',
            kind: 'textarea',
            max: 1500,
          },
        ],
      },
    ],
  },
  {
    id: 'limits',
    title: 'Your limits',
    blurb: 'A quick yes or no on each kind of content.',
    minutes: 3,
    // Rendered by a dedicated deck, not by the generic screen renderer; the
    // screen list exists so the chapter map and validation see its questions.
    screens: [
      {
        id: 'deck',
        title: 'Your limits',
        questions: [
          ...LIMIT_ITEMS.map<Question>((item) => ({
            id: limitKey(item.id),
            label: item.detail ? `${item.label} — ${item.detail}` : item.label,
            kind: 'choice',
            required: true,
            options: [
              { value: 'Yes', label: 'Yes' },
              { value: 'No', label: 'No' },
            ],
          })),
          ...LIMIT_ITEMS.map<Question>((item) => ({
            id: limitNoteKey(item.id),
            label: `Note — ${item.label}`,
            kind: 'text',
            max: 300,
          })),
          {
            id: LIMIT_EXTRA_KEY,
            label: 'Any other kinks or content you’re happy to create',
            kind: 'textarea',
            max: 1500,
          },
        ],
      },
    ],
  },
  {
    id: 'persona',
    title: 'Your persona',
    blurb: 'The character our chat team plays with your fans.',
    minutes: 4,
    screens: [
      {
        id: 'who',
        title: 'Who they are',
        questions: [
          { id: 'pAge', label: 'Age', kind: 'number', required: true, half: true },
          {
            id: 'pSex',
            label: 'Sex',
            kind: 'choice',
            required: true,
            options: [
              { value: 'Male', label: 'Male' },
              { value: 'Female', label: 'Female' },
              { value: 'Non-binary', label: 'Non-binary' },
            ],
          },
          { id: 'pSexuality', label: 'Sexuality', kind: 'choice', options: ORIENTATION, required: true, prefilled: true },
          { id: 'pPosition', label: 'Position', kind: 'choice', options: POSITION, showIf: notStraight('pSexuality') },
          { id: 'pNationality', label: 'Nationality', kind: 'text', half: true, max: 60 },
          { id: 'pEthnicity', label: 'Ethnicity', kind: 'text', half: true, max: 60 },
        ],
      },
      {
        id: 'where',
        title: 'Where and when',
        questions: [
          { id: 'pLocation', label: 'Location', kind: 'text', required: true, prefilled: true, max: 80 },
          { id: 'pTimezone', label: 'Time zone', kind: 'text', half: true, max: 60, prefilled: true },
          { id: 'pBirthday', label: 'Birthday', kind: 'text', placeholder: 'e.g. 14 March', half: true, max: 40 },
        ],
      },
      {
        id: 'character',
        title: 'Their character',
        questions: [
          {
            id: 'pPersonality',
            label: 'Personality',
            help: 'How they talk and carry themselves — cheeky, dominant, sweet, shy…',
            kind: 'textarea',
            required: true,
            max: 800,
          },
          {
            id: 'pInterests',
            label: 'Interests, hobbies & passions',
            kind: 'textarea',
            required: true,
            max: 800,
          },
          { id: 'pOccupation', label: 'Occupation', kind: 'text', max: 80 },
          { id: 'pFamily', label: 'Family', kind: 'text', max: 200 },
          { id: 'pPets', label: 'Pets', kind: 'text', max: 120 },
        ],
      },
      {
        id: 'looks',
        title: 'Their looks',
        blurb: 'Fans ask. Leave out anything you’d rather not share.',
        questions: [
          { id: 'pHair', label: 'Hair colour', kind: 'text', half: true, max: 40 },
          { id: 'pEyes', label: 'Eye colour', kind: 'text', half: true, max: 40 },
          { id: 'pHeight', label: 'Height', kind: 'text', half: true, max: 20 },
          { id: 'pWeight', label: 'Weight', kind: 'text', half: true, max: 20 },
          { id: 'pWaist', label: 'Waist', kind: 'text', half: true, max: 20 },
          { id: 'pShoe', label: 'Shoe size', kind: 'text', half: true, max: 20 },
          { id: 'pDick', label: 'Dick size', kind: 'text', half: true, max: 20 },
        ],
      },
      {
        id: 'desire',
        title: 'What they like',
        questions: [
          { id: 'pLikes', label: 'Likes', kind: 'textarea', max: 600 },
          { id: 'pDislikes', label: 'Dislikes', kind: 'textarea', max: 600 },
          { id: 'pTurnOns', label: 'Turn-ons', kind: 'textarea', max: 600 },
          { id: 'pTurnOffs', label: 'Turn-offs', kind: 'textarea', max: 600 },
          { id: 'pKinks', label: 'Kinks', kind: 'textarea', max: 600 },
          { id: 'pExtra', label: 'Anything else', kind: 'textarea', max: 1000 },
        ],
      },
    ],
  },
];

// ─── Derivations ─────────────────────────────────────────────────────────────

export function onTrack(q: Question, track: OnboardingTrack): boolean {
  return !q.tracks || q.tracks.includes(track);
}

/** Screens of a chapter that have at least one question on this track. */
export function screensFor(chapter: Chapter, track: OnboardingTrack): Screen[] {
  return chapter.screens
    .map((s) => ({ ...s, questions: s.questions.filter((q) => onTrack(q, track)) }))
    .filter((s) => s.questions.length > 0);
}

const TRACKS: OnboardingTrack[] = ['of', 'no-of'];

/** Built once per track — the question set is static, and this sits on the autosave path. */
const QUESTIONS_BY_TRACK = Object.fromEntries(
  TRACKS.map((t) => [t, CHAPTERS.flatMap((c) => screensFor(c, t).flatMap((s) => s.questions))]),
) as Record<OnboardingTrack, Question[]>;

const QUESTION_MAP_BY_TRACK = Object.fromEntries(
  TRACKS.map((t) => [t, new Map(QUESTIONS_BY_TRACK[t].map((q) => [q.id, q]))]),
) as Record<OnboardingTrack, Map<string, Question>>;

/** Every question the track can ask, in order. */
export function questionsFor(track: OnboardingTrack): Question[] {
  return QUESTIONS_BY_TRACK[track];
}

/** Honest total, shown on the welcome and in the invite email. */
export const TOTAL_MINUTES = CHAPTERS.reduce((sum, c) => sum + c.minutes, 0);

/** `@name` / `name` → `name`. */
export const stripAt = (handle: string) => handle.replace(/^@+/, '');

/** Yes / no counts across the content-limits deck. */
export function limitTally(answers: Answers) {
  let yes = 0;
  let no = 0;
  for (const item of LIMIT_ITEMS) {
    const v = answers[limitKey(item.id)];
    if (v === 'Yes') yes += 1;
    else if (v === 'No') no += 1;
  }
  return { yes, no, answered: yes + no, open: LIMIT_ITEMS.length - yes - no };
}

export function isVisible(q: Question, answers: Answers): boolean {
  return !q.showIf || q.showIf(answers);
}

export function isRequired(q: Question, answers: Answers): boolean {
  if (!q.required || !isVisible(q, answers)) return false;
  return !q.requiredIf || q.requiredIf(answers);
}

const has = (v: string | undefined) => typeof v === 'string' && v.trim() !== '';

/** Age in whole years on `today` for an ISO `YYYY-MM-DD`, or null. */
export function ageFrom(dob: string, today = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < mo || (today.getMonth() + 1 === mo && today.getDate() < d)) age -= 1;
  return age;
}

/**
 * Format problems for one answer, or null. Empty is never a format problem —
 * requiredness is checked separately so a half-filled screen can still save.
 */
export function formatError(q: Question, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (v.length > maxLength(q)) return 'That’s a little too long';
  switch (q.kind) {
    case 'number':
      return /^\d{1,4}(\.\d)?$/.test(v) ? null : 'Enter a number';
    case 'money':
      return /^\d{1,9}(\.\d{1,2})?$/.test(v.replace(/,/g, '')) ? null : 'Enter an amount, e.g. 1500';
    case 'date': {
      const age = ageFrom(v);
      if (age === null) return 'Enter a valid date';
      if (age < 18) return 'You must be 18 or older';
      if (age > 90) return 'Check the year';
      return null;
    }
    case 'handle':
      return /^[A-Za-z0-9_]{4,32}$/.test(v.replace(/^@+/, '')) ? null : 'Use just the username, e.g. bluurock';
    case 'choice':
      return q.options?.some((o) => o.value === v) ? null : 'Choose one of the options';
    case 'multi':
      return v.split(MULTI_SEP).every((part) => part.trim().length > 0) ? null : 'Choose from the options';
    default:
      return null;
  }
}

/** Errors a screen would show on Continue: required-and-empty plus format. */
export function screenErrors(screen: Screen, answers: Answers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of screen.questions) {
    if (!isVisible(q, answers)) continue;
    const value = answers[q.id] ?? '';
    const fmt = formatError(q, value);
    if (fmt) out[q.id] = fmt;
    else if (isRequired(q, answers) && !has(value)) out[q.id] = 'This one’s needed';
  }
  return out;
}

export interface Progress {
  requiredTotal: number;
  requiredAnswered: number;
  /** 0–1, of required questions answered. */
  ratio: number;
}

function countRequired(questions: Iterable<Question>, answers: Answers) {
  let total = 0;
  let done = 0;
  for (const q of questions) {
    if (!isRequired(q, answers)) continue;
    total += 1;
    if (has(answers[q.id]) && !formatError(q, answers[q.id])) done += 1;
  }
  return { total, done };
}

export function progressOf(track: OnboardingTrack, answers: Answers): Progress {
  const { total, done } = countRequired(questionsFor(track), answers);
  return { requiredTotal: total, requiredAnswered: done, ratio: total ? done / total : 1 };
}

/**
 * Chapter progress, for the set strip and the setlist. Pass a chapter whose
 * `screens` are ALREADY filtered to the track (`screensFor`).
 */
export function chapterProgress(chapter: Chapter, answers: Answers) {
  const { total, done } = countRequired(
    chapter.screens.flatMap((s) => s.questions),
    answers,
  );
  return { total, done, complete: total > 0 && done === total };
}

// ─── Server-side sanitising ──────────────────────────────────────────────────

const KEY_PATTERN = /^[A-Za-z0-9_]{1,40}$/;

/**
 * Filters an autosave patch down to known question ids for this track with
 * string values inside each question's length cap. Unknown keys and non-string
 * values are DROPPED, not rejected — a stale tab running an older question set
 * should still save everything it can.
 *
 * Format is deliberately not enforced on save (a half-typed date is a normal
 * intermediate state); it is enforced on completion.
 */
export function sanitisePatch(track: OnboardingTrack, patch: unknown): Answers {
  const out: Answers = {};
  if (!patch || typeof patch !== 'object') return out;
  const known = QUESTION_MAP_BY_TRACK[track];
  for (const [key, raw] of Object.entries(patch as Record<string, unknown>)) {
    if (!KEY_PATTERN.test(key) || typeof raw !== 'string') continue;
    const q = known.get(key);
    if (!q) continue;
    out[key] = raw.slice(0, maxLength(q)).replace(/\u0000/g, '');
  }
  return out;
}

/** Every completion-time problem, keyed by question id. Empty = can submit. */
export function completionErrors(track: OnboardingTrack, answers: Answers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const chapter of CHAPTERS) {
    for (const screen of screensFor(chapter, track)) {
      Object.assign(out, screenErrors(screen, answers));
    }
  }
  return out;
}

/** Where a question lives — for "jump to the first thing missing". */
export function locate(
  track: OnboardingTrack,
  questionId: string,
): { chapter: number; screen: number } | null {
  for (let c = 0; c < CHAPTERS.length; c++) {
    const screens = screensFor(CHAPTERS[c], track);
    for (let s = 0; s < screens.length; s++) {
      if (screens[s].questions.some((q) => q.id === questionId)) {
        // The limits set is one declared screen rendered as a deck: its
        // "screen" is the item's position in the deck.
        const deck = LIMIT_ITEMS.findIndex((i) => limitKey(i.id) === questionId);
        return { chapter: c, screen: CHAPTERS[c].id === 'limits' && deck >= 0 ? deck : s };
      }
    }
  }
  return null;
}

// ─── Status vocabulary (staff surface) ───────────────────────────────────────

/**
 * Stage of an onboarding, derived from `status` plus inactivity. `stalled` is
 * not stored — it is "started, and silent for STALL_AFTER_DAYS" — because the
 * whole point of the staff page is that many applicants start and never finish,
 * and a stored flag would need a job to set it.
 *
 * Hues borrow the house triad from `STATUS_COLORS` semantics: blue is moving,
 * orange waits on a person, green is done, zinc is neutral.
 */
export type OnboardingStage = 'completed' | 'started' | 'stalled' | 'invited';

export const STALL_AFTER_DAYS = 5;

export function onboardingStage(
  status: OnboardingStatus,
  lastActivityAt: string | null,
  now = Date.now(),
): OnboardingStage {
  if (status === 'completed') return 'completed';
  if (status === 'invited') return 'invited';
  const last = lastActivityAt ? Date.parse(lastActivityAt) : 0;
  return now - last > STALL_AFTER_DAYS * 86_400_000 ? 'stalled' : 'started';
}

export const ONBOARDING_STAGE_META: Record<
  OnboardingStage,
  { label: string; classes: string; dot: string }
> = {
  completed: { label: 'Completed', classes: 'text-green-400 bg-green-500/10 border-green-500/30', dot: 'bg-green-400' },
  started: { label: 'In progress', classes: 'text-blue-400 bg-blue-500/10 border-blue-500/30', dot: 'bg-blue-400' },
  stalled: { label: 'Stalled', classes: 'text-orange-400 bg-orange-500/10 border-orange-500/30', dot: 'bg-orange-400' },
  invited: { label: 'Not opened', classes: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/30', dot: 'bg-zinc-400' },
};

/** `@name` → `https://t.me/name`, for the staff page's primary action. */
export function telegramUrl(handle: string): string {
  return `https://t.me/${stripAt(handle)}`;
}

/** E.164 (`+27…`) → `https://wa.me/27…`. */
export function whatsappUrl(number: string): string {
  return `https://wa.me/${number.replace(/\D/g, '')}`;
}
