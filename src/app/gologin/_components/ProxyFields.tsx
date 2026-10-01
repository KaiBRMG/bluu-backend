'use client';

import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { GoLoginProxyMode } from '@/lib/gologin/types';
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

/** The IP and port are filled in enough to save. */
export function proxyComplete(draft: ProxyDraft): boolean {
  const port = Number(draft.port);
  return !!draft.host.trim() && Number.isInteger(port) && port >= 1 && port <= 65535;
}

/** Everything that identifies a proxy draft — two drafts with one key are the same proxy. */
export function proxyKey(draft: ProxyDraft): string {
  return [draft.mode, draft.host.trim(), draft.port, draft.username.trim(), draft.keepPassword ? '(kept)' : draft.password].join('\u0000');
}

/** `host:port:user:pass` — the line most proxy providers hand out. */
const PROVIDER_LINE = /^([^\s:]+):(\d{1,5})(?::([^:\s]*))?(?::(\S*))?$/;

/**
 * The proxy half of New Profile and Edit Profile.
 *
 * There is **no "Ping proxy"** (removed 2026-09-30). It tested the proxy from
 * Bluu's server, and the team's proxies are private — they only admit the
 * operators' own connections — so it failed on working proxies and could not be
 * made to pass. The real test is the one GoLogin's SDK runs at launch, and a
 * failure there is reported on the row as a proxy failure (see page.tsx).
 */
export default function ProxyFields({
  draft,
  onChange,
  allowNone = true,
}: {
  draft: ProxyDraft;
  onChange: (next: ProxyDraft) => void;
  allowNone?: boolean;
}) {
  const set = (patch: Partial<ProxyDraft>) => onChange({ ...draft, ...patch });
  // Per-instance, so two forms on screen never share a label id.
  const protocolId = useId();

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
              <span className={LABEL} id={protocolId}>Protocol</span>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={draft.mode}
                onValueChange={(value) => value && set({ mode: value as GoLoginProxyMode })}
                aria-labelledby={protocolId}
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
            to fill all four. The proxy is tested when the profile is first launched.
          </p>
        </>
      )}
    </div>
  );
}
