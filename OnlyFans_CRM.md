# OnlyFans CRM — Implementation Roadmap

## Context

This is an additive feature to an existing SaaS application built as a **Next.js web app wrapped in an Electron container** (desktop-only). The OnlyFans CRM will live in a dedicated Electron window, spawned from the main app's sidebar. The underlying data layer will interface with a **third-party OnlyFans API provider** via a clean adapter interface, designed for future provider replacement without rearchitecting.

---

## Guiding Architecture Principle

All OnlyFans operations must go through a single adapter interface (e.g. `IOnlyFansClient`). No component, hook, or service should call a provider's SDK or HTTP endpoints directly. This is the non-negotiable prerequisite for plug-and-play provider replacement.

---

## Tasks

### 1. Config
- Wire up the OnlyFans sidebar item (OF Manager) with the correct custom icon: in `src/lib/definitions.ts`, locate the OnlyFans page definition where the `icon` field is currently empty. Set the icon to reference the existing SVG at `src/public/Icons/onlyfans.svg`. 
- Spawn a dedicated, isolated Electron window when the user clicks the OnlyFans sidebar item: The window must verify the requesting user has OnlyFans access before proceeding. Prevent duplicate windows — if one is already open, focus it instead of spawning another. Load the OF Manager Next.js route into this window. The OnlyFans window should be dependent on the main window -- if the user closes the main window, the OnlyFans window should also close. The OnlyFans window should be independently resizable. 
- Gate the OnlyFans feature behind the existing access control system: Wrap the sidebar OnlyFans item so it only renders if the current user has the OnlyFans page in their shared pages. Ensure the Electron IPC handler that spawns the OnlyFans window also checks this permission server-side or in the main process — do not rely solely on UI-level hiding.

### 2. Window Components

- We are using a third-party API provider to access OnlyFans. Find the full API schema here: `OnlyFans_CRM.md`.
- Future work for OF Manager system will include uploading to vault, granulated permissions for specific OnlyFans pages and functions, audit logs for all actions, wiring up to the existing time tracking system for better access control, wiring up to the existing creator collection, earnings reports, notifications, etc. But for now, you only need to implement one thing: messaging on only 1 account. Code while keeping the expansion intents in mind. A test account is already linked on openai -- use this only, we will not be connecting our existing creators yet. Model the page using this as a guide of what is needed: `Screenshot 2026-08-05 at 16.14.25.png`. Ignore extra components on this screenshot that do not relate to messaging specifically. 
- By the end of this task there should be a chats page showing all fans/subscribers. Opening a chat should show all history of that chat if the user scrolls up (lazy load). The user should be able to send messages. Other features like vault, etc. are not needed and will be added to the next iteration.


## Instructions

- Minimise firestore reads and writes where possible.
- IMPORTANT: minimimse onlyfans api (openapi) reads and writes where possible, and opt for webhooks where relevant.
- the OpenAPI key is in the .env.local file (`ONLYFANSAPI_API_KEY`).
- Consider the use of cache.
- Only use shadcn components.
- Implement lazy load where possible.


