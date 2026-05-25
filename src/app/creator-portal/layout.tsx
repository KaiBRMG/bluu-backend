"use client";

import { Suspense, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CreatorAuthProvider, useCreatorAuth } from '@/components/CreatorAuthProvider';
import { Loader } from '@/components/ui/loader';

function CreatorAuthWrapper({ children }: { children: React.ReactNode }) {
  const { creatorUser, loading } = useCreatorAuth();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const isLoginRoute = pathname === '/creator-portal/login';

  useEffect(() => {
    if (loading) return;
    if (!creatorUser && !isLoginRoute) {
      const current = pathname + (searchParams.toString() ? `?${searchParams.toString()}` : '');
      router.replace(`/creator-portal/login?redirect=${encodeURIComponent(current)}`);
    }
    if (creatorUser && isLoginRoute) {
      const redirect = searchParams.get('redirect');
      // Only follow relative redirects to prevent open-redirect attacks
      const destination = redirect?.startsWith('/') ? redirect : '/creator-portal/dashboard';
      router.replace(destination);
    }
  }, [creatorUser, loading, isLoginRoute, router, pathname, searchParams]);

  const redirecting =
    !loading && ((!creatorUser && !isLoginRoute) || (creatorUser && isLoginRoute));

  if (loading || redirecting) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <Loader />
      </div>
    );
  }

  return <>{children}</>;
}

const loader = (
  <div className="flex items-center justify-center min-h-screen bg-black">
    <Loader />
  </div>
);

export default function CreatorPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <CreatorAuthProvider>
      <Suspense fallback={loader}>
        <CreatorAuthWrapper>
          {children}
        </CreatorAuthWrapper>
      </Suspense>
    </CreatorAuthProvider>
  );
}
