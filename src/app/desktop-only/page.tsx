import Link from 'next/link';

export const metadata = {
  title: 'Desktop App Required — Bluu Backend',
};

export default function DesktopOnlyPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-foreground">
          Desktop app required
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">
          The Bluu Backend employee portal is only available through the Bluu
          Rock desktop application. Please open the desktop app to sign in.
        </p>
        <p className="mt-6 text-sm text-muted-foreground">
          Are you a creator?{' '}
          <Link
            href="/creator-portal/dashboard"
            className="text-foreground underline underline-offset-4 hover:opacity-80"
          >
            Go to the creator portal
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
