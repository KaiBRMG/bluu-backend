# Architecture Overview

> System-wide facts: repo layout, toolchain, commands, environment, portal topology, and the shared UI stack. Component-level behavior lives in the sibling spoke files (see [CLAUDE.md](../CLAUDE.md) index).

## 1. Product Context

- Internal management platform for **Bluu Rock MGMT**.
- Serves two audiences: **internal employees** (via a desktop Electron app only) and external **creators** (via a browser portal).
- **RULE:** Always notify the user when changes touch **Firestore rules** or **Firestore indexes**.

## 2. Repository Structure (monorepo)

| Path | Project | Notes |
|---|---|---|
| `src/` | Next.js 16 web app | App Router, TypeScript, React 19. **Primary codebase.** Run all Next.js commands from here. Services all employees. |
| `electron/` | Electron wrapper | Embeds the Next.js app as a desktop app. Employees access the system **only** through this. |
| `src/app/creator-portal/` | Creator interface | Client-facing. Separate from the main system, separate auth flow. |
| `functions/` | Firebase Cloud Functions | Node.js, plain JS. Two functions: `generateThumbnail` (Storage trigger) + daily scheduled stale-session cleanup. |
| `tests/firestore-rules/` | Rules tests | Requires Firebase Emulator on port 8080. |

## 3. Commands

**Next.js (run from `src/`):**
```bash
cd src
npm run dev          # Start dev server
npm run build        # Production build (uses 4GB Node heap)
npm run lint         # ESLint
npm run analyze      # Bundle analyzer (sets ANALYZE=true)
```

**Firestore rules tests (Emulator on port 8080):**
```bash
cd tests/firestore-rules
npm test             # Run all rules tests
npm run test:watch   # Watch mode
```

**Electron (run from `electron/`):**
```bash
cd electron
npm run dev          # Run in dev mode
npm run dist:mac     # Build macOS distributable
```

## 4. Environment Variables

Required in `src/.env.local`:

```
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
NEXT_PUBLIC_GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
FIREBASE_SERVICE_ACCOUNT   # JSON string of service account key
```

- `NEXT_PUBLIC_*` are client-exposed by Next convention. Everything else is **server-only**.
- Resources are served from the Firestore `app-resources` collection (no external integration) — see [resources.md](resources.md).

## 5. Portal Topology

```
                 ┌─────────────────────────────────────────┐
   Electron ───► │  Internal portals (employees)           │
   (desktop)     │  /ca-portal/  /admin/  /applications/    │
                 │  AuthProvider  +  withAuth               │
                 └─────────────────────────────────────────┘
                 ┌─────────────────────────────────────────┐
   Browser  ───► │  Creator portal (external creators)     │
   (system)      │  /creator-portal/                       │
                 │  CreatorAuthProvider  +  withCreatorAuth │
                 └─────────────────────────────────────────┘
```

| Portal | Route prefix | Auth context | API middleware |
|---|---|---|---|
| Internal (employees) | `/ca-portal/`, `/admin/`, `/applications/` | `AuthProvider` | `withAuth` |
| Creator | `/creator-portal/` | `CreatorAuthProvider` | `withCreatorAuth` |

Browser access to internal routes is blocked by `src/middleware.ts` — see [auth.md](auth.md#browser-access-middleware).

## 6. UI Stack (strict constraints)

- **Components:** shadcn/ui primitives only, from `src/components/ui/` (Radix UI + Tailwind). **ONLY** use visual components/styling from `src/components/ui`.
- **Icons:** **ONLY** `@tabler/icons-react` and `lucide-react`.
- **Theming:** CSS variables (`var(--foreground)`, etc.) — never hardcode theme colors.
- **Toasts:** `sonner`.
- **Drag & drop:** `@dnd-kit`.
- **Avatars:** always `src/components/ui/avatar.tsx` (`Avatar` / `AvatarImage` / `AvatarFallback`) — never a raw `<img>`. See [user-management.md](user-management.md#profile-pictures).

## 7. Where things live (quick map)

| Concern | Location |
|---|---|
| Server services | `src/lib/services/` |
| Client data hooks | `src/hooks/` |
| React contexts | `src/contexts/` |
| API route handlers | `src/app/api/**/route.ts` |
| Auth middleware | `src/lib/middleware/` (`withAuth.ts`, `withCreatorAuth.ts`, `apiHelpers.ts`) |
| Page definitions | `src/lib/definitions.ts` |
| Firebase Admin SDK | `src/lib/firebase-admin.ts` |
| Shared UI | `src/components/ui/` |
