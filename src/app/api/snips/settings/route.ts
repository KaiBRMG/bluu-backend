import { NextRequest, NextResponse } from 'next/server';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import {
  isSnipRetention,
  isValidSnipShortcut,
  type SnipSettings,
} from '@/lib/snips';
import {
  getSnipSettings,
  requireSnippingToolAccess,
  saveSnipSettings,
} from '@/lib/services/snipService';

/**
 * PUT /api/snips/settings — the tray item, the global shortcut, auto-delete.
 *
 * **Why these do not go through `/api/user/update`** like the other user
 * preferences: saving `retention` has a side effect (every existing snip's
 * `expiresAt` is recomputed — see `saveSnipSettings`), and the generic update
 * route is a field allowlist with no room for one. Putting the side effect
 * behind the field would make a whole-user PATCH quietly rewrite a collection.
 *
 * **There is deliberately no GET.** The settings ride down on the `users/{uid}`
 * `onSnapshot` the app already holds open, so a read endpoint would be a second
 * origin round-trip for data the client is handed live (rule 9i). Only the write
 * needs HTTP.
 *
 * `no-store` on the response: these settings arm a global keyboard shortcut and
 * a tray item in the Electron shell (rule 9c — that renderer may be weeks old),
 * so a stale one is a shortcut still registered after the user turned it off.
 */
export const PUT = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  const denied = await requireSnippingToolAccess(token.uid);
  if (denied) return denied;

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid settings' }, { status: 400 });
    }

    const current = await getSnipSettings(token.uid);

    // Every field is validated here rather than trusted from the dialog. The
    // shortcut in particular: `globalShortcut.register` throws on a malformed
    // accelerator and accepts a bare unmodified key, which would swallow that
    // keystroke in every other application on the machine. See
    // `isValidSnipShortcut`.
    const next: SnipSettings = {
      trayIconEnabled:
        typeof body.trayIconEnabled === 'boolean' ? body.trayIconEnabled : current.trayIconEnabled,
      shortcutEnabled:
        typeof body.shortcutEnabled === 'boolean' ? body.shortcutEnabled : current.shortcutEnabled,
      shortcut: current.shortcut,
      retention: current.retention,
    };

    if (body.shortcut !== undefined) {
      if (!isValidSnipShortcut(body.shortcut)) {
        return NextResponse.json(
          { error: 'That shortcut needs at least one modifier and one key.' },
          { status: 400 },
        );
      }
      next.shortcut = body.shortcut;
    }

    if (body.retention !== undefined) {
      if (!isSnipRetention(body.retention)) {
        return NextResponse.json({ error: 'Unknown auto-delete option' }, { status: 400 });
      }
      next.retention = body.retention;
    }

    const saved = await saveSnipSettings(token.uid, next);
    return NextResponse.json({ settings: saved }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error, 'PUT /api/snips/settings');
  }
});
