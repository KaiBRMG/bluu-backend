export interface TypeColor {
  /** Classes for a static chip / badge (always shown coloured). */
  badge: string;
  /** Classes applied to a `<ToggleGroupItem>` so the colour only shows when on. */
  toggle: string;
  /** Dot indicator beside the toggle label. */
  dot: string;
}

// Each variant string lists full class names as literals so Tailwind's JIT
// picks them up during build. Do not template-concatenate these prefixes —
// e.g. `data-[state=on]:${c.bg}` would never be generated.
const PALETTE: TypeColor[] = [
  {
    badge:  'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-500/30',
    toggle: 'data-[state=on]:bg-emerald-100 data-[state=on]:text-emerald-800 data-[state=on]:border-emerald-300 dark:data-[state=on]:bg-emerald-500/15 dark:data-[state=on]:text-emerald-200 dark:data-[state=on]:border-emerald-500/30',
    dot:    'bg-emerald-500',
  },
  {
    badge:  'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-500/15 dark:text-sky-200 dark:border-sky-500/30',
    toggle: 'data-[state=on]:bg-sky-100 data-[state=on]:text-sky-800 data-[state=on]:border-sky-300 dark:data-[state=on]:bg-sky-500/15 dark:data-[state=on]:text-sky-200 dark:data-[state=on]:border-sky-500/30',
    dot:    'bg-sky-500',
  },
  {
    badge:  'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/30',
    toggle: 'data-[state=on]:bg-amber-100 data-[state=on]:text-amber-800 data-[state=on]:border-amber-300 dark:data-[state=on]:bg-amber-500/15 dark:data-[state=on]:text-amber-200 dark:data-[state=on]:border-amber-500/30',
    dot:    'bg-amber-500',
  },
  {
    badge:  'bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-500/15 dark:text-violet-200 dark:border-violet-500/30',
    toggle: 'data-[state=on]:bg-violet-100 data-[state=on]:text-violet-800 data-[state=on]:border-violet-300 dark:data-[state=on]:bg-violet-500/15 dark:data-[state=on]:text-violet-200 dark:data-[state=on]:border-violet-500/30',
    dot:    'bg-violet-500',
  },
  {
    badge:  'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-500/30',
    toggle: 'data-[state=on]:bg-rose-100 data-[state=on]:text-rose-800 data-[state=on]:border-rose-300 dark:data-[state=on]:bg-rose-500/15 dark:data-[state=on]:text-rose-200 dark:data-[state=on]:border-rose-500/30',
    dot:    'bg-rose-500',
  },
  {
    badge:  'bg-cyan-100 text-cyan-800 border-cyan-300 dark:bg-cyan-500/15 dark:text-cyan-200 dark:border-cyan-500/30',
    toggle: 'data-[state=on]:bg-cyan-100 data-[state=on]:text-cyan-800 data-[state=on]:border-cyan-300 dark:data-[state=on]:bg-cyan-500/15 dark:data-[state=on]:text-cyan-200 dark:data-[state=on]:border-cyan-500/30',
    dot:    'bg-cyan-500',
  },
  {
    badge:  'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300 dark:bg-fuchsia-500/15 dark:text-fuchsia-200 dark:border-fuchsia-500/30',
    toggle: 'data-[state=on]:bg-fuchsia-100 data-[state=on]:text-fuchsia-800 data-[state=on]:border-fuchsia-300 dark:data-[state=on]:bg-fuchsia-500/15 dark:data-[state=on]:text-fuchsia-200 dark:data-[state=on]:border-fuchsia-500/30',
    dot:    'bg-fuchsia-500',
  },
  {
    badge:  'bg-lime-100 text-lime-800 border-lime-300 dark:bg-lime-500/15 dark:text-lime-200 dark:border-lime-500/30',
    toggle: 'data-[state=on]:bg-lime-100 data-[state=on]:text-lime-800 data-[state=on]:border-lime-300 dark:data-[state=on]:bg-lime-500/15 dark:data-[state=on]:text-lime-200 dark:data-[state=on]:border-lime-500/30',
    dot:    'bg-lime-500',
  },
  {
    badge:  'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-500/15 dark:text-orange-200 dark:border-orange-500/30',
    toggle: 'data-[state=on]:bg-orange-100 data-[state=on]:text-orange-800 data-[state=on]:border-orange-300 dark:data-[state=on]:bg-orange-500/15 dark:data-[state=on]:text-orange-200 dark:data-[state=on]:border-orange-500/30',
    dot:    'bg-orange-500',
  },
  {
    badge:  'bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-500/15 dark:text-indigo-200 dark:border-indigo-500/30',
    toggle: 'data-[state=on]:bg-indigo-100 data-[state=on]:text-indigo-800 data-[state=on]:border-indigo-300 dark:data-[state=on]:bg-indigo-500/15 dark:data-[state=on]:text-indigo-200 dark:data-[state=on]:border-indigo-500/30',
    dot:    'bg-indigo-500',
  },
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function colorForType(type: string): TypeColor {
  return PALETTE[hash(type) % PALETTE.length];
}
