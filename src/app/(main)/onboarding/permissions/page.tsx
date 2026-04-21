"use client";

import { useRouter } from 'next/navigation';
import { Focus, Megaphone } from 'lucide-react';

export default function PermissionsPage() {
  const router = useRouter();

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-12 max-w-lg w-full">
      <h1 className="text-xl font-semibold text-white mb-2 text-center">
        Bluu Backend requires the following permissions to work:
      </h1>

      <div className="mt-8 space-y-4">
        <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-5 flex items-start gap-4">
          <Focus className="text-white mt-0.5 shrink-0" size={22} />
          <div>
            <h3 className="text-white font-semibold text-sm mb-1">Screen Capturing</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Screenshots are taken of your screen while you are clocked in and tracking time
            </p>
          </div>
        </div>

        <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-5 flex items-start gap-4">
          <Megaphone className="text-white mt-0.5 shrink-0" size={22} />
          <div>
            <h3 className="text-white font-semibold text-sm mb-1">Notifications</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Receive real-time desktop notifications
            </p>
          </div>
        </div>
      </div>

      <button
        onClick={() => router.push('/onboarding/permission/screen')}
        className="mt-8 w-full bg-white text-black font-semibold py-3 px-6 rounded-lg hover:bg-zinc-200 transition-colors"
      >
        Proceed
      </button>
    </div>
  );
}
