'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { api } from '../_lib/api';

/** Who is signed in, and the way out. Clears the cookie, then back to the gate. */
export function SignedInAside({ email }: { email?: string }) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-3">
      {email && <span className="hidden max-w-[16rem] truncate text-sm text-white/70 sm:block">{email}</span>}
      <Button
        variant="ghost"
        size="sm"
        className="h-11 px-3 text-sm text-white/80 hover:text-white"
        onClick={async () => {
          await api('/api/training/logout', { method: 'POST' }).catch(() => {});
          router.replace('/training');
        }}
      >
        Sign out
      </Button>
    </div>
  );
}
