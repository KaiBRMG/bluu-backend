"use client";

import { useEffect, useRef } from 'react';
import { useAuth } from './AuthProvider';
import Login from './Login';
import { usePathname } from 'next/navigation';

export default function AuthWrapper({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();

  // Track login state to prevent unnecessary IPC calls
  // Only call Electron API when the boolean state actually changes
  const isLoggedIn = !!user;
  const prevIsLoggedInRef = useRef<boolean>(isLoggedIn);

  // Allow auth routes to bypass authentication check
  const isAuthRoute = pathname?.startsWith('/auth/');

  // Control window resizability based on login state
  // Optimized to only make IPC call when login state changes, not on every user object mutation
  useEffect(() => {
    if (prevIsLoggedInRef.current !== isLoggedIn) {
      prevIsLoggedInRef.current = isLoggedIn;

      if (typeof window !== 'undefined' && window.electronAPI) {
        if (isLoggedIn) {
          window.electronAPI.window.setSize(1290, 695);
          window.electronAPI.window.setResizable(true);
        } else {
          window.electronAPI.window.setResizable(false);
        }
      }
    }
  }, [isLoggedIn]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  // Skip auth check for authentication routes
  if (isAuthRoute) {
    return <>{children}</>;
  }

  if (!user) {
    return <Login />;
  }

  return <>{children}</>;
}
