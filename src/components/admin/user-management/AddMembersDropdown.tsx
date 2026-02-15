"use client";

import { useState, useRef, useEffect } from 'react';
import type { AdminFullUser, AdminGroup } from '@/hooks/useAdminUsers';
import UserAvatar from '@/components/UserAvatar';

interface AddMembersDropdownProps {
  group: AdminGroup;
  allUsers: AdminFullUser[];
  onAdd: (uids: string[]) => void;
  onClose: () => void;
}

export default function AddMembersDropdown({ group, allUsers, onAdd, onClose }: AddMembersDropdownProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Click-outside handler
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Filter to non-members matching search
  const nonMembers = allUsers.filter((u) => {
    if (group.members?.includes(u.uid)) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const fullName = `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase();
    return (
      fullName.includes(q) ||
      u.displayName?.toLowerCase().includes(q) ||
      u.workEmail?.toLowerCase().includes(q)
    );
  });

  const toggleUser = (uid: string) => {
    setSelectedUids((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  const handleConfirm = () => {
    if (selectedUids.length > 0) {
      onAdd(selectedUids);
    }
    onClose();
  };

  return (
    <div
      ref={dropdownRef}
      className="absolute top-full left-0 mt-1 w-80 rounded-lg shadow-xl z-50"
      style={{
        background: 'var(--sidebar-background)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      {/* Search */}
      <div className="p-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <input
          type="text"
          className="form-input w-full text-sm"
          placeholder="Search by name or email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          autoFocus
        />
      </div>

      {/* User list */}
      <div className="max-h-60 overflow-y-auto">
        {nonMembers.length === 0 ? (
          <div className="px-3 py-4 text-center text-sm" style={{ color: 'var(--foreground-muted)' }}>
            {searchQuery ? 'No matching users found.' : 'All users are already members.'}
          </div>
        ) : (
          nonMembers.map((user) => {
            const isSelected = selectedUids.includes(user.uid);
            return (
              <button
                key={user.uid}
                onClick={() => toggleUser(user.uid)}
                className="w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors"
                style={{
                  background: isSelected ? 'var(--active-background)' : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.background = 'var(--hover-background)';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.background = 'transparent';
                }}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  readOnly
                  className="w-4 h-4"
                  style={{ accentColor: '#3b82f6' }}
                />
                <UserAvatar
                  photoURL={user.photoURL}
                  name={user.displayName}
                  size="sm"
                />
                <div className="flex-1 min-w-0">
                  <span className="block truncate" style={{ color: 'var(--foreground)' }}>
                    {user.displayName}
                  </span>
                  <span className="block text-xs truncate" style={{ color: 'var(--foreground-muted)' }}>
                    {user.workEmail}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Confirm button */}
      {nonMembers.length > 0 && (
        <div className="p-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <button
            onClick={handleConfirm}
            className="btn-primary w-full text-sm"
            disabled={selectedUids.length === 0}
          >
            Add Selected ({selectedUids.length})
          </button>
        </div>
      )}
    </div>
  );
}
