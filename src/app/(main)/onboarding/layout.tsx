export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    // Near-black canvas, matching the console the user is about to enter
    // (DESIGN.md §2). Depth comes from the card's white overlay, not the ground.
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      {children}
    </div>
  );
}
