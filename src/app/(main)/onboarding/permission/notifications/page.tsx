"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import OnboardingCard from '../../_components/OnboardingCard';

export default function NotificationsPermissionPage() {
  const router = useRouter();
  const [platform, setPlatform] = useState<string>('');
  const [prompted, setPrompted] = useState(false);

  useEffect(() => {
    const init = async () => {
      if (typeof window !== 'undefined' && window.electronAPI?.app) {
        const p = await window.electronAPI.app.getPlatform();
        setPlatform(p);
      }
    };
    init();
  }, []);

  const handleRequestAccess = async () => {
    if (typeof window !== 'undefined' && window.electronAPI?.permissions) {
      await window.electronAPI.permissions.requestNotification();
    }
    setPrompted(true);
  };

  const isMac = platform === 'darwin';

  const instructions = isMac
    ? 'Allow notifications when the system prompt appears, or enable them in System Settings → Notifications → Bluu Backend.'
    : 'Allow notifications when the system prompt appears.';

  return (
    <OnboardingCard step={3}>
      <div className="flex items-center gap-2.5">
        <Megaphone className="shrink-0 text-zinc-400" size={18} aria-hidden="true" />
        <h1 className="text-lg font-semibold text-white">Notifications</h1>
      </div>

      <p className="mt-3 max-w-[65ch] text-sm leading-relaxed text-zinc-400">{instructions}</p>

      <Button variant="secondary" onClick={handleRequestAccess} className="mt-6 w-full">
        Prompt notification
      </Button>

      <p className="mt-2.5 text-xs text-zinc-500" aria-live="polite">
        {prompted
          ? 'Once you have enabled it, continue.'
          : 'Prompt for access to continue.'}
      </p>

      <div className="mt-6 flex gap-3">
        <Button
          variant="ghost"
          onClick={() => router.push('/onboarding/permission/screen')}
          className="text-zinc-400"
        >
          Back
        </Button>
        <Button
          onClick={() => router.push('/onboarding/profile')}
          disabled={!prompted}
          className="flex-1"
        >
          Next
        </Button>
      </div>
    </OnboardingCard>
  );
}
