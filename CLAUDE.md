# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Context

This is an internal management platform for Bluu Rock MGMT.

## Repository Structure

This is a monorepo with three distinct sub-projects:

- **`src/`** — Next.js 16 web app (App Router, TypeScript, React 19). The primary codebase. Run all Next.js commands from this directory. This is the main web app and services all employees.
- **`electron/`** — Electron wrapper that embeds the Next.js app in a desktop application. Employees only have access via this Electron app.
- **`src/app/creator-portal/`** — The interface for clients (known as creators). This interface is separate from the main system and uses a different Auth flow.
- **`functions/`** — Firebase Cloud Functions (Node.js, plain JS). Two functions: `generateThumbnail` (Storage trigger) and a daily scheduled cleanup for stale sessions.

## Commands

All Next.js commands run from `src/`:

```bash
cd src
npm run dev          # Start dev server
npm run build        # Production build (uses 4GB Node heap)
npm run lint         # ESLint
npm run analyze      # Bundle analyzer (sets ANALYZE=true)
```

Firestore rules tests (requires Firebase Emulator on port 8080):

```bash
cd tests/firestore-rules
npm test             # Run all rules tests
npm run test:watch   # Watch mode
```

Electron desktop app (from `electron/`):

```bash
cd electron
npm run dev          # Run in dev mode
npm run dist:mac     # Build macOS distributable
```

## Environment Variables

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

## Architecture

### Auth Flow

Authentication is Google OAuth only, handled server-side via two API routes:
1. `/api/auth/google-url` — generates OAuth URL
2. `/api/auth/exchange-code` — exchanges code for Firebase custom token, sets custom claims (`admin: true/false`), creates/updates the user document

Admin status comes from a **JWT Custom Claim** (`token.admin`), not a Firestore read. The claim is set at login and refreshed when group membership changes.

There are two separate auth contexts:
- **`AuthProvider`** (`src/components/AuthProvider.tsx`) — for internal employees (`@bluurock.com` emails), enforces `isActive` check
- **`CreatorAuthProvider`** (`src/components/CreatorAuthProvider.tsx`) — for external creator accounts, used only in the creator portal

### API Route Auth Middleware

All API routes are wrapped with one of two middleware functions:
- **`withAuth`** (`src/lib/middleware/withAuth.ts`) — verifies Firebase Bearer token, injects `DecodedIdToken`
- **`withCreatorAuth`** (`src/lib/middleware/withCreatorAuth.ts`) — same as above, but also verifies the user exists in the `creators` Firestore collection and `isActive !== false`

### Portal Structure

Three distinct portals, each with its own layout/auth:

| Portal | Route prefix | Auth |
|--------|-------------|------|
| Internal (employees) | `/ca-portal/`, `/admin/`, `/applications/` | `AuthProvider` + `withAuth` |
| Creator | `/creator-portal/` | `CreatorAuthProvider` + `withCreatorAuth` |

### Data Layer

**Server-side services** (`src/lib/services/`):
- `userService.ts` — 60s in-process cache; call `invalidateUserCache(uid)` after any user doc write
- `pageService.ts` — page permission resolution
- `timeEntryService.ts`, `screenshotService.ts`, `shiftService.ts`, etc.

**Client-side data hooks** (`src/hooks/`):
- `useUserData` — live `onSnapshot` on the user doc (serves from IndexedDB cache on reload)
- `useTimesheetData` — sessionStorage cache (5 min TTL); call `invalidateTimesheetCache(uid)` after clock-in/out
- `useDisputesData` — wraps all disputes API routes; creator/CA user lists cached in sessionStorage (5 min)
- Permissions are cached in localStorage via `src/lib/permissionsCache.ts` (no TTL)

### Firestore Collections

Key collections and their purpose:
- `users/{uid}` — internal employee documents (`UserDocument`)
- `creators/{uid}` — external creator accounts (`CreatorFullDocument`)
- `active_sessions/{userId}` — lightweight presence doc; deleted on clock-out
- `time_entries/{sessionId}` — permanent ledger written at clock-out
- `page-permissions/{pageId}` — which groups/users can access each page
- `screenshots/{docId}` — screenshot metadata; Storage paths for full-size and thumbnails
- `shifts/{shiftId}` — recurring/one-off shift definitions
- `disputes/{disputeId}` — dispute records for the CA portal
- `notifications/{docId}`, `notifications-batches/{batchId}` — notification system

The `TimeEntryDocument` interface is `@deprecated`; new sessions use `ActiveSessionDocument` + `TimeEntryLedgerDocument`.

### Firestore Read Optimisation

- `getUserById` has a 60s TTL in-process cache — any route that writes a user doc must call `invalidateUserCache(uid)` in the same handler
- Batch reads use `adminDb.getAll(...refs)` to avoid N+1 reads
- `enableScreenshots` is read from the client-side `useUserData` snapshot, NOT from the time-tracking status API
- The `isAdmin()` Firestore security rule uses `request.auth.token.admin` (JWT claim) — zero Firestore reads

### Session Token (Single Active Session)

`users/{uid}.sessionToken` is a UUID rotated on every login. The client stores it locally; `onSnapshot` on the user doc detects a mismatch and forces sign-out, enforcing single active session.

### Time Tracking Session Model

Sessions use an event log architecture:
1. Client appends events (`clock-in`, `idle-start`, `break-start`, etc.) to a local buffer (`src/lib/localBuffer.ts`)
2. Heartbeat API (`/api/time-tracking/heartbeat`) updates `active_sessions/{userId}.lastUpdated` and `currentState`
3. On clock-out, the full event log is uploaded and `time_entries/{sessionId}` is written
4. The daily Cloud Function closes stale sessions (no heartbeat for 6+ hours) that weren't explicitly clocked out

### Permissions System

Pages are code-defined in `src/lib/definitions.ts` (not Firestore). `page-permissions/{pageId}` maps each page to allowed groups/users. Resolved access is denormalised onto `users/{uid}.permittedPageIds` for fast sidebar rendering.

### UI Stack

- shadcn/ui components (`src/components/ui/`) — Radix UI primitives with Tailwind
- ONLY use visual components and styling from `src/components/ui`.
- ONLY use `@tabler/icons-react` and `lucide-react` for icons
- CSS variables for theming (`var(--foreground)`, etc.)
- `sonner` for toast notifications
- `@dnd-kit` for drag-and-drop


