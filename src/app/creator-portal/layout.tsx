"use client";

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { CreatorAuthProvider, useCreatorAuth } from '@/components/CreatorAuthProvider';
import { Loader } from '@/components/ui/loader';

function CreatorAuthWrapper({ children }: { children: React.ReactNode }) {
  const { creatorUser, loading } = useCreatorAuth();
  const pathname = usePathname();
  const router = useRouter();

  const isLoginRoute = pathname === '/creator-portal/login';

  useEffect(() => {
    if (loading) return;
    if (!creatorUser && !isLoginRoute) {
      router.replace('/creator-portal/login');
    }
    if (creatorUser && isLoginRoute) {
      router.replace('/creator-portal/dashboard');
    }
  }, [creatorUser, loading, isLoginRoute, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <Loader />
      </div>
    );
  }

  return <>{children}</>;
}

export default function CreatorPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <CreatorAuthProvider>
      <CreatorAuthWrapper>
        {children}
      </CreatorAuthWrapper>
    </CreatorAuthProvider>
  );
}
