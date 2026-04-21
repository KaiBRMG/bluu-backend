"use client";

import { useRouter } from 'next/navigation';

export default function DisplacedPage() {
  const router = useRouter();

  return (
    <div
      className="flex items-center justify-center min-h-screen bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: "url('/backgrounds/2_blur.png')" }}
    >
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-12 max-w-md w-full text-center">
        <div className="flex justify-center mb-6">
          <img src="/logo/bluu_long.svg" alt="Bluu" className="h-12 w-auto" />
        </div>
        <h1 className="text-xl font-semibold text-white mb-3">Signed Out</h1>
        <p className="text-zinc-400 mb-8">
          You were signed out because your account was logged in on another device.
          Only one active session is allowed at a time.
        </p>
        <button
          onClick={() => router.replace('/')}
          className="w-full bg-white text-black font-semibold py-3 px-6 rounded-lg hover:bg-zinc-200 transition-colors"
        >
          Back to Login
        </button>
      </div>
    </div>
  );
}
