export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    // The same blurred ground the login screen uses, so signing in and setting up
    // read as one continuous surface. `bg-background` stays underneath as the
    // fallback if the image fails to load — the card must never sit on white.
    //
    // `h-screen` + `overflow-hidden` locks the page: onboarding never scrolls as a
    // page on any step. The details step is the only one with more content than
    // fits, and it absorbs that internally — `OnboardingCard` is capped at
    // `max-h-full` and scrolls its own body, so nothing can spill past the
    // viewport and leave dead space below the card.
    <main
      className="flex h-screen items-center justify-center overflow-hidden bg-background bg-cover bg-center bg-no-repeat p-4 sm:p-6"
      style={{ backgroundImage: "url('/backgrounds/2_blur.png')" }}
    >
      {children}
    </main>
  );
}
