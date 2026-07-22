import LockPageScroll from './_components/LockPageScroll';

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Holds html/body at overflow:hidden while onboarding is mounted. */}
      <LockPageScroll />

      {/* The same blurred ground the login screen uses, so signing in and setting
          up read as one continuous surface. `bg-background` stays underneath as
          the fallback if the image fails to load — the card must never sit on
          white.

          `fixed inset-0` rather than `h-screen`: a fixed shell is out of normal
          flow, so it contributes no document height and cannot itself cause the
          page to scroll. `h-screen` did not achieve that — sibling content from
          `(main)/layout.tsx` still grew the document past the viewport, leaving a
          dead scroll region below the card. Between this and LockPageScroll the
          page cannot scroll on any step; the details step absorbs its overflow
          internally, since `OnboardingCard` is capped at `max-h-full` and scrolls
          its own body. */}
      <main
        className="fixed inset-0 flex items-center justify-center overflow-hidden bg-background bg-cover bg-center bg-no-repeat p-4 sm:p-6"
        style={{ backgroundImage: "url('/backgrounds/2_blur.png')" }}
      >
        {children}
      </main>
    </>
  );
}
