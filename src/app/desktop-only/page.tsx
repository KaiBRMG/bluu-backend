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
          Bluu Backend is only available through the desktop application. Please open the desktop app to sign in, or
          download the app{' '}
          <a
            href="https://www.notion.so/Download-Bluu-Backend-31d6a3e187d98080b341e4ed2c9d1917"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline underline-offset-4 hover:opacity-80"
          >
            here
          </a>
          .
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
