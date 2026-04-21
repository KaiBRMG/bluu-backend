"use client";

import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/firebase-config';

export default function CreatorLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);

      const snap = await getDoc(doc(db, 'creators', cred.user.uid));
      if (!snap.exists()) {
        await auth.signOut();
        setError('No creator account found for this email.');
        setLoading(false);
        return;
      }
      if (snap.data()?.isActive !== true) {
        await auth.signOut();
        setError('This account has been deactivated. Please contact your administrator.');
        setLoading(false);
        return;
      }
      // Success: keep loading=true, layout will redirect to dashboard
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-login-credentials') {
        setError('Invalid email or password.');
      } else if (code === 'auth/user-disabled') {
        setError('This account has been deactivated. Please contact your administrator.');
      } else if (code === 'auth/too-many-requests') {
        setError('Too many failed attempts. Please try again later.');
      } else {
        setError('Login failed. Please try again.');
      }
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-black">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-12 max-w-md w-full">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <img
              src="/logo/bluu_long.svg"
              alt="Bluu"
              className="h-12 w-auto"
            />
          </div>
          <p className="text-zinc-400">Sign in to your creator portal</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm text-zinc-400 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm text-zinc-400 mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-white text-black font-semibold py-3 px-6 rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                Signing in...
              </span>
            ) : (
              'Sign in'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
