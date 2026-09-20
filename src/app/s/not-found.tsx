/**
 * What a recipient sees when a shared link does not resolve.
 *
 * Previously this fell through to Next's built-in 404: an unstyled page on a
 * domain the reader very likely does not recognise, with no indication that
 * they had been sent something, by whom, or what to do next. The recipient's
 * reasonable conclusion was that the sender had mistyped the URL.
 *
 * ## It says one thing for every refusal, on purpose
 *
 * Unknown token, deleted snip, expired snip, an upload that never finished —
 * `getPublicSnip` returns null for all four and this page cannot tell them
 * apart. That is deliberate and must stay: distinguishing them would let a
 * stranger probe which tokens once existed. So the copy names the *outcome*
 * ("no longer available") rather than a cause, which is also the only thing
 * honest here — for an expired link "it expired" would be true, and for a
 * mistyped one it would be a lie.
 *
 * ## The status code
 *
 * `notFound()` is called from inside the page's `<Suspense>` boundary, after
 * the shell has already been flushed, so the HTTP status on the response is
 * **200 rather than 404**. That is a property of the streaming split the page
 * is required to use under Cache Components (uncached reads must sit inside a
 * boundary), not something this file can correct. It matters only to machines
 * — link checkers, uptime monitors and unfurlers read a dead link as healthy —
 * and the page is `noindex`, so nothing is being served into search. Changing
 * it means moving the Firestore read out of the boundary, which trades a
 * documented constraint for a status code and should be decided on purpose.
 */
export default function SharedSnipNotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-5 py-10 sm:px-8">
      {/* The same lockup, in the same place, as a link that works. A reader who
          has been sent two links should not have to work out whether this is
          even the same product. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo/HQ2.webp" alt="Bluu Rock" width={1374} height={868} className="h-10 w-auto" />

      <div className="max-w-xl">
        <h1 className="text-2xl font-bold tracking-tight">This link is no longer available</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Shared captures are deleted automatically after a set time, and the
          person who sent this one can also remove it at any point.
        </p>
        {/* The one action the reader actually has. Without it the page is an
            apology; with it, it is a next step. */}
        <p className="mt-3 text-sm text-zinc-400">
          Ask whoever sent it to share a new link.
        </p>
      </div>

      <footer className="mt-auto pt-4 text-xs text-zinc-400">Shared from Bluu Rock MGMT.</footer>
    </main>
  );
}
