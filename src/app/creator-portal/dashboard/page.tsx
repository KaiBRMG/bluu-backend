"use client";

import { useCreatorAuth } from '@/components/CreatorAuthProvider';
import { auth } from '@/firebase-config';

export default function CreatorDashboardPage() {
  const { creatorUser } = useCreatorAuth();

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-semibold">
            Welcome, {creatorUser?.stageName || creatorUser?.displayName}
          </h1>
          <button
            onClick={() => auth.signOut()}
            className="text-sm text-zinc-400 hover:text-white transition-colors"
          >
            Sign out
          </button>
        </div>
        <p className="text-zinc-400">Creator portal — coming soon.</p>
      </div>
    </div>
  );
}
