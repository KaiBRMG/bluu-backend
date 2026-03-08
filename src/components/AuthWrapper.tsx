"use client";

import { useEffect, useRef } from 'react';
import { useAuth } from './AuthProvider';
import { useUserData } from '@/hooks/useUserData';
import Login from './Login';
import { usePathname, useRouter } from 'next/navigation';
import { auth } from '@/firebase-config';

export default function AuthWrapper({ children }: { children: React.ReactNode }) {
  const { user, loading, revokedRedirect } = useAuth();
  const { userData, loading: userDataLoading, displaced } = useUserData();
  const pathname = usePathname();
  const router = useRouter();

  const isLoggedIn = !!user;
  const prevIsLoggedInRef = useRef<boolean>(isLoggedIn);

  const isAuthRoute = pathname?.startsWith('/auth/');

  // Redirect to revoked page if AuthProvider detected isActive=false at login time
  useEffect(() => {
    if (revokedRedirect) {
      router.replace('/auth/revoked');
    }
  }, [revokedRedirect, router]);

  // Control window resizability based on login state
  useEffect(() => {
    if (prevIsLoggedInRef.current !== isLoggedIn) {
      prevIsLoggedInRef.current = isLoggedIn;

      if (typeof window !== 'undefined' && window.electronAPI) {
        if (isLoggedIn) {
          window.electronAPI.window.setSize(1430, 870);
          window.electronAPI.window.setResizable(true);
        } else {
          window.electronAPI.window.setResizable(false);
        }
      }
    }
  }, [isLoggedIn]);

  // Mid-session kill-switch: fires when an admin revokes access while the user is logged in.
  // useUserData uses onSnapshot — 0 extra reads while isActive stays true.
  useEffect(() => {
    if (!user || userDataLoading || isAuthRoute) return;
    if (userData && userData.isActive === false) {
      auth.signOut().then(() => {
        router.replace('/auth/revoked');
      });
    }
  }, [userData, userDataLoading, user, isAuthRoute, router]);

  // Single active session enforcement: sign out and redirect if another device logged in.
  useEffect(() => {
    if (!user || userDataLoading || isAuthRoute) return;
    if (displaced) {
      localStorage.removeItem('sessionToken');
      auth.signOut().then(() => {
        router.replace('/auth/displaced');
      });
    }
  }, [displaced, userDataLoading, user, isAuthRoute, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  if (isAuthRoute) {
    return <>{children}</>;
  }

  if (!user) {
    return <Login />;
  }

  return <>{children}</>;
}
