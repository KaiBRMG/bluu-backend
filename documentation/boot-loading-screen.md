# Boot Loading Screen

> A single persistent full-screen loader covers the app until a flicker-free first paint is ready. Getting this wrong reintroduces the original bugs: a flash of the "Unassigned" group card / empty sidebar, or home-page widget skeletons during boot.

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `src/components/LoadingScreen.tsx` | The loader UI (plays `src/public/loader.webm`) |
| `src/contexts/BootLoaderContext.tsx` | `BootLoaderProvider`, `useBootPhase`, `MIN_LOADER_MS`, `booted` latch |
| `src/app/(main)/layout.tsx` | Mounts `BootLoaderProvider` **above** `AuthWrapper` |
| `src/components/AuthWrapper.tsx` | Reports phase `'auth'` |
| `src/components/AppLayout.tsx` | Reports phase `'app-data'` |
| `src/app/(main)/page.tsx` | Home widgets report `'home-*'` phases |

---

## Rules

### 1. Single persistent loader
Rendered in **exactly one place** — `BootLoaderProvider`, mounted in `src/app/(main)/layout.tsx` **above** `AuthWrapper`. It stays mounted for the whole boot so the `<video>` element **never remounts** (a remount restarts the animation → flicker).

**ANTI-PATTERN:** Do **not** render `LoadingScreen` anywhere else.

### 2. Phase gating (report, don't control)
Components don't show/hide the loader directly — they **report** their loading state via `useBootPhase(key, loading)`. The loader stays up while **any** phase is pending.

| Phase key | Reporter | Cleared when |
|---|---|---|
| `'auth'` | `AuthWrapper` | Firebase auth resolves (returns `null` meanwhile; provider's loader covers screen) |
| `'app-data'` | `AppLayout` | `useUserData` + `usePermissions` resolve (user groups + page permissions). Includes a one-commit `gatesSettled` bridge so home widgets mount and register their phases before this clears |
| `'home-resources'` | home page widget | its data resolves |
| `'home-notifications'` | home page widget | its data resolves |
| `'home-timetracking'` | home page widget | its data resolves |

### 3. Lift timing
Loader lifts at `max(all phases cleared, MIN_LOADER_MS)`.
- `MIN_LOADER_MS` = **3s** (in `BootLoaderContext.tsx`) — an aesthetic floor so the animation plays ≥1 full cycle; also bridges brief gaps between phases. It's a **minimum, not a fixed delay** — slower loads stay up longer.
- After first boot, a `booted` latch prevents the loader from ever reappearing for the session; in-app navigation relies on each view's own skeletons.
- A full app **reload** resets the latch (a genuine new boot).

---

## RULE — Adding home-page widgets

Any new widget on the home page (`src/app/(main)/page.tsx`) that loads data **asynchronously MUST** gate the loader:

```ts
useBootPhase('home-<name>', isLoading);
```

Otherwise its skeleton/empty state flashes on boot before its data arrives.

- Widgets that read only **already-gated** data (e.g. the live `useUserData` snapshot) do **not** need their own phase.
- This requirement is **home-page-specific** — other pages use normal in-place skeletons and must **not** add boot phases.
