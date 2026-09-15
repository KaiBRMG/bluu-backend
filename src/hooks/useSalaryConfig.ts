'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getCache, setCache } from '@/lib/queryCache';
import type { SalaryConfig } from '@/lib/salary/salaryTypes';

/**
 * The rate tables, for surfaces that need to *show* a rate without computing a
 * whole month — the shift modal's "pays $3.50/hour" line, mostly.
 *
 * Read over HTTP rather than imported from `salaryConstants`, because a renderer
 * can be weeks old and a compiled-in rate would disagree with what the server
 * actually pays (CLAUDE.md rule 9c). Cached for 5 minutes: it changes a few
 * times a year and every salary surface asks for it.
 *
 * Returns `null` until loaded. Callers should render without the rate rather
 * than block on it — a missing hint is better than a blocked form.
 */

const CACHE_KEY = 'bluu_salary_config_v1';
const TTL_MS = 5 * 60 * 1000;

export function useSalaryConfig(): SalaryConfig | null {
  const { user } = useAuth();

  // Seeded from the cache in the initializer rather than by an effect: a cache
  // hit is available on the first render, so setting it from an effect would
  // paint an empty rate hint and then immediately re-render to fill it in.
  // `getCache` is SSR-safe (it swallows the missing `sessionStorage`).
  const [config, setConfig] = useState<SalaryConfig | null>(() =>
    getCache<SalaryConfig>(CACHE_KEY, TTL_MS),
  );

  useEffect(() => {
    if (!user || config) return;

    let cancelled = false;
    void user
      .getIdToken()
      .then(token => fetch('/api/ca-salary/config', { headers: { Authorization: `Bearer ${token}` } }))
      .then(res => (res.ok ? res.json() : null))
      .then((body: { config: SalaryConfig } | null) => {
        if (cancelled || !body?.config) return;
        setCache(CACHE_KEY, body.config);
        setConfig(body.config);
      })
      .catch(() => {
        /* The rate hint is optional; a failure leaves it absent rather than broken. */
      });

    return () => {
      cancelled = true;
    };
  // `config` is in the deps so a cache hit short-circuits the fetch, and the
  // effect stops re-running once it has a value.
  }, [user, config]);

  return config;
}
