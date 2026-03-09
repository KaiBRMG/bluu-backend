"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Megaphone } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';

export default function NotificationsPermissionPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [platform, setPlatform] = useState<string>('');
  const [prompted, setPrompted] = useState(false);
  const [finishing, setFinishing] = useState(false);

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

  const handleFinish = async () => {
    if (!user || finishing) return;
    setFinishing(true);
    try {
      const idToken = await user.getIdToken();
      await fetch('/api/user/onboarding', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ hasCompletedOnboarding: true }),
      });
      router.push('/');
    } catch (err) {
      console.error('[NotificationsPermissionPage] Failed to complete onboarding:', err);
      setFinishing(false);
    }
  };

  const isMac = platform === 'darwin';

  const instructions = isMac
    ? "Allow notifications when the system prompt appears, or enable them in System Settings → Notifications → Bluu Backend. Then click \"I've enabled it\" below."
    : "Allow notifications when the system prompt appears. Then click \"I've enabled it\" below.";

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-12 max-w-lg w-full">
      <div className="flex items-center gap-3 mb-6">
        <Megaphone className="text-white shrink-0" size={24} />
        <h1 className="text-xl font-semibold text-white">Notifications</h1>
      </div>

      <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4 mb-6">
        <p className="text-zinc-300 text-sm leading-relaxed">{instructions}</p>
      </div>

      <button
        onClick={handleRequestAccess}
        className="w-full bg-zinc-700 text-white font-semibold py-3 px-6 rounded-lg hover:bg-zinc-600 transition-colors mb-3"
      >
        Prompt Notification
      </button>

      <button
        onClick={handleFinish}
        disabled={!prompted || finishing}
        className="w-full bg-white text-black font-semibold py-3 px-6 rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {finishing ? 'Please wait...' : "I've enabled it"}
      </button>
    </div>
  );
}
