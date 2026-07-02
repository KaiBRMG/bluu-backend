# Auth & Access Control

> Covers three layers, outermost first: (1) **Browser access middleware** (edge rewrite), (2) **OAuth login flow**, (3) **API route auth middleware + authorization tiers**. Page-level permission resolution is a separate concern — see [permissions.md](permissions.md).

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `src/middleware.ts` | Edge middleware: blocks non-Electron browser access |
| `src/app/auth/google/` | Server component: builds OAuth URL, redirects to Google |
| `src/app/auth/callback/` | Client component: hands `code` back to Electron via deep link |
| `src/app/api/auth/google-url/route.ts` | Generates OAuth URL (for Electron direct use) |
| `src/app/api/auth/exchange-code/route.ts` | Code → Firebase custom token, sets claims, upserts user doc |
| `src/app/api/auth/session-token/route.ts` | Session-token endpoint (single active session) |
| `src/components/AuthProvider.tsx` | Internal-employee auth context (`isActive` enforced) |
| `src/components/CreatorAuthProvider.tsx` | Creator auth context |
| `src/components/AuthWrapper.tsx` | Gates the app during auth resolution (boot phase `'auth'`) |
| `src/lib/middleware/withAuth.ts` | API guard: verifies Firebase Bearer token |
| `src/lib/middleware/withCreatorAuth.ts` | API guard: token + creator doc existence + `isActive` |
| `src/lib/middleware/apiHelpers.ts` | `checkPageAccess`, notification batching helpers |
| `src/lib/firebase-admin.ts` | Admin SDK (`adminDb`, `adminAuth`) |

---

## Browser Access Middleware

`src/middleware.ts` blocks all non-Electron browser access. The matcher covers every **page** route (excludes `_next`, `api`, static assets — so API routes are unaffected).

**Decision order:**
```
1. path startsWith BROWSER_ALLOWED_PREFIXES entry  → allow (unconditional)
2. User-Agent contains "Electron/"                 → allow (desktop app)
3. otherwise                                        → rewrite to /desktop-only
```

**`BROWSER_ALLOWED_PREFIXES` (currently):**
- `/auth` — OAuth flow pages run in the system browser during login; must be reachable without Electron.
- `/creator-portal` — external creator interface, browser-accessible by design.
- `/desktop-only` — the "use the desktop app" landing page itself.

**RULE:** A new route that legitimately needs browser access must have its prefix added to `BROWSER_ALLOWED_PREFIXES`. API routes are already excluded from the matcher.

---

## OAuth Login Flow (internal employees)

Authentication is **Google OAuth only**. Sequence:

```
Electron (Login)
   │ opens system browser
   ▼
/auth/google  (server component)
   │ redirect with OAuth params
   ▼
accounts.google.com
   │ redirect back
   ▼
/auth/callback?code=...  (client component, in browser)
   │ redirect to deep link
   ▼
bluu://callback?code=...   ── hands code back to Electron ──►  Electron
                                                                  │ POST
                                                                  ▼
                                                       /api/auth/exchange-code
                                                          • code → Firebase custom token
                                                          • sets custom claims (admin: true/false)
                                                          • creates/updates users/{uid} doc
                                                                  │ returns custom token
                                                                  ▼
                                                       Electron signs in to Firebase
```

**API routes:**
- `/api/auth/google-url` — generates OAuth URL (used by Electron directly; `/auth/google` builds its own URL server-side).
- `/api/auth/exchange-code` — exchanges code for Firebase custom token, sets custom claims, upserts the user document.

### Admin claim
- Admin status is a **JWT custom claim** (`token.admin`), **not** a Firestore read.
- Set at login; **refreshed when group membership changes**.
- The `isAdmin()` Firestore security rule reads `request.auth.token.admin` → **zero Firestore reads**.

### Auth contexts
- **`AuthProvider`** — internal employees (`@bluurock.com` emails). Enforces the `isActive` check.
- **`CreatorAuthProvider`** — external creator accounts, used only in the creator portal.

### Single active session
`users/{uid}.sessionToken` is a UUID **rotated on every login**. The client stores it locally; an `onSnapshot` on the user doc detects a mismatch and **forces sign-out** — enforcing one active session per user. See also [data-layer.md](data-layer.md).

---

## API Route Auth Middleware

Every API route wraps its handler in one of:

- **`withAuth`** — verifies Firebase Bearer token, injects `DecodedIdToken` (as `token`).
- **`withCreatorAuth`** — same, **plus** verifies the caller exists in the `creators` collection and `isActive !== false`.

### Authorization tiers (least → most privileged)

Authorization layers **on top of** the middleware inside handlers.

| Tier | Check | Use for | Examples |
|---|---|---|---|
| 1. Authenticated only | `withAuth` alone | General reference data needed across many pages where a single page-permission check would block legitimate callers | `/api/creators`, `/api/users/display-names`, `/api/disputes/users` |
| 2. Page permission | `checkPageAccess(token.uid, '<pageId>')` (`apiHelpers.ts`) or inline `caller.permittedPageIds.includes(...)` | Most admin/feature endpoints | Most of `/api/admin/*`, `/api/shifts/*` |
| 3. Admin claim | `token.admin !== true` guard | Actions gating access to the **system itself** or the **authorization graph** | see below |

**Tier 3 (admin claim) is required for:**
- **Admin group membership writes** — `/api/admin/groups/admin/members` POST/DELETE. Also blocks self-promotion: `uids.includes(token.uid)`.
- **Page-permission map writes** — `/api/admin/pages/[pageId]/permissions` PUT. Editing this map is the root of all other authorization decisions, so it requires admin **even though** `'sharing'` page permission still gates the read on `/api/admin/pages` (GET). This asymmetry is intentional: anyone with `'sharing'` could otherwise grant themselves any page and chain into account-level changes.

**RULE:** When adding a new admin-action route, decide which tier applies. **Do not** default to "page permission" if the action affects the auth graph or account state (`isActive`, admin membership, the permission map).
