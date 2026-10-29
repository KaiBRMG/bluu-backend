'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconArrowRight } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { getModule } from '@/lib/training/modules';
import type { MeResponse, ModuleSummary, TestSummary } from '@/lib/training/types';
import { api, ApiError, useServerClock } from '../_lib/api';
import { TERMINAL } from '../_lib/format';
import { AZURE, AZURE_INK, FIELD, PANEL } from '../_lib/theme';
import { Shell } from '../_components/Shell';
import { SignedInAside } from '../_components/SignedInAside';
import { StateChip } from '../_components/StateChip';

/** The test to talk about on a card: the live one, else the open one, else the next to come, else the last. */
function focusTest(module: ModuleSummary): TestSummary {
  return (
    module.tests.find((t) => t.state === 'in-progress') ??
    module.tests.find((t) => t.state === 'open') ??
    module.tests.find((t) => !TERMINAL.has(t.state)) ??
    module.tests[module.tests.length - 1]
  );
}

function NameStep({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/training/name', { method: 'POST', body: { name } });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} noValidate className="flex max-w-md flex-col gap-6 pt-12 sm:pt-20">
      <div>
        <h1 className="text-[2rem] leading-tight font-semibold text-balance sm:text-[2.5rem]">Welcome to training</h1>
        <p className="mt-3 text-base leading-relaxed text-white/75">
          Before you start, tell us your full name. It is how the team will know your work.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="training-name" className="text-sm font-medium text-white">
          Full name
        </Label>
        <input
          id="training-name"
          autoComplete="name"
          required
          autoFocus
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? 'training-name-error' : undefined}
          className={FIELD}
        />
        {error && (
          <p id="training-name-error" role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
      </div>
      <Button
        type="submit"
        size="lg"
        disabled={busy || name.trim().length < 2}
        className="h-12 self-start px-6 text-base font-semibold"
        style={{ backgroundColor: AZURE, color: AZURE_INK }}
      >
        {busy ? 'Saving…' : 'Continue'}
      </Button>
    </form>
  );
}

/**
 * `/training/home` — what is on for this candidate.
 *
 * First visit asks for a name (once, ever). After that: one row per module,
 * the whole row a link, saying in a line what is next. The list is built for
 * more modules than the one that exists today.
 */
export default function TrainingHomePage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState('');
  const { sync } = useServerClock();

  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    api<MeResponse>('/api/training/me')
      .then((data) => {
        if (cancelled) return;
        sync(data.nowMs);
        setMe(data);
        setError('');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace('/training');
          return;
        }
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      });
    return () => {
      cancelled = true;
    };
  }, [router, sync, refreshKey]);

  return (
    <Shell aside={me ? <SignedInAside email={me.email} /> : null}>
      {error ? (
        <div role="alert" className="pt-16">
          <p className="text-base text-red-300">{error}</p>
          <Button variant="outline" className="mt-4 h-11" onClick={reload}>
            Try again
          </Button>
        </div>
      ) : !me ? (
        <div className="pt-16" aria-busy="true">
          <span className="sr-only" role="status">
            Loading…
          </span>
        </div>
      ) : !me.name ? (
        <NameStep onSaved={reload} />
      ) : (
        <div className="pt-12 pb-20 sm:pt-16">
          <h1 className="text-[2rem] leading-tight font-semibold text-balance sm:text-[2.5rem]">
            Hi {me.name.split(' ')[0]}
          </h1>
          <p className="mt-3 text-base text-white/75">Here is what is open to you.</p>

          {me.modules.length === 0 ? (
            <div className={`${PANEL} mt-8 rounded-2xl p-6`}>
              <p className="text-base text-white">Training isn’t running right now.</p>
              <p className="mt-1 text-sm text-white/70">
                The team will switch it on when it is time. If you expected it to be open, check that you signed in with the
                email address you were approved with.
              </p>
            </div>
          ) : (
            <ul className="mt-8 flex flex-col gap-3">
              {me.modules.map((module) => {
                const def = getModule(module.id);
                const test = focusTest(module);
                if (!def || !test) return null;
                return (
                  <li key={module.id}>
                    <Link
                      href={`/training/${def.path}`}
                      prefetch={false}
                      className={`${PANEL} group flex items-center gap-4 rounded-2xl p-5 transition-colors outline-none hover:bg-white/[0.055] focus-visible:ring-2 focus-visible:ring-[#00b8f5]/60`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                          <h2 className="text-xl font-semibold">{def.title}</h2>
                          <StateChip state={test.state} />
                        </div>
                        <p className="mt-1.5 text-sm text-white/70">
                          {test.id} · {test.title}
                        </p>
                      </div>
                      <IconArrowRight
                        className="size-5 shrink-0 text-[#00b8f5] transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Shell>
  );
}
