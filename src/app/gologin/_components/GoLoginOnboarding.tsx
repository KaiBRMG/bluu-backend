'use client';

import { useState } from 'react';
import { Check, ExternalLink, Loader2, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import type { GoLoginOrbitaState } from '@/types/electron';

const SIGN_IN_URL = 'https://app.gologin.com/sign_in';

/**
 * First run: the three things an operator must do before this window has
 * anything to show them.
 *
 * **Nothing else renders until all three are done.** Not a dismissible banner and
 * not a partial list behind a notice — without a personal GoLogin account there
 * are literally no profiles to display, so a list underneath would be an empty
 * state that lies about why it is empty.
 *
 * The steps are shown **all at once, not one at a time.** Step 1 is a long
 * background download and steps 2–3 happen in another application, so a wizard
 * revealing one card at a time would serialise things that are naturally
 * parallel and add several minutes to every new operator's first day.
 *
 * **There is deliberately no link to GoLogin's token page.** Deep-linking
 * `/personalArea/TokenApi` does not work — GoLogin redirects to its dashboard —
 * so a button there would land the operator somewhere that looks wrong and
 * silently blame them for it. The route is described in words instead, and it
 * lives in step 2 rather than step 3: that is the step where they are actually
 * standing inside GoLogin's UI, having just signed in. Step 3 is then only
 * "paste it here", which is the one thing that happens back in this window.
 *
 * The sign-in link goes through `window.open`, which the Electron shell routes to
 * `shell.openExternal` (`setWindowOpenHandler`). GoLogin's own site must not open
 * inside a Bluu window: the operator needs their password manager, and the
 * shell's `will-navigate` guard would bounce it out anyway.
 */
export default function GoLoginOnboarding({
  orbita,
  orbitaSupported,
  orbitaInstalled,
  glEmail,
  joined,
  onDownloadOrbita,
  onSubmitKey,
  onRecheck,
}: {
  orbita: GoLoginOrbitaState;
  orbitaSupported: boolean;
  orbitaInstalled: boolean;
  /** The address the admin granted the seat to. The token must belong to it. */
  glEmail: string;
  /** False while GoLogin's invitation email is unaccepted. */
  joined: boolean;
  onDownloadOrbita: () => void;
  onSubmitKey: (apiKey: string) => Promise<string | null>;
  /**
   * Re-read the seat from the server.
   *
   * Step 2 completes in another application entirely — the operator accepts
   * GoLogin's invitation in their inbox. `joined` was read once on mount and
   * never again, so coming back to this window left the step unticked with
   * nothing on screen to do about it, and the documented remedy was to close and
   * reopen the window. One cheap request replaces that.
   */
  onRecheck: () => Promise<void> | void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const recheck = async () => {
    if (checking) return;
    setChecking(true);
    try {
      await onRecheck();
    } finally {
      setChecking(false);
    }
  };

  const downloading = orbita.phase === 'downloading' || orbita.phase === 'installing';
  const orbitaReady = orbitaInstalled || orbita.phase === 'ready';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const key = apiKey.trim();
    if (!key || saving) return;
    setSaving(true);
    setError(null);
    const message = await onSubmitKey(key);
    if (message) {
      setError(message);
      setSaving(false);
      return;
    }
    // Cleared on success so the key is not left sitting in a form field — and
    // never put into component state anywhere else.
    setApiKey('');
    setSaving(false);
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-2xl px-8 py-12">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-zinc-400">
          GoLogin
        </h2>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">Set up your account</h1>

        <div className="mt-8 space-y-3">
          <Step index={1} title="Install the Orbita browser" done={orbitaReady}>
            <p className="text-[11px] text-zinc-400">GoLogin requires Orbita to work.</p>

            <div className="mt-3">
              {!orbitaSupported ? (
                <p className="text-[11px] text-zinc-400">
                  This version of the desktop app cannot install Orbita. Update Bluu, then reopen
                  this window.
                </p>
              ) : orbitaReady ? (
                <p className="text-[11px] text-zinc-400">Installed and ready.</p>
              ) : downloading ? (
                <div className="max-w-sm">
                  <Progress
                    value={
                      orbita.totalBytes > 0
                        ? Math.min(100, (orbita.receivedBytes / orbita.totalBytes) * 100)
                        : 0
                    }
                    className="bg-white/[0.08] [&>[data-slot=progress-indicator]]:bg-[#2563eb]"
                  />
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11px] tabular-nums text-zinc-400">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    {orbita.phase === 'installing'
                      ? 'Installing…'
                      : orbita.totalBytes > 0
                        ? `${mb(orbita.receivedBytes)} of ${mb(orbita.totalBytes)} MB`
                        : `${mb(orbita.receivedBytes)} MB downloaded`}
                  </p>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    size="sm"
                    className="bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
                    onClick={onDownloadOrbita}
                  >
                    Download
                  </Button>
                  {orbita.phase === 'failed' && (
                    <span className="text-[11px] text-red-400">
                      {orbita.error || 'The download failed. Try again.'}
                    </span>
                  )}
                </div>
              )}
            </div>
          </Step>

          <Step index={2} title="Sign into GoLogin" done={joined}>
            <p className="max-w-[62ch] text-[11px] text-zinc-400">
              You have been added to the workspace as{' '}
              <span className="font-mono text-white">{glEmail || 'your work address'}</span>.
              {joined
                ? ' Sign in with that account.'
                : ' Accept the invitation in your inbox first, then sign in.'}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => window.open(SIGN_IN_URL, '_blank')}>
                Open GoLogin
                <ExternalLink className="size-3.5" aria-hidden />
              </Button>
              {/* The invitation is accepted in a different application, so this
                  step cannot notice on its own. Without a way to ask, the
                  operator's only move was to quit and relaunch the window —
                  which is a workaround, not an instruction. */}
              {!joined && (
                <Button variant="ghost" size="sm" disabled={checking} onClick={recheck}>
                  {checking ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <RefreshCcw className="size-3.5" aria-hidden />
                  )}
                  I&rsquo;ve accepted it
                </Button>
              )}
            </div>

            {/* Stated where it happens rather than in step 3, because this is
                where the reader is standing inside GoLogin's own UI. The
                hairline separates "what to click" from "what to do over there". */}
            {/* The navigation instruction is the whole purpose of this step, so
                it is stated at body weight rather than buried as the first of
                two same-sized bullets. There is deliberately no link (GoLogin
                redirects a deep link to its dashboard — see this file's header),
                which makes the words themselves the only wayfinding there is. */}
            <div className="mt-4 border-t border-white/[0.07] pt-3">
              <p className="max-w-[62ch] text-sm text-zinc-400">
                Once you are signed in, open{' '}
                <strong className="font-semibold text-white">API &amp; MCP</strong> in GoLogin&rsquo;s
                left-hand menu and create a new API token.
              </p>
              <ul className="mt-2 space-y-1.5">
                <Note>
                  Sign in with the address above. A token from any other account will be
                  rejected — it would be scoped to the wrong profiles.
                </Note>
              </ul>
            </div>
          </Step>

          <Step index={3} title="Paste your API token">
            <p className="max-w-[62ch] text-[11px] text-zinc-400">
              Bluu uses it to list your profiles and to open them on this machine.
            </p>

            <form onSubmit={submit} className="mt-3 flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  // `password`, not `text`: this is a live credential and the
                  // window is routinely on a shared screen.
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Paste your API token"
                  aria-label="GoLogin API token"
                  aria-invalid={!!error}
                  className="border-zinc-700 bg-zinc-800 font-mono text-xs"
                />
                {error && <p className="mt-1.5 text-[11px] text-red-400">{error}</p>}
              </div>
              <Button
                type="submit"
                size="sm"
                className="shrink-0 bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
                disabled={!apiKey.trim() || saving}
              >
                {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                {saving ? 'Checking' : 'Save'}
              </Button>
            </form>
          </Step>
        </div>

        <p className="mt-6 max-w-[62ch] text-[11px] text-zinc-400">
          Your token is stored encrypted and is only ever used to open profiles on your own machine.
          It is never shown back to you or to anyone else.
        </p>
      </div>
    </div>
  );
}

function mb(bytes: number): string {
  return (bytes / 1048576).toFixed(1);
}

/**
 * A supporting fact inside a step — something to expect rather than something to
 * do. Marked with a dot rather than a number: these are not sub-steps, and
 * numbering them would imply an order they do not have.
 */
function Note({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-[11px] text-zinc-400">
      {/* `zinc-500`, not `-600`: everything else on this surface clears the 3:1
          floor for a non-text mark and this did not. */}
      <span className="mt-[0.45rem] size-1 shrink-0 rounded-full bg-zinc-500" aria-hidden />
      <span className="max-w-[60ch]">{children}</span>
    </li>
  );
}

/**
 * One step. The number is the ordering device rather than a progress indicator —
 * only step 1 can report completion (the other two are only "done" by this whole
 * screen disappearing), so a "2 of 3" would be claiming knowledge we do not have.
 */
function Step({
  index,
  title,
  done,
  children,
}: {
  index: number;
  title: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-5">
      <div className="flex items-start gap-3">
        <span
          className={`mt-px flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums ${
            done ? 'bg-green-500/15 text-green-400' : 'bg-white/[0.08] text-zinc-400'
          }`}
          aria-hidden
        >
          {done ? <Check className="size-3.5" /> : index}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-white">
            <span className="sr-only">{`Step ${index}: `}</span>
            {title}
          </h3>
          <div className="mt-1">{children}</div>
        </div>
      </div>
    </section>
  );
}
