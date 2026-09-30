'use client';

import { useState } from 'react';
import { CircleCheck, CircleX, Loader2, Radar } from 'lucide-react';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { GoLoginProxyCheckResult, GoLoginProxyMode } from '@/lib/gologin/types';
import { FIELD, LABEL, SEGMENT_ITEM } from '../_lib/manage';

/**
 * A proxy as it is being typed. `port` stays a string until submission so a
 * half-typed value is not coerced to 0 under the cursor.
 */
export interface ProxyDraft {
  enabled: boolean;
  mode: GoLoginProxyMode;
  host: string;
  port: string;
  username: string;
  password: string;
  /**
   * Edit only: a password is stored on the profile and the manager has not typed
   * a new one. The stored secret never reaches this window, so "keep it" is a
   * flag rather than a value.
   */
  keepPassword: boolean;
}

export const EMPTY_PROXY: ProxyDraft = {
  enabled: true,
  mode: 'http',
  host: '',
  port: '',
  username: '',
  password: '',
  keepPassword: false,
};

/** The body a route expects, or null when the proxy is off. */
export function proxyPayload(draft: ProxyDraft) {
  if (!draft.enabled) return null;
  return {
    mode: draft.mode,
    host: draft.host.trim(),
    port: Number(draft.port),
    username: draft.username.trim(),
    // Omitted means "keep the stored password" — see `GoLoginProxyInput`.
    ...(draft.keepPassword ? {} : { password: draft.password }),
  };
}

/** The fields are filled in enough to test. */
export function proxyComplete(draft: ProxyDraft): boolean {
  const port = Number(draft.port);
  return !!draft.host.trim() && Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * The fingerprint a check result belongs to. A result is only shown — and only
 * counts as "tested" — while the fields still say what was tested; editing any
 * of them silently invalidates it rather than leaving a green tick beside a
 * proxy nobody has checked.
 */
export function proxyKey(draft: ProxyDraft): string {
  return [draft.mode, draft.host.trim(), draft.port, draft.username.trim(), draft.keepPassword ? '(kept)' : draft.password].join('\u0000');
}

export interface ProxyCheckState {
  key: string;
  result: GoLoginProxyCheckResult;
}

/** `host:port:user:pass` — the line most proxy providers hand out. */
const PROVIDER_LINE = /^([^\s:]+):(\d{1,5})(?::([^:\s]*))?(?::(\S*))?$/;

/**
 * The proxy half of New Profile and Edit Profile, with its own **Ping**.
 *
 * Pinging is not decoration: a dead or mis-typed proxy is the most common
 * reason a profile fails to launch, and a proxy in the wrong country is worse —
 * it launches fine and the account behind it gets flagged for "logging in from
 * somewhere new". So the result names the exit IP, **country, city and
 * timezone**, which is the fact a manager actually needs to confirm, and the
 * parent requires a passing check for the fields as they now stand before it
 * enables Create or Save.
 */
export default function ProxyFields({
  draft,
  onChange,
  check,
  onCheck,
  profileId,
  allowNone = true,
}: {
  draft: ProxyDraft;
  onChange: (next: ProxyDraft) => void;
  check: ProxyCheckState | null;
  onCheck: (state: ProxyCheckState) => void;
  /** Edit only — lets the server fill a kept password in for the ping. */
  profileId?: string;
  allowNone?: boolean;
}) {
  const authFetch = useAuthFetch();
  const [pinging, setPinging] = useState(false);
  const set = (patch: Partial<ProxyDraft>) => onChange({ ...draft, ...patch });

  const key = proxyKey(draft);
  const current = check && check.key === key ? check.result : null;

  const ping = async () => {
    if (!proxyComplete(draft) || pinging) return;
    setPinging(true);
    try {
      const result: GoLoginProxyCheckResult = await authFetch('/api/gologin/manage/proxy-check', {
        method: 'POST',
        body: JSON.stringify({ proxy: proxyPayload(draft), profileId }),
      });
      onCheck({ key, result });
    } catch (err) {
      onCheck({
        key,
        result: { ok: false, error: err instanceof Error ? err.message : 'Could not run the check.', latencyMs: 0 },
      });
    } finally {
      setPinging(false);
    }
  };

  /**
   * Paste `host:port:user:pass` into the IP field and it fills all four. It is
   * the format providers sell proxies in, and retyping four fields from one line
   * is where a transposed digit comes from.
   */
  const onHostPaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text').trim();
    const match = PROVIDER_LINE.exec(text);
    if (!match) return;
    event.preventDefault();
    set({
      host: match[1],
      port: match[2],
      username: match[3] ?? draft.username,
      password: match[4] ?? draft.password,
      keepPassword: match[4] !== undefined ? false : draft.keepPassword,
    });
  };

  return (
    <div className="space-y-3">
      {allowNone && (
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={draft.enabled ? 'proxy' : 'none'}
          onValueChange={(value) => value && set({ enabled: value === 'proxy' })}
          aria-label="Connection"
        >
          <ToggleGroupItem value="proxy" className={SEGMENT_ITEM}>
            Through a proxy
          </ToggleGroupItem>
          <ToggleGroupItem value="none" className={SEGMENT_ITEM}>
            Without proxy
          </ToggleGroupItem>
        </ToggleGroup>
      )}

      {!draft.enabled ? (
        // Said, because it is the one choice here that exposes something: with
        // no proxy the site sees the IP of whichever desk launches it.
        <p className="max-w-[62ch] text-[11px] text-zinc-400">
          The profile will connect from the IP of whichever computer launches it. Only choose this
          for a profile that holds no account tied to a location.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-[auto_minmax(0,1fr)_7rem] items-end gap-2">
            <div>
              <span className={LABEL} id="proxy-protocol">Protocol</span>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={draft.mode}
                onValueChange={(value) => value && set({ mode: value as GoLoginProxyMode })}
                aria-labelledby="proxy-protocol"
                className="h-9"
              >
                <ToggleGroupItem value="http" className={`h-9 ${SEGMENT_ITEM}`}>
                  HTTP
                </ToggleGroupItem>
                <ToggleGroupItem value="socks5" className={`h-9 ${SEGMENT_ITEM}`}>
                  SOCKS5
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            <label className="block">
              <span className={LABEL}>IP address or host</span>
              <Input
                value={draft.host}
                onChange={(e) => set({ host: e.target.value })}
                onPaste={onHostPaste}
                placeholder="203.0.113.7"
                autoComplete="off"
                spellCheck={false}
                className={`h-9 font-mono ${FIELD}`}
              />
            </label>
            <label className="block">
              <span className={LABEL}>Port</span>
              <Input
                value={draft.port}
                onChange={(e) => set({ port: e.target.value.replace(/\D/g, '').slice(0, 5) })}
                inputMode="numeric"
                placeholder="8080"
                autoComplete="off"
                className={`h-9 font-mono tabular-nums ${FIELD}`}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={LABEL}>Username</span>
              <Input
                value={draft.username}
                onChange={(e) => set({ username: e.target.value })}
                autoComplete="off"
                spellCheck={false}
                className={`h-9 font-mono ${FIELD}`}
              />
            </label>
            <label className="block">
              <span className={LABEL}>Password</span>
              <Input
                // `password` because this window is routinely on a shared screen.
                type="password"
                value={draft.keepPassword ? '' : draft.password}
                onChange={(e) => set({ password: e.target.value, keepPassword: false })}
                placeholder={draft.keepPassword ? 'Unchanged' : ''}
                autoComplete="new-password"
                className={`h-9 font-mono ${FIELD}`}
              />
            </label>
          </div>
          <p className="text-[11px] text-zinc-400">
            Tip: paste a <span className="font-mono">host:port:user:pass</span> line into the IP field
            to fill all four.
          </p>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={ping}
              disabled={!proxyComplete(draft) || pinging}
            >
              {pinging ? (
                <Loader2 className="activity-spinner size-3.5 animate-spin" aria-hidden />
              ) : (
                <Radar className="size-3.5" aria-hidden />
              )}
              Ping proxy
            </Button>
            <div role="status" aria-live="polite" className="min-w-0 flex-1 text-[11px]">
              {pinging ? (
                <span className="text-zinc-400">Connecting through the proxy…</span>
              ) : current ? (
                current.ok ? (
                  <span className="flex flex-wrap items-center gap-x-1.5 text-green-400">
                    <CircleCheck className="size-3.5 shrink-0" aria-hidden />
                    <span className="font-medium">Working</span>
                    <span aria-hidden>·</span>
                    <span className="font-mono">{current.ip}</span>
                    {(current.city || current.country) && (
                      <>
                        <span aria-hidden>·</span>
                        <span>{[current.city, current.country].filter(Boolean).join(', ')}</span>
                      </>
                    )}
                    {current.timezone && (
                      <>
                        <span aria-hidden>·</span>
                        <span>{current.timezone}</span>
                      </>
                    )}
                    <span aria-hidden>·</span>
                    <span className="tabular-nums">{current.latencyMs} ms</span>
                  </span>
                ) : (
                  <span className="flex items-start gap-1.5 text-red-400">
                    <CircleX className="mt-px size-3.5 shrink-0" aria-hidden />
                    <span>{current.error}</span>
                  </span>
                )
              ) : (
                <span className="text-zinc-400">
                  {proxyComplete(draft) ? 'Not checked yet.' : 'Enter the IP and port to check it.'}
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
