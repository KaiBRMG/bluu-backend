'use client';

import { useCallback, useEffect, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { meetsMinVersion } from '@/lib/appVersion';
import { useAppVersion } from '@/hooks/useAppVersion';
import type { SnipMicPermission } from '@/lib/snips';
import { SNIP_MIC_MIN_APP_VERSION, resolveSnipMicPermission } from '@/lib/snips';

/**
 * The microphone's standing state, in the settings card.
 *
 * **The toggle itself is not here — it is on the selection surface, beside
 * System audio**, because narration is a per-recording decision and the moment
 * to make it is the moment of capture. What belongs here is the thing that is
 * *not* per-recording: whether this machine will let us near a microphone at
 * all. That is an account-and-device fact, it is the thing a user cannot fix
 * from a bar that disappears the instant they start dragging, and it is what
 * they come looking for after a recording came out silent.
 *
 * ## Why it reads the status rather than just offering a button
 *
 * This is the failure this component exists to avoid, and it is the one every
 * naive version of this flow ships with. On macOS,
 * `systemPreferences.askForMediaAccess` resolves with the **existing** status
 * and shows **no alert** once access has been refused — so a single "Allow
 * microphone" button does nothing at all for precisely the users who need it,
 * with no error and no explanation. Windows has no per-app prompt in the first
 * place: access is one global switch for every win32 application.
 *
 * So the control is chosen from the status, not from a boolean:
 *
 * | Status | What is offered |
 * |---|---|
 * | `granted` | nothing to do — it says so and stops |
 * | `not-determined` | **Allow** — macOS shows the OS prompt; Windows opens settings |
 * | `denied` | **Open settings** — the only route left on either platform |
 * | `restricted` | a sentence. No button would help, so none is drawn |
 * | `unknown` | nothing — the platform cannot answer, so claiming a problem would be a guess |
 *
 * ## It re-reads on focus
 *
 * The other half of the same failure. The user clicks Open settings, grants
 * access in another application, comes back — and a card that read the status
 * once on mount is still showing the refusal, so they conclude it did not
 * work. Re-reading whenever the window regains focus makes the correction
 * immediate and needs no "I've done it" button.
 */
export function SnipMicrophoneField() {
  const { version, status: versionStatus } = useAppVersion();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [status, setStatus] = useState<SnipMicPermission>('unknown');
  const [canPrompt, setCanPrompt] = useState(false);
  const [busy, setBusy] = useState(false);

  const read = useCallback(async () => {
    const api = window.electronAPI?.permissions;
    // Feature-detected: an installed shell older than 0.15.0 has no
    // microphone bridge at all (rule 9c). There the field renders nothing
    // rather than claiming a problem it cannot diagnose.
    if (!api?.microphoneStatus) {
      setSupported(false);
      return;
    }
    try {
      const info = await api.microphoneStatus();
      setSupported(!!info?.supported);
      setStatus(resolveSnipMicPermission(info?.status));
      setCanPrompt(!!info?.canPrompt);
    } catch {
      setSupported(false);
    }
  }, []);

  useEffect(() => {
    void read();
    // Closes the loop on "go and change a setting" — see the note above.
    const onFocus = () => { void read(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [read]);

  const act = useCallback(async () => {
    const api = window.electronAPI?.permissions;
    if (!api?.requestMicrophoneAccess) return;
    setBusy(true);
    try {
      const result = await api.requestMicrophoneAccess();
      setStatus(resolveSnipMicPermission(result?.status));
    } catch {
      // An IPC failure is not evidence the microphone is unavailable, so the
      // status is left as it was rather than downgraded to a refusal the user
      // never actually hit.
    } finally {
      setBusy(false);
    }
  }, []);

  // **Two belts, and both are needed** — the same split the page uses for the
  // video floor. `SNIP_MIC_MIN_APP_VERSION` is the declaration: a shell that
  // predates narration has no microphone toggle on its capture bar, so a
  // permission row here would describe a control that surface does not draw.
  // The feature detection in `read()` is the second belt, and it is what stays
  // correct if the bridge is ever partially present.
  //
  // `versionStatus` is checked rather than the boolean alone so the row does
  // not flash away for everyone during the tick before the IPC answers —
  // `meetsMinVersion` treats an unknown version as failing, which is right for
  // a decision and wrong to paint.
  if (versionStatus === 'resolved' && !meetsMinVersion(version, SNIP_MIC_MIN_APP_VERSION)) {
    return null;
  }

  // Nothing to say on a platform with no microphone permission, or on a shell
  // that predates the bridge. A row reading "unknown" would be noise.
  if (supported !== true) return null;

  const blocked = status === 'denied' || status === 'restricted';
  const action =
    status === 'not-determined'
      ? canPrompt ? 'Allow' : 'Open settings'
      : status === 'denied'
        ? 'Open settings'
        : null;

  return (
    <div className="flex items-start justify-between gap-4 border-t border-white/[0.07] pt-4">
      <div className="min-w-0">
        {/* A <p>, not a <Label>. This row has no control to label — the toggle
            is on the capture bar — and a <label> pointing at nothing is a
            promise to assistive tech that clicking it will focus something. */}
        <p className="flex items-center gap-1.5 text-xs text-zinc-400">
          {blocked ? (
            <MicOff className="size-3.5 text-orange-400" aria-hidden />
          ) : (
            <Mic className="size-3.5" aria-hidden />
          )}
          Microphone
        </p>
        {/* Each status says what is true AND what happens next. None of them
            leaves the reader to infer whether they have a problem. */}
        <p className="mt-0.5 text-[11px] text-zinc-400">
          {status === 'granted' &&
            'Allowed. Turn Microphone on in the capture bar to narrate a recording.'}
          {status === 'not-determined' &&
            'Not requested yet. You will be asked the first time you record with it on.'}
          {status === 'denied' &&
            'Blocked by your operating system. Recordings will have no narration until you allow it.'}
          {status === 'restricted' &&
            'Restricted by a policy on this device, so narration is not available.'}
          {status === 'unknown' &&
            'This device could not be checked. Narration will simply work or it will not.'}
        </p>
      </div>

      {action && (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={busy}
          onClick={act}
        >
          {busy ? 'Checking…' : action}
        </Button>
      )}
    </div>
  );
}
