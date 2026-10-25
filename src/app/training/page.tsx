'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { api, ApiError } from './_lib/api';
import { AZURE, AZURE_INK, FIELD } from './_lib/theme';
import { Shell } from './_components/Shell';

const RESEND_COOLDOWN_S = 45;

/**
 * `/training` — the gate. An email address, then the 6-digit code we send it.
 *
 * What is promised is only what is true: training is by invitation, an admin
 * adds people, and nothing says whether a given address was added — the code
 * step reads the same either way, so the page is not an oracle for who is on a
 * list. A visitor who already holds a valid cookie skips straight to Home.
 */
export default function TrainingGatePage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState(''); // honeypot — real people never see it
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  // Set on mount, never during render: a time read at render is frozen into the prerender.
  const mountedAt = useRef(0);

  useEffect(() => {
    mountedAt.current = Date.now();
    let live = true;
    api('/api/training/me')
      .then(() => live && router.replace('/training/home'))
      .catch(() => live && setChecking(false));
    return () => {
      live = false;
    };
  }, [router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/training/request-code', {
        method: 'POST',
        body: { email, website, elapsedMs: Date.now() - mountedAt.current },
      });
      setStep('code');
      setCode('');
      setCooldown(RESEND_COOLDOWN_S);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/training/verify-code', { method: 'POST', body: { email, code } });
      router.replace('/training/home');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  if (checking) return <Shell width="narrow">{null}</Shell>;

  return (
    <Shell width="narrow">
      <div className="flex flex-1 flex-col justify-center pb-16">
        {step === 'email' ? (
          <form onSubmit={sendCode} noValidate className="flex flex-col gap-6">
            <div>
              <h1 className="text-[2rem] leading-tight font-semibold text-balance sm:text-[2.5rem]">
                Bluu Rock Training
              </h1>
              <p className="mt-3 text-base leading-relaxed text-white/75">
                Training is by invitation. Only people an admin has approved can continue, and approval is what grants
                access. Enter the email address you were approved with and we will send you a code.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="training-email" className="text-sm font-medium text-white">
                Email
              </Label>
              <input
                id="training-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!error}
                aria-describedby={error ? 'training-email-error' : undefined}
                className={FIELD}
              />
              {/* Honeypot: off-screen, unfocusable, unlabelled for assistive tech. */}
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                className="pointer-events-none absolute -left-[9999px] h-0 w-0 opacity-0"
              />
              {error && (
                <p id="training-email-error" role="alert" className="text-sm text-red-300">
                  {error}
                </p>
              )}
            </div>

            <Button
              type="submit"
              size="lg"
              disabled={busy || !email.trim()}
              className="h-12 self-start px-6 text-base font-semibold"
              style={{ backgroundColor: AZURE, color: AZURE_INK }}
            >
              {busy ? 'Sending…' : 'Continue'}
            </Button>
          </form>
        ) : (
          <form onSubmit={submitCode} noValidate className="flex flex-col gap-6">
            <div>
              <h1 className="text-[2rem] leading-tight font-semibold text-balance sm:text-[2.5rem]">Check your email</h1>
              <p className="mt-3 text-base leading-relaxed text-white/75">
                If <span className="break-all text-white">{email.trim()}</span> has been approved, we have sent it a
                6-digit code. It can take a minute to arrive.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="training-code" className="text-sm font-medium text-white">
                Code
              </Label>
              <input
                id="training-code"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                aria-invalid={!!error}
                aria-describedby={error ? 'training-code-error' : undefined}
                className={`${FIELD} text-center text-2xl font-semibold tracking-[0.45em] tabular-nums`}
              />
              {error && (
                <p id="training-code-error" role="alert" className="text-sm text-red-300">
                  {error}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <Button
                type="submit"
                size="lg"
                disabled={busy || code.length !== 6}
                className="h-12 px-6 text-base font-semibold"
                style={{ backgroundColor: AZURE, color: AZURE_INK }}
              >
                {busy ? 'Checking…' : 'Sign in'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="lg"
                disabled={busy || cooldown > 0}
                onClick={() => sendCode()}
                className="h-12 px-3 text-base text-white/80 hover:text-white"
              >
                {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="lg"
                disabled={busy}
                onClick={() => {
                  setStep('email');
                  setError('');
                }}
                className="h-12 px-3 text-base text-white/80 hover:text-white"
              >
                Use a different email
              </Button>
            </div>
          </form>
        )}
      </div>
    </Shell>
  );
}
