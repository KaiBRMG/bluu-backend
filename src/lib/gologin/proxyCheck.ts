/**
 * "Ping proxy" — does this proxy work, and where does it come out?
 *
 * **GoLogin has no endpoint for this.** What it does have is the check its own
 * SDK runs before every launch (`getTimeZone` in `gologin.js`): a `GET` to
 * `https://geo.myip.link` *through* the proxy, whose JSON answer names the exit
 * IP, country, city and timezone. This is that check, run from the server, so the
 * result a manager sees is the same test the operator's launch will later pass
 * or fail — and a dead proxy is the most common launch failure there is (see
 * gologin.md § the Proxy Error chip).
 *
 * Server-side by decision (2026-09-30), not from the operator's machine: it ships
 * as a plain deploy with no Electron build. The one thing that costs is a proxy
 * that only admits whitelisted source IPs, which will fail here and still work
 * from a desk — the error copy says so.
 *
 * ## This is an outbound connection to an address a user typed
 *
 * That makes it an SSRF primitive unless it is fenced, so:
 *
 *   • The host is **resolved here first**, and every address it resolves to must
 *     be public. Loopback, RFC 1918, link-local (which includes the cloud metadata
 *     address 169.254.169.254), CGNAT, multicast and their IPv6 equivalents are
 *     refused. *Every* record must pass, not just the first — a name that
 *     resolves to one public and one private address is the rebinding trick.
 *   • The agent then connects to the **resolved IP**, never the name, so a second
 *     resolution cannot hand it a different answer between the check and the use.
 *   • The only URL fetched is the fixed `CHECK_URL`. The proxy is the variable;
 *     the destination is not.
 *   • The body is capped and the whole attempt is bounded by a timeout.
 *
 * Nothing here touches the GoLogin API, so it costs no request budget.
 */
import 'server-only';
import { lookup } from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import type { GoLoginProxyCheckResult, GoLoginProxyInput } from './types';

/** The endpoint GoLogin's SDK checks proxies against. Fixed — never user input. */
const CHECK_URL = 'https://geo.myip.link';

/** Long enough for a slow residential exit, short enough to sit through. */
const TIMEOUT_MS = 12_000;

/** The answer is a few hundred bytes; anything past this is not that answer. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Addresses a proxy may not resolve to. `net.BlockList` rather than hand-rolled
 * prefix maths, because a subnet check done with string comparisons is exactly
 * where these fences usually leak.
 */
const BLOCKED = (() => {
  const list = new net.BlockList();
  const v4: [string, number][] = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10], // CGNAT
    ['127.0.0.0', 8],
    ['169.254.0.0', 16], // link-local, incl. cloud metadata
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4], // multicast
    ['240.0.0.0', 4], // reserved + broadcast
  ];
  for (const [address, prefix] of v4) list.addSubnet(address, prefix, 'ipv4');
  const v6: [string, number][] = [
    ['::', 128],
    ['::1', 128],
    ['::ffff:0:0', 96], // IPv4-mapped — re-checked as IPv4 below
    ['64:ff9b::', 96], // NAT64
    ['fc00::', 7], // unique local
    ['fe80::', 10], // link-local
    ['ff00::', 8], // multicast
    ['2001:db8::', 32], // documentation
  ];
  for (const [address, prefix] of v6) list.addSubnet(address, prefix, 'ipv6');
  return list;
})();

function isPublicAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return !BLOCKED.check(ip, 'ipv4');
  if (family === 6) {
    // `::ffff:10.0.0.1` is 10.0.0.1 wearing an IPv6 costume.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped) return !BLOCKED.check(mapped[1], 'ipv4');
    return !BLOCKED.check(ip, 'ipv6');
  }
  return false;
}

/** A refusal with a sentence the manager can act on. */
class ProxyCheckError extends Error {}

async function resolvePublic(host: string): Promise<string> {
  let addresses: string[];
  try {
    addresses = net.isIP(host)
      ? [host]
      : (await lookup(host, { all: true, verbatim: true })).map((r) => r.address);
  } catch {
    throw new ProxyCheckError('That host name does not resolve. Check it for typos.');
  }
  if (!addresses.length) throw new ProxyCheckError('That host name does not resolve.');
  if (!addresses.every(isPublicAddress)) {
    throw new ProxyCheckError('That address is on a private or reserved network, which a proxy cannot be.');
  }
  return addresses[0];
}

function buildAgent(proxy: GoLoginProxyInput & { password: string }, ip: string) {
  const auth = proxy.username
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`
    : '';
  const hostPart = net.isIP(ip) === 6 ? `[${ip}]` : ip;
  if (proxy.mode === 'socks5') {
    // `socks5h`: the *proxy* resolves the check host, as it will for every site
    // the browser visits — so this exercises the same path a launch does.
    return new SocksProxyAgent(`socks5h://${auth}${hostPart}:${proxy.port}`, { timeout: TIMEOUT_MS });
  }
  return new HttpsProxyAgent(`http://${auth}${hostPart}:${proxy.port}`, { timeout: TIMEOUT_MS });
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Turn a socket-level failure into something a manager can act on. */
function describeFailure(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  const message = err instanceof Error ? err.message : '';
  if (code === 'ECONNREFUSED') return 'Nothing is accepting connections at that IP and port.';
  if (code === 'ECONNRESET') return 'The proxy closed the connection. Check the protocol (HTTP vs SOCKS5).';
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'That IP address cannot be reached.';
  if (code === 'ETIMEDOUT' || /timed? ?out/i.test(message)) {
    return `The proxy did not answer within ${TIMEOUT_MS / 1000}s. If it only admits whitelisted IPs, it will fail here but may still work from a desk.`;
  }
  if (/authentication/i.test(message)) return 'The proxy rejected the username or password.';
  if (/socks/i.test(message)) return 'The SOCKS handshake failed. Check the protocol, username and password.';
  if (/ssl|tls|certificate|EPROTO/i.test(`${code} ${message}`)) {
    return 'The connection through the proxy failed. Check the protocol (HTTP vs SOCKS5).';
  }
  return 'The proxy could not be reached.';
}

function fetchThrough(agent: https.Agent): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      CHECK_URL,
      { agent, timeout: TIMEOUT_MS, headers: { Accept: 'application/json' } },
      (res) => {
        let size = 0;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            req.destroy(new Error('Response too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
  });
}

/**
 * Test one proxy. Never throws — every outcome is a result, because the caller
 * renders it in place beside the fields it describes.
 */
export async function checkProxy(
  proxy: GoLoginProxyInput & { password: string },
): Promise<GoLoginProxyCheckResult> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  try {
    const ip = await resolvePublic(proxy.host);
    const { status, body } = await fetchThrough(buildAgent(proxy, ip) as unknown as https.Agent);

    // A refused CONNECT reaches us as the response itself (https-proxy-agent
    // replays the proxy's status onto the request rather than throwing).
    if (status === 407) {
      return { ok: false, error: 'The proxy rejected the username or password.', latencyMs: elapsed() };
    }
    if (status < 200 || status >= 300) {
      return { ok: false, error: `The proxy answered with HTTP ${status}.`, latencyMs: elapsed() };
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(body) as Record<string, unknown>;
    } catch {
      return {
        ok: false,
        error: 'The proxy connected but returned something unexpected — it may be intercepting traffic.',
        latencyMs: elapsed(),
      };
    }
    const exitIp = str(data.ip);
    if (!exitIp) {
      return { ok: false, error: 'The proxy connected but no exit IP was reported.', latencyMs: elapsed() };
    }
    return {
      ok: true,
      ip: exitIp,
      country: str(data.country) || str(data.countryName) || str(data.country_code),
      city: str(data.city),
      timezone: str(data.timezone),
      latencyMs: elapsed(),
    };
  } catch (err) {
    if (err instanceof ProxyCheckError) return { ok: false, error: err.message, latencyMs: elapsed() };
    console.warn('[gologin] proxy check failed', (err as { code?: string })?.code ?? err);
    return { ok: false, error: describeFailure(err), latencyMs: elapsed() };
  }
}
