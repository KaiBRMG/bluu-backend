"use client";

import { useEffect, useState } from 'react';
import { signInWithPopup, signInWithCustomToken } from 'firebase/auth';
import { auth, googleProvider } from '../firebase-config';

declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean;
      auth: {
        startGoogleOAuth: () => Promise<{ success: boolean }>;
        onOAuthCallback: (callback: (code: string) => void) => void;
        onOAuthError: (callback: (error: string) => void) => void;
        removeOAuthListeners: () => void;
      };
      window: {
        setResizable: (resizable: boolean) => void;
      };
    };
  }
}

function Login() {
  const [isElectron] = useState(() => typeof window !== 'undefined' && window.electronAPI?.isElectron);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isElectron || !window.electronAPI) return;

    // Set up OAuth callback listeners for Electron
    window.electronAPI.auth.onOAuthCallback(async (code: string) => {
      try {
        setLoading(true);

        // Exchange code for Firebase custom token
        const response = await fetch('/api/auth/exchange-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to authenticate');
        }

        // Sign in with custom token
        await signInWithCustomToken(auth, data.customToken);

        setLoading(false);
      } catch (error: any) {
        console.error('OAuth callback error:', error);
        alert(error.message || 'Login failed. Please try again.');
        setLoading(false);
      }
    });

    window.electronAPI.auth.onOAuthError((error: string) => {
      console.error('OAuth error:', error);
      alert('Login failed: ' + error);
      setLoading(false);
    });

    return () => {
      window.electronAPI?.auth.removeOAuthListeners();
    };
  }, [isElectron]);

  const handleElectronLogin = async () => {
    if (!window.electronAPI) return;

    try {
      setLoading(true);
      await window.electronAPI.auth.startGoogleOAuth();
      // OAuth flow continues in the callback listener
    } catch (error) {
      console.error('Login error:', error);
      alert('Login failed. Please try again.');
      setLoading(false);
    }
  };

  const handleBrowserLogin = async () => {
    try {
      setLoading(true);
      const result = await signInWithPopup(auth, googleProvider);
      const email = result.user.email;

      if (!email || !email.endsWith('@bluurock.com')) {
        await auth.signOut();
        alert('Access denied. Please use your @bluurock.com email address.');
        setLoading(false);
      }
    } catch (error) {
      console.error('Login error:', error);
      alert('Login failed. Please try again.');
      setLoading(false);
    }
  };

  const handleLogin = isElectron ? handleElectronLogin : handleBrowserLogin;

  return (
    <div
      className="flex items-center justify-center min-h-screen bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: "url('/backgrounds/2_blur.png')" }}
    >
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-12 max-w-md w-full">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <img
              src="/logo/bluu_long.svg"
              alt="Bluu"
              className="h-12 w-auto"
            />
          </div>
          <p className="text-zinc-400">Sign in to access your workspace</p>
        </div>

        <button
          onClick={handleLogin}
          disabled={loading}
          className="w-full bg-white text-black font-semibold py-3 px-6 rounded-lg hover:bg-zinc-200 transition-colors flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
              {isElectron ? 'Signing in...' : 'Signing in...'}
            </>
          ) : (
            <>
              <svg className="w-5 h-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Sign in with Google
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default Login;
