"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Focus } from 'lucide-react';

export default function ScreenPermissionPage() {
  const router = useRouter();
  const [platform, setPlatform] = useState<string>('');
  const [prompted, setPrompted] = useState(false);

  useEffect(() => {
    const init = async () => {
      if (typeof window !== 'undefined' && window.electronAPI?.app) {
        const p = await window.electronAPI.app.getPlatform();
        setPlatform(p);

        // TEMPORARY (see CLAUDE.md): on macOS, clear any stale ScreenCapture TCC
        // record (left by pre-signing builds) BEFORE the user grants in this
        // step, so the permission they set registers against the signed identity
        // and actually sticks. No-op on a clean machine; the native handler caps
        // it to once per machine. Feature-detected — no-op on older builds.
        if (p === 'darwin') {
          window.electronAPI.permissions?.resetScreenCapture?.().catch(() => {});
        }
      }
    };
    init();
  }, []);

  const handleRequestAccess = async () => {
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
    setPrompted(true);
  };

  const isMac = platform === 'darwin';

  const instructions = isMac
    ? "Click the button below, or open System Settings → Privacy & Security → Screen Recording → Enable for Bluu Backend. Then click \"I've enabled it\" below. Note, you may need to restart the app after giving the permission."
    : "Allow screen recording when the system prompt appears. Then click \"I've enabled it\" below.";

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-12 max-w-lg w-full">
      <div className="flex items-center gap-3 mb-6">
        <Focus className="text-white shrink-0" size={24} />
        <h1 className="text-xl font-semibold text-white">Screen Capturing</h1>
      </div>

      <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4 mb-6">
        <p className="text-zinc-300 text-sm leading-relaxed">{instructions}</p>
      </div>

      <button
        onClick={handleRequestAccess}
        className="w-full bg-zinc-700 text-white font-semibold py-3 px-6 rounded-lg hover:bg-zinc-600 transition-colors mb-3"
      >
        Prompt Screen Capture
      </button>

      <button
        onClick={() => router.push('/onboarding/permission/notifications')}
        disabled={!prompted}
        className="w-full bg-white text-black font-semibold py-3 px-6 rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        I&apos;ve enabled it
      </button>
    </div>
  );
}
