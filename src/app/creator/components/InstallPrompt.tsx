"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Share, X, SquarePlus } from "lucide-react";
import { SURFACE, ACCENT_BTN } from "../theme";

const DISMISS_KEY = "creator-install-prompt-dismissed";

/** iOS gives no `beforeinstallprompt`, so installing there can only be described.
 *  Detect real iOS Safari — Chrome/Firefox on iOS can't add to the home screen
 *  at all, and telling their users to try would be worse than saying nothing. */
function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as a Mac; the touch points give it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return iOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

function isInstalled(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's non-standard flag — it does not implement display-mode.
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    // Private mode / blocked storage: treat as not dismissed. The banner is
    // dismissible either way, so the worst case is seeing it again next visit.
    return false;
  }
}

/** Whether this browser is one where the only install route is the iOS Share
 *  sheet. Read once — none of its inputs change within a page load — so the
 *  `useSyncExternalStore` snapshot below stays referentially stable. */
let iosEligible: boolean | undefined;
function getIosEligible(): boolean {
  if (iosEligible === undefined) {
    iosEligible = isIosSafari() && !isInstalled() && !wasDismissed();
  }
  return iosEligible;
}
const subscribeNever = () => () => {};

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * A one-line nudge to install the portal to the home screen, shown once per
 * device until dismissed. Two paths, because the platforms differ:
 *
 * - **Android / desktop Chromium** fire `beforeinstallprompt`; we hold it and
 *   replay it behind an Install button (browsers ignore a `prompt()` that isn't
 *   tied to a user gesture).
 * - **iOS Safari** has no such event — the only route is Share → Add to Home
 *   Screen, so there the banner is instructions, not a button.
 *
 * Renders nothing when already installed (`display-mode: standalone`), when the
 * browser can't install, or once dismissed.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // A browser-environment read, not React state: the server snapshot is `false`
  // so nothing renders until hydration, and it never changes after that.
  const iosPath = useSyncExternalStore(subscribeNever, getIosEligible, () => false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Chromium fires this only when the app is installable and not already
      // installed; the dismissal check is ours.
      if (wasDismissed()) return;
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Nothing to do — the banner simply returns next visit.
    }
    setDeferred(null);
    setDismissed(true);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    // The event is single-use whatever the outcome; a declined install should
    // not leave a dead button behind.
    dismiss();
  };

  const showIos = iosPath && !dismissed;
  if (!deferred && !showIos) return null;

  return (
    <div
      className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${SURFACE.panel}`}
      role="region"
      aria-label="Install the Creator Portal"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-zinc-200">Add to your home screen</p>
        {showIos ? (
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs leading-relaxed text-zinc-400">
            Tap <Share className="inline h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden="true" /><span className="sr-only">Share</span>
            then <SquarePlus className="inline h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
            <span className="text-zinc-400">Add to Home Screen</span> — it opens full screen, no address bar.
          </p>
        ) : (
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">
            Opens full screen, no address bar — one tap from your phone.
          </p>
        )}
      </div>

      {deferred && (
        <Button
          size="sm"
          onClick={install}
          className={`h-11 shrink-0 rounded-xl ${ACCENT_BTN}`}
        >
          Install
        </Button>
      )}

      <Button
        variant="ghost"
        size="icon"
        onClick={dismiss}
        aria-label="Dismiss"
        className="relative h-8 w-8 shrink-0 text-zinc-400 hover:bg-white/5 hover:text-zinc-300 after:absolute after:-inset-2 after:content-['']"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
