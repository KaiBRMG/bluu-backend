"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Focus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import OnboardingCard from '../../_components/OnboardingCard';
import {
  claimOnboardingTccReset,
  hasPromptedScreenCapture,
  markScreenCapturePrompted,
} from '../../resume';

export default function ScreenPermissionPage() {
  const router = useRouter();
  const [platform, setPlatform] = useState<string>('');
  const [prompted, setPrompted] = useState(false);

  useEffect(() => {
    const init = async () => {
      if (typeof window !== 'undefined' && window.electronAPI?.app) {
        const p = await window.electronAPI.app.getPlatform();
        setPlatform(p);

        // Coming back to this step after a relaunch (macOS's "Quit & Reopen"
        // once Screen Recording is granted) must not re-lock Next: the prompt
        // already ran on this machine.
        if (hasPromptedScreenCapture()) setPrompted(true);

        // TEMPORARY (see CLAUDE.md): on macOS, clear any stale ScreenCapture TCC
        // record (left by pre-signing builds) BEFORE the user grants in this
        // step, so the permission they set registers against the signed identity
        // and actually sticks. No-op on a clean machine. Feature-detected.
        //
        // ONCE PER MACHINE, claimed in localStorage before it runs. The native
        // handler has no marker, so this used to fire on every mount — and the
        // relaunch after granting lands the user right back here, where the
        // reset wiped the grant they had just made (the app vanished from the
        // Screen Recording list and Next re-locked: an endless loop).
        if (p === 'darwin' && claimOnboardingTccReset()) {
          window.electronAPI.permissions?.resetScreenCapture?.().catch(() => {});
        }
      }
    };
    init();
  }, []);

  const handleRequestAccess = async () => {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        // On macOS, trigger an actual capture first: this fires the native "would
        // like to record" prompt AND registers the app in the Screen Recording
        // list (an app only appears there once it has attempted a capture). That
        // matters especially right after the onboarding TCC reset above, which
        // clears the record. Older pre-signing builds just opened System Settings
        // because an unsigned app couldn't hold a durable grant anyway.
        if (platform === 'darwin') {
          await window.electronAPI.timeTracking?.captureScreenshot?.();
        }
        await window.electronAPI.permissions?.requestScreenAccess?.();
      }
    } catch (err) {
      // Expected on macOS: the capture above is *meant* to fail before the grant
      // exists — that failure is what raises the prompt. Never block on it, or
      // the user is stranded on a disabled button with nothing explaining why.
      console.warn('[ScreenPermissionPage] Permission prompt failed (continuing):', err);
    } finally {
      markScreenCapturePrompted();
      setPrompted(true);
    }
  };

  const goNext = () => router.push('/onboarding/permission/notifications');

  const isMac = platform === 'darwin';

  const instructions = isMac
    ? 'Click the button below, or open System Settings → Privacy & Security → Screen Recording → enable it for Bluu Backend. You may need to restart the app after granting it.'
    : 'Allow screen recording when the system prompt appears.';

  return (
    <OnboardingCard step={2}>
      <div className="flex items-center gap-2.5">
        <Focus className="shrink-0 text-zinc-400" size={18} aria-hidden="true" />
        <h1 className="text-lg font-semibold text-white">Screen capturing</h1>
      </div>

      <p className="mt-3 max-w-[65ch] text-sm leading-relaxed text-zinc-400">{instructions}</p>

      <Button
        variant="secondary"
        onClick={handleRequestAccess}
        className="mt-6 w-full"
      >
        Prompt screen capture
      </Button>

      <p className="mt-2.5 text-xs text-zinc-400" aria-live="polite">
        {prompted
          ? 'Once you have enabled it, continue.'
          : 'Prompt for access to continue.'}
      </p>

      <div className="mt-6 flex gap-3">
        <Button
          variant="ghost"
          onClick={() => router.push('/onboarding/permissions')}
          className="text-zinc-400"
        >
          Back
        </Button>
        <Button onClick={goNext} disabled={!prompted} className="flex-1">
          Next
        </Button>
      </div>

      {/* Escape hatch: the grant is never verified anyway, and a machine where
          the prompt misbehaves must not strand the user on a locked Next. */}
      <Button
        variant="link"
        size="xs"
        onClick={goNext}
        className="mx-auto mt-4 h-auto p-0 text-xs font-normal text-zinc-400 hover:text-zinc-200"
      >
        Having issues?
      </Button>
    </OnboardingCard>
  );
}
