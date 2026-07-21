export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    // Near-black canvas, matching the console the user is about to enter
    // (DESIGN.md §2). Depth comes from the card's white overlay, not the ground.
    //
    // `alignItems: 'safe center'` (inline, so browsers without it keep the
    // `items-center` class) is load-bearing: with plain centring, a card taller
    // than the window overflows past the TOP edge and the first fields become
    // unreachable — you cannot scroll above a centred flex item. Safe centring
    // falls back to start-alignment exactly when that would happen. The details
    // step is tall enough to hit this on a short window.
    <main
      className="flex min-h-screen items-center justify-center bg-background px-4 py-10"
      style={{ alignItems: 'safe center' }}
    >
      {children}
    </main>
  );
}
