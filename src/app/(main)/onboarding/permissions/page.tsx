"use client";

import { useRouter } from 'next/navigation';
import { Focus, Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import OnboardingCard from '../_components/OnboardingCard';

const PERMISSIONS = [
  {
    icon: Focus,
    title: 'Screen capturing',
    body: 'Screenshots are taken of your screen while you are clocked in and tracking time.',
  },
  {
    icon: Megaphone,
    title: 'Notifications',
    body: 'Receive real-time desktop notifications.',
  },
];

export default function PermissionsPage() {
  const router = useRouter();

  return (
    <OnboardingCard step={1}>
      <h1 className="text-lg font-semibold text-white">Two permissions to set up</h1>
      <p className="mt-1.5 max-w-[65ch] text-sm leading-relaxed text-zinc-400">
        Bluu Backend needs these from your operating system to work. We&apos;ll walk you
        through them one at a time.
      </p>

      <ul className="mt-6 space-y-3">
        {PERMISSIONS.map(({ icon: Icon, title, body }) => (
          <li
            key={title}
            className="flex items-start gap-3.5 rounded-lg border p-4"
            style={{
              background: 'rgba(255,255,255,0.04)',
              borderColor: 'rgba(255,255,255,0.07)',
            }}
          >
            <Icon className="mt-0.5 shrink-0 text-zinc-400" size={18} aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold text-white">{title}</h2>
              <p className="mt-1 text-sm leading-relaxed text-zinc-400">{body}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-7 flex gap-3">
        <Button
          variant="ghost"
          onClick={() => router.push('/onboarding/welcome')}
          className="text-zinc-400"
        >
          Back
        </Button>
        <Button onClick={() => router.push('/onboarding/permission/screen')} className="flex-1">
          Next
        </Button>
      </div>
    </OnboardingCard>
  );
}
