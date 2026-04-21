export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: '#002333' }}
    >
      {children}
    </div>
  );
}
