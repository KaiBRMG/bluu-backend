import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getSharedPrompt } from '@/lib/services/promptLibraryService';
import { promptBodyHtml } from '@/lib/promptHtml';
import { OpenInApp } from '../_components/OpenInApp';
import { SharedPromptBody } from '../_components/SharedPromptBody';
import { ShareMark } from '../_components/ShareMark';

/**
 * The public read-only view of a shared prompt.
 *
 * A server component that calls the service directly rather than fetching its
 * own API route — there is no second consumer, and a public HTTP endpoint
 * returning prompt text is one more thing to rate limit and abuse. The share
 * token in the path is the access control; everything the visitor can ever see
 * is what `getSharedPrompt` chooses to project (no uids, no author names, no
 * edit notes, no version history).
 *
 * Rendered fresh on every request — a prompt whose share was revoked, or which
 * was archived, must stop resolving immediately rather than after a cache TTL.
 * That needs no route-segment config: this project runs with Cache Components,
 * where a segment is uncached unless it opts in with `"use cache"`. Do not add
 * one here (`export const dynamic` is rejected outright under that flag), and
 * do not mark this page or `getSharedPrompt` cacheable.
 *
 * The split below is required by that same flag, not stylistic: uncached data
 * must be read INSIDE a `<Suspense>` boundary, so the shell renders immediately
 * and only the prompt itself streams in. Both `params` and the Firestore read
 * therefore live in `SharedPromptContent`, never in the default export.
 */
export default function SharedPromptPage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-5 py-10 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo/bluu_long.svg" alt="Bluu" className="h-6 w-auto" />
        <span className="rounded-full border border-white/[0.07] px-2.5 py-0.5 text-[11px] font-medium text-zinc-400">
          Shared prompt · read only
        </span>
      </div>

      <Suspense fallback={<SharedPromptSkeleton />}>
        <SharedPromptContent params={params} />
      </Suspense>

      <footer className="mt-auto pt-4 text-xs text-zinc-500">
        Shared from the Bluu Rock MGMT prompt library. This page is read-only and is not indexed.
      </footer>
    </main>
  );
}

async function SharedPromptContent({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  const prompt = await getSharedPrompt(shareId);

  // One 404 for every refusal — unknown token, deleted prompt, archived prompt,
  // revoked link. Distinguishing them would tell a stranger which tokens once
  // existed.
  if (!prompt) notFound();

  const updated = new Date(prompt.lastUpdatedTime);

  return (
    <>
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-white">{prompt.title}</h1>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
          {prompt.category && <span className="text-zinc-300">{prompt.category}</span>}
          {prompt.category && prompt.models.length > 0 && <span aria-hidden>·</span>}
          {prompt.models.length > 0 && (
            <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
              {prompt.models.map(model => (
                <span key={model.id} className="inline-flex items-center gap-1 text-zinc-300">
                  <ShareMark model={model} size={14} />
                  {model.name}
                </span>
              ))}
            </span>
          )}
          <span aria-hidden>·</span>
          <span className="tabular-nums">v{prompt.version}</span>
          <span aria-hidden>·</span>
          {/* A fixed, locale-independent format. This renders on the server and
              hydrates on the client, and `toLocaleDateString` would disagree
              between the two whenever their locales differ. */}
          <span className="tabular-nums">Updated {updated.toISOString().slice(0, 10)}</span>
        </div>

        {prompt.tags.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {prompt.tags.map(tag => (
              <li
                key={tag}
                className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs text-zinc-300"
              >
                {tag}
              </li>
            ))}
          </ul>
        )}
      </header>

      <SharedPromptBody html={promptBodyHtml(prompt.text, prompt.textHtml)} text={prompt.text} />

      <OpenInApp promptId={prompt.promptId} />
    </>
  );
}

/** Holds the page's shape while the prompt streams in, so the header and footer
 *  do not jump once it arrives. */
function SharedPromptSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="flex flex-col gap-3">
        <div className="h-8 w-2/3 rounded-md bg-white/[0.06]" />
        <div className="h-3 w-1/3 rounded-md bg-white/[0.04]" />
      </div>
      <div className="h-64 rounded-xl border border-white/[0.07] bg-white/[0.025]" />
    </div>
  );
}
