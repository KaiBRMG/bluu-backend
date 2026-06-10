# OnlyFans CRM — Implementation Roadmap

## Context

This is an additive feature to an existing SaaS application built as a **Next.js web app wrapped in an Electron container** (desktop-only). The OnlyFans CRM will live in a dedicated Electron window, spawned from the main app's sidebar. The underlying data layer will interface with a **third-party OnlyFans API provider** via a clean adapter interface, designed for future provider replacement without rearchitecting.

---

## Guiding Architecture Principle

All OnlyFans operations must go through a single adapter interface (e.g. `IOnlyFansClient`). No component, hook, or service should call a provider's SDK or HTTP endpoints directly. This is the non-negotiable prerequisite for plug-and-play provider replacement.

---

## Phase 1 — Sidebar Icon & Navigation Entry Point

**Goal:** Wire up the OnlyFans sidebar item with the correct custom icon.

### Tasks

- In `src/lib/definitions.ts`, locate the OnlyFans page definition where the `icon` field is currently empty.
- Set the icon to reference the existing SVG at `src/public/Icons/onlyfans.svg`.
- Confirm the sidebar renders the icon correctly in the existing navigation component.

### Acceptance Criteria

- The OnlyFans entry appears in the sidebar with the correct branding icon.
- No other sidebar items are affected.

---

## Phase 2 — Access Control Integration

**Goal:** Gate the OnlyFans feature behind the existing access control system.

### Context

The app uses a page-level sharing model: if a page is shared with a user, they have full read/write access to its content. If not shared, nothing from that page — no UI components, no data, no API calls — should be accessible.

### Tasks

- Register the OnlyFans page in whatever access control registry/config the existing system uses (role definitions, permission maps, Firestore rules, etc.).
- Wrap the sidebar OnlyFans item so it only renders if the current user has the OnlyFans page in their shared pages.
- Ensure the Electron IPC handler that spawns the OnlyFans window (Phase 3) also checks this permission server-side or in the main process — do not rely solely on UI-level hiding.
- All data fetched via `IOnlyFansClient` must be scoped to authenticated, authorised sessions only. No data should be fetchable by users without this permission, even via direct IPC calls.

### Acceptance Criteria

- Users without access: sidebar item hidden, window cannot be spawned, IPC calls return unauthorised.
- Users with access: full functionality available.

---

## Phase 3 — OnlyFans Electron Window

**Goal:** Spawn a dedicated, isolated Electron window when the user clicks the OnlyFans sidebar item.

### Tasks

#### 3.1 — IPC Channel: Spawn Window

- In the Electron main process, register an IPC handler (e.g. `ipcMain.handle('open-onlyfans-window', ...)`) that:
  - Verifies the requesting user has OnlyFans access before proceeding.
  - Creates a new `BrowserWindow` with appropriate config (see below).
  - Prevents duplicate windows — if one is already open, focus it instead of spawning another.

#### 3.2 — Window Configuration

```typescript
new BrowserWindow({
  width: 1440,
  height: 900,
  minWidth: 1280,
  minHeight: 768,
  title: 'OnlyFans',
  // Match existing app's webPreferences setup
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    preload: path.join(__dirname, 'preload.js'), // reuse or create dedicated preload
  },
})
```

- Load the OnlyFans-specific Next.js route (e.g. `/onlyfans`) into this window.
- The window should be independently resizable and not tied to the main window's lifecycle (closing main window should not close this one, and vice versa — confirm this matches desired UX).

#### 3.3 — Renderer: Trigger from Sidebar

- In the sidebar component, the OnlyFans item's `onClick` should invoke the IPC channel:
  ```typescript
  window.electron.ipcRenderer.invoke('open-onlyfans-window')
  ```
- Handle the case where the IPC call is rejected (no access) gracefully — show no error to the user beyond the item not being clickable.

#### 3.4 — OnlyFans Window Root Page

- Create `src/app/onlyfans/page.tsx` (or equivalent route) as the root of the OnlyFans window.
- This page is the shell that will house all OnlyFans CRM components going forward.
- For now, render a placeholder layout confirming the window loads correctly.

### Window Components

> ⚠️ **PLACEHOLDER — Components not yet specified.**
> The window components were not provided at time of writing. Update this section with the list of components required in the OnlyFans window before implementing Phase 3.4 onwards.

---

## Phase 4 — Adapter Interface & Provider Integration

> To be detailed in the next roadmap increment, after Phase 3 is complete.

High-level intent:
- Define `IOnlyFansClient` interface covering all required operations.
- Implement a concrete `ProviderOnlyFansClient` against the chosen third-party provider.
- Wire the client into the OnlyFans window via a React context or service layer.
- All future feature work consumes `IOnlyFansClient` only — never the concrete implementation directly.

---

## File Reference Summary

| Path | Purpose |
|---|---|
| `src/lib/definitions.ts` | Add OnlyFans icon reference |
| `src/public/Icons/onlyfans.svg` | Custom icon asset (already exists) |
| `electron/main.ts` (or equivalent) | IPC handler for window spawning |
| `src/app/onlyfans/page.tsx` | Root route for the OnlyFans window |
| `src/lib/onlyfans/IOnlyFansClient.ts` | Adapter interface (Phase 4) |