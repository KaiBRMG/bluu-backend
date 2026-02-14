"use client";

import { useState, useEffect, useRef } from "react";
import { auth } from "../firebase-config";
import UserAvatar from "@/components/UserAvatar";
import { clearPermissionsCache } from "@/lib/permissionsCache";

interface TopBarProps {
  userData: {
    name: string;
    email: string;
    role: string;
    photoURL?: string | null;
  };
}

export default function TopBar({ userData }: TopBarProps) {
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Click-outside handler for user menu
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    }

    if (isUserMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isUserMenuOpen]);

  const handleSignOut = async () => {
    try {
      clearPermissionsCache();
      await auth.signOut();
      setIsUserMenuOpen(false);
    } catch (error) {
      console.error('Sign out error:', error);
      alert('Failed to sign out. Please try again.');
    }
  };

  return (
    <header className="h-14 flex items-center justify-between px-6" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      {/* Search bar */}
      <div className="flex-1 max-w-xl">
        <div className="relative flex items-center">
          <img src="/Icons/search.svg" alt="Search" className="absolute left-3 w-4 h-4 pointer-events-none" style={{ opacity: 'var(--icon-inactive)' }} />
          <input
            type="search"
            placeholder="Search..."
            className="search-input w-full pl-10 pr-4"
          />
        </div>
      </div>

      {/* Right side - notifications and user */}
      <div className="flex items-center gap-4">
        {/* Notifications */}
        <button
          className="relative p-2 rounded-lg transition-colors"
          style={{ background: 'transparent' }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover-background)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          <img src="/Icons/notifications.svg" alt="Notifications" className="w-5 h-5" style={{ opacity: 'var(--icon-inactive)' }} />
          <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
        </button>

        {/* User menu */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
            className="flex items-center gap-3 px-3 py-2 rounded-lg transition-colors"
            style={{ background: 'transparent' }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover-background)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <UserAvatar
              photoURL={userData.photoURL}
              name={userData.name}
              size="sm"
            />
            <div className="text-left hidden md:block">
              <div className="text-sm font-medium">{userData.name}</div>
              <div className="text-xs" style={{ color: 'var(--foreground)' }}>{userData.role}</div>
            </div>
          </button>

          {/* Dropdown menu */}
          {isUserMenuOpen && (
            <div
              className="absolute right-0 mt-2 w-64 rounded-lg shadow-xl py-2 z-50"
              style={{
                background: 'var(--sidebar-background)',
                border: '1px solid var(--border-subtle)'
              }}
            >
              <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <div className="font-medium">{userData.name}</div>
                <div className="text-sm" style={{ color: 'var(--foreground-muted)' }}>{userData.email}</div>
              </div>

              <div className="pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button
                  onClick={handleSignOut}
                  className="w-full px-4 py-2 text-left transition-colors text-red-400 flex items-center gap-3"
                  style={{ background: 'transparent' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover-background)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <img src="/Icons/sign_out.svg" alt="Sign Out" className="w-4 h-4" />
                  <span className="text-sm">Sign Out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
