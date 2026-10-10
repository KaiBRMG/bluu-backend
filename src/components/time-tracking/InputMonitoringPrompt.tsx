'use client';

import { useCallback, useEffect, useState } from 'react';
import { IconKeyboard, IconX } from '@tabler/icons-react';
import { Loader2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUserData } from '@/hooks/useUserData';
import { useTimeTrackingContext } from '@/contexts/TimeTrackingContext';
import type { InputPermission } from '@/lib/inputQuality';

type Status = { supported: boolean; status: InputPermission; needsRestart: boolean };

const DISMISS_KEY = 'bluu_input_monitoring_prompt_dismissed';
const RECHECK_MS = 60_000;

function dismissedThisSession(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * "Allow Input Monitoring" — macOS only, and only for users whose time-tracking
 * settings turn on input monitoring (`users/{uid}.inputMonitoring`, resolved
 * org → group → user, so it arrives live).
 *
 * The permission is what lets the desktop app see *which kind* of key was
 * pressed (typing / modifier / filler) and exact timings. Without it the app
 * still runs, on a coarser fallback — so this asks, it never blocks.
 *
 * A top-right prompt card, not a modal (DESIGN.md §5, The Corner Rule): it
 * waits for an answer without stealing focus from a shift. "Not now" holds for
 * this app session; it asks again next launch. Three states, because macOS
 * gives three different answers:
 *   - never asked   → "Allow" shows the OS prompt (once, ever);
 *   - refused       → only System Settings can change it, so that is the button;
 *   - granted, but no event tap yet → macOS applies a new grant on relaunch,
 *     offered only while clocked out so it can never end a shift.
 */
export default function InputMonitoringPrompt() {
  const { userData } = useUserData();
  const { displayState } = useTimeTrackingContext();
  const [status, setStatus] = useState<Status | null>(null);
  const [dismissed, setDismissed] = useState(dismissedThisSession);
  const [busy, setBusy] = useState(false);
  const enabled = userData?.inputMonitoring === true;

  const refresh = useCallback(async () => {
    const api = window.electronAPI?.permissions;
    if (!api?.inputMonitoringStatus) return;
    try {
      setStatus(await api.inputMonitoringStatus());
    } catch {
      // An IPC failure is not a reason to nag — stay hidden.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    // The grant happens in System Settings, outside the app: re-read on return.
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    const timer = setInterval(() => void refresh(), RECHECK_MS);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(timer);
    };
  }, [enabled, refresh]);

  if (!enabled || dismissed || !status?.supported) return null;
  const needsGrant = status.status !== 'granted';
  if (!needsGrant && !status.needsRestart) return null;

  const clockedOut = displayState === 'clocked-out';
  const api = window.electronAPI?.permissions;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Private storage blocked — dismiss for this render tree only.
    }
    setDismissed(true);
  };

  const act = async () => {
    setBusy(true);
    try {
      if (needsGrant) await api?.requestInputMonitoring?.();
      else if (clockedOut) await api?.relaunchApp?.();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const title = needsGrant ? 'Allow Input Monitoring for Bluu' : 'Restart Bluu to finish';
  const description = needsGrant
    ? status.status === 'not-determined'
      ? 'Time tracking checks your typing rhythm — when keys are pressed and what kind of key, never what you type. macOS will ask once.'
      : 'Time tracking checks your typing rhythm — when keys are pressed and what kind of key, never what you type. Turn on Bluu Backend under Privacy & Security → Input Monitoring.'
    : clockedOut
      ? 'Input Monitoring is allowed. macOS applies it after Bluu restarts — this takes a few seconds.'
      : 'Input Monitoring is allowed. macOS applies it after Bluu restarts — you can restart once you have clocked out.';
  const action = needsGrant ? (status.status === 'not-determined' ? 'Allow' : 'Open System Settings') : 'Restart Bluu';

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="input-monitoring-title"
      aria-describedby="input-monitoring-desc"
      className="fixed top-[4.5rem] right-4 z-[var(--z-banner)] w-[min(24rem,calc(100vw-2rem))] animate-in fade-in slide-in-from-top-2 rounded-xl border border-[#2a2a2a] bg-[#171717] p-4 duration-[120ms]"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-zinc-300" aria-hidden>
          <IconKeyboard className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="input-monitoring-title" className="text-sm font-semibold text-white">{title}</h2>
          <p id="input-monitoring-desc" className="mt-1 text-xs leading-relaxed text-zinc-400">{description}</p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="-mt-1 -mr-1 grid size-7 shrink-0 place-items-center rounded-md text-zinc-400 transition-colors hover:bg-white/[0.055] hover:text-white focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <IconX className="size-4" />
        </button>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={dismiss} className="text-zinc-400 hover:text-white">
          Not now
        </Button>
        {(needsGrant || clockedOut) && (
          <Button size="sm" disabled={busy} onClick={() => void act()}>
            {busy && <Loader2Icon className="activity-spinner size-3.5 animate-spin" />}
            {action}
          </Button>
        )}
      </div>
    </div>
  );
}
