'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { api } from '../_lib/api';

interface SignedInAsideProps {
  name?: string | null;
  email?: string;
  /** Off in the task room: signing out mid-test would only strand the attempt. */
  signOut?: boolean;
}

/**
 * Who is signed in — "Name (email)" — and the way out. It shows at every width: in the room it is
 * what puts the candidate's identity into the screen recording.
 */
export function SignedInAside({ name, email, signOut = true }: SignedInAsideProps) {
  const router = useRouter();
  const who = name && email ? `${name} (${email})` : (name ?? email);
  return (
    <div className="flex min-w-0 items-center gap-3">
      {who && (
        <span className="truncate text-sm text-white/80" title={who}>
          {who}
        </span>
      )}
      {signOut && (
        <Button
          variant="ghost"
          size="sm"
          className="h-11 shrink-0 px-3 text-sm text-white/80 hover:text-white"
          onClick={async () => {
            await api('/api/training/logout', { method: 'POST' }).catch(() => {});
            router.replace('/training');
          }}
        >
          Sign out
        </Button>
      )}
    </div>
  );
}
