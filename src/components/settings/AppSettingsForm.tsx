"use client";

import { useState, useEffect, useRef, useMemo } from 'react';
import { useUserData } from '@/hooks/useUserData';
import { useAuth } from '@/components/AuthProvider';
import { getTimezoneList, getOffsetForTimezone, TimezoneOption } from '@/lib/timezoneData';

interface AppSettingsFormProps {
  onSectionChange: (section: string) => void;
}

export default function AppSettingsForm({ onSectionChange }: AppSettingsFormProps) {
  const { userData, loading } = useUserData();
  const { user } = useAuth();

  const [selectedTimezone, setSelectedTimezone] = useState('');
  const originalTimezoneRef = useRef<string>('');
  const [hasChanges, setHasChanges] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);

  const timezoneList = useMemo(() => getTimezoneList(), []);

  // Initialize from userData
  useEffect(() => {
    if (userData?.timezone) {
      setSelectedTimezone(userData.timezone);
      originalTimezoneRef.current = userData.timezone;
    }
  }, [userData?.timezone]);

  // Change detection
  useEffect(() => {
    setHasChanges(selectedTimezone !== originalTimezoneRef.current);
  }, [selectedTimezone]);

  // Clear save message after 3 seconds
  useEffect(() => {
    if (saveMessage) {
      const timer = setTimeout(() => setSaveMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [saveMessage]);

  // Click-outside handler
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
        setSearch('');
      }
    }

    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [dropdownOpen]);

  const addressIsSet = !!(userData?.address?.city && userData?.address?.country);
  const isDisabled = !addressIsSet && !userData?.timezone;

  // Filter timezones by search
  const filteredTimezones = useMemo(() => {
    if (!search) return timezoneList;
    const lower = search.toLowerCase();
    return timezoneList.filter(
      tz => tz.value.toLowerCase().includes(lower) ||
            tz.label.toLowerCase().includes(lower)
    );
  }, [timezoneList, search]);

  // Get current selection display
  const selectedOption: TimezoneOption | undefined = timezoneList.find(tz => tz.value === selectedTimezone);

  const handleSelect = (tz: TimezoneOption) => {
    setSelectedTimezone(tz.value);
    setDropdownOpen(false);
    setSearch('');
  };

  const handleCancel = () => {
    setSelectedTimezone(originalTimezoneRef.current);
    setSaveMessage(null);
  };

  const handleSave = async () => {
    if (!selectedTimezone) return;

    setIsSubmitting(true);
    setSaveMessage(null);

    try {
      const idToken = await user?.getIdToken();
      if (!idToken) throw new Error('Not authenticated');

      const offset = getOffsetForTimezone(selectedTimezone);

      const response = await fetch('/api/user/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          timezone: selectedTimezone,
          timezoneOffset: offset,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update');
      }

      originalTimezoneRef.current = selectedTimezone;
      setHasChanges(false);
      setSaveMessage({ type: 'success', text: 'Changes saved successfully!' });
    } catch (error) {
      console.error('Save error:', error);
      setSaveMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to save changes',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto pr-2">
        {/* Timezone Section */}
        <div className="mb-6">
          <div className="mb-2">
            <label className="form-label">Time Zone</label>
            <p
              className="text-xs italic mt-1"
              style={{ color: 'var(--foreground-secondary)' }}
            >
              This is the time zone in which your shifts will be displayed. When coordinating with management staff, please keep in mind their respective time zones, which may include SAST (GMT+2), PHT (GMT+8), and UTC (GMT+0).
            </p>
          </div>

          {isDisabled && (
            <p className="text-sm mb-3" style={{ color: '#ef4444' }}>
              Address must first be set in{' '}
              <button
                type="button"
                onClick={() => onSectionChange('personal-info')}
                style={{
                  color: '#3b82f6',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  font: 'inherit',
                }}
              >
                Personal Information
              </button>
            </p>
          )}

          {/* Timezone Dropdown */}
          <div
            className="relative"
            ref={dropdownRef}
            style={{
              opacity: isDisabled ? 0.5 : 1,
              pointerEvents: isDisabled ? 'none' : 'auto',
            }}
          >
            <button
              type="button"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="form-input w-full flex items-center justify-between gap-2 text-left"
              style={{ cursor: 'pointer' }}
            >
              <span
                className="truncate"
                style={{
                  color: selectedOption ? 'var(--foreground)' : 'var(--foreground-muted)',
                }}
              >
                {selectedOption
                  ? `${selectedOption.value.replace(/_/g, ' ')} (UTC${selectedOption.offset})`
                  : 'Select timezone...'}
              </span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="flex-shrink-0"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {dropdownOpen && (
              <div
                className="absolute top-full left-0 mt-1 w-full max-h-72 overflow-y-auto rounded-lg shadow-xl z-50"
                style={{
                  background: 'var(--sidebar-background)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                {/* Search input */}
                <div
                  className="p-2 sticky top-0"
                  style={{ background: 'var(--sidebar-background)' }}
                >
                  <input
                    type="text"
                    className="form-input w-full"
                    placeholder="Search timezone or location..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  />
                </div>

                {/* Timezone list */}
                {filteredTimezones.length === 0 ? (
                  <div
                    className="px-3 py-4 text-sm text-center"
                    style={{ color: 'var(--foreground-muted)' }}
                  >
                    No timezones found
                  </div>
                ) : (
                  filteredTimezones.map((tz) => (
                    <button
                      key={tz.value}
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm transition-colors"
                      style={{
                        background: tz.value === selectedTimezone
                          ? 'var(--active-background)'
                          : 'transparent',
                        fontWeight: tz.value === selectedTimezone ? 500 : 400,
                      }}
                      onMouseEnter={(e) => {
                        if (tz.value !== selectedTimezone) {
                          e.currentTarget.style.background = 'var(--hover-background)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (tz.value !== selectedTimezone) {
                          e.currentTarget.style.background = 'transparent';
                        }
                      }}
                      onClick={() => handleSelect(tz)}
                    >
                      {tz.label}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer with Save/Cancel */}
      <div
        className="flex items-center justify-between pt-4 mt-4"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        <div>
          {saveMessage && (
            <span
              className="text-sm"
              style={{ color: saveMessage.type === 'success' ? '#22c55e' : '#ef4444' }}
            >
              {saveMessage.text}
            </span>
          )}
        </div>
        <div className="flex gap-3">
          {hasChanges && (
            <button
              type="button"
              onClick={handleCancel}
              className="btn-secondary"
              disabled={isSubmitting}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            className="btn-primary"
            disabled={!hasChanges || isSubmitting || isDisabled}
          >
            {isSubmitting ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
