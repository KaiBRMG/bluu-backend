"use client";

import { useState, useEffect, useRef, useMemo } from 'react';
import { useUserData } from '@/hooks/useUserData';
import { useAuth } from '@/components/AuthProvider';
import { getTimezoneList, getOffsetForTimezone, TimezoneOption } from '@/lib/timezoneData';

const DEFAULT_ADDITIONAL_TZS = ['Africa/Johannesburg', 'Asia/Manila'];

function tzOffsetMinutes(tz: string): number {
  const now = new Date();
  const utcMs = now.getTime();
  const localMs = new Date(now.toLocaleString('en-US', { timeZone: tz })).getTime();
  return Math.round((localMs - utcMs) / 60000);
}

function getDefaultAdditional(primaryTz: string): string[] {
  const primaryOffset = primaryTz ? tzOffsetMinutes(primaryTz) : null;
  return DEFAULT_ADDITIONAL_TZS.filter(
    tz => primaryOffset === null || tzOffsetMinutes(tz) !== primaryOffset
  );
}

interface AppSettingsFormProps {
  onSectionChange: (section: string) => void;
}

export default function AppSettingsForm({ onSectionChange }: AppSettingsFormProps) {
  const { userData, loading } = useUserData();
  const { user } = useAuth();

  // Notification preferences
  const [desktopEnabled, setDesktopEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [shiftReminders, setShiftReminders] = useState(true);
  const [screenshotNotifications, setScreenshotNotifications] = useState(true);
  const originalNotifPrefsRef = useRef({ desktopEnabled: true, soundEnabled: true, shiftReminders: true, screenshotNotifications: true });

  const [selectedTimezone, setSelectedTimezone] = useState('');
  const originalTimezoneRef = useRef<string>('');
  const [additionalTimezones, setAdditionalTimezones] = useState<string[]>([]);
  const originalAdditionalTimezonesRef = useRef<string[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [additionalDropdownOpen, setAdditionalDropdownOpen] = useState<number | null>(null);
  const [additionalSearch, setAdditionalSearch] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const additionalDropdownRef = useRef<HTMLDivElement>(null);

  const timezoneList = useMemo(() => getTimezoneList(), []);

  // Initialize from userData
  useEffect(() => {
    if (userData?.timezone) {
      setSelectedTimezone(userData.timezone);
      originalTimezoneRef.current = userData.timezone;
    }
  }, [userData?.timezone]);

  // Initialize notification preferences from userData
  useEffect(() => {
    const prefs = userData?.notificationPreferences;
    const desktop     = prefs?.desktopEnabled          !== false;
    const sound       = prefs?.soundEnabled            !== false;
    const shifts      = prefs?.shiftReminders          !== false;
    const screenshots = prefs?.screenshotNotifications !== false;
    setDesktopEnabled(desktop);
    setSoundEnabled(sound);
    setShiftReminders(shifts);
    setScreenshotNotifications(screenshots);
    originalNotifPrefsRef.current = { desktopEnabled: desktop, soundEnabled: sound, shiftReminders: shifts, screenshotNotifications: screenshots };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData?.notificationPreferences]);

  useEffect(() => {
    // undefined = never set → seed with defaults; [] = user explicitly cleared
    const saved = userData?.additionalTimezones !== undefined
      ? userData.additionalTimezones
      : getDefaultAdditional(userData?.timezone ?? '');
    setAdditionalTimezones(saved);
    originalAdditionalTimezonesRef.current = saved;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData?.additionalTimezones]);

  // Change detection
  useEffect(() => {
    const tzChanged = selectedTimezone !== originalTimezoneRef.current;
    const addlChanged =
      additionalTimezones.length !== originalAdditionalTimezonesRef.current.length ||
      additionalTimezones.some((tz, i) => tz !== originalAdditionalTimezonesRef.current[i]);
    const notifChanged =
      desktopEnabled          !== originalNotifPrefsRef.current.desktopEnabled          ||
      soundEnabled            !== originalNotifPrefsRef.current.soundEnabled            ||
      shiftReminders          !== originalNotifPrefsRef.current.shiftReminders          ||
      screenshotNotifications !== originalNotifPrefsRef.current.screenshotNotifications;
    setHasChanges(tzChanged || addlChanged || notifChanged);
  }, [selectedTimezone, additionalTimezones, desktopEnabled, soundEnabled, shiftReminders, screenshotNotifications]);

  // Clear save message after 3 seconds
  useEffect(() => {
    if (saveMessage) {
      const timer = setTimeout(() => setSaveMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [saveMessage]);

  // Click-outside handler (primary timezone)
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

  // Click-outside handler (additional timezones)
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (additionalDropdownRef.current && !additionalDropdownRef.current.contains(event.target as Node)) {
        setAdditionalDropdownOpen(null);
        setAdditionalSearch('');
      }
    }

    if (additionalDropdownOpen !== null) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [additionalDropdownOpen]);

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
    // Remove any additional timezone that shares the same offset as the new primary
    const newPrimaryOffset = tzOffsetMinutes(tz.value);
    setAdditionalTimezones(prev =>
      prev.filter(addlTz => addlTz === '' || tzOffsetMinutes(addlTz) !== newPrimaryOffset)
    );
  };

  // Additional timezones helpers
  const availableForAdditional = useMemo(() => {
    const taken = new Set([selectedTimezone, ...additionalTimezones]);
    return timezoneList.filter(tz => !taken.has(tz.value));
  }, [timezoneList, selectedTimezone, additionalTimezones]);

  const filteredAdditional = useMemo(() => {
    if (!additionalSearch) return availableForAdditional;
    const lower = additionalSearch.toLowerCase();
    return availableForAdditional.filter(
      tz => tz.value.toLowerCase().includes(lower) || tz.label.toLowerCase().includes(lower)
    );
  }, [availableForAdditional, additionalSearch]);

  const handleAddAdditionalSlot = () => {
    if (additionalTimezones.length < 2) {
      setAdditionalTimezones(prev => [...prev, '']);
      setAdditionalDropdownOpen(additionalTimezones.length);
    }
  };

  const handleSelectAdditional = (index: number, tz: string) => {
    setAdditionalTimezones(prev => {
      const next = [...prev];
      next[index] = tz;
      return next;
    });
    setAdditionalDropdownOpen(null);
    setAdditionalSearch('');
  };

  const handleRemoveAdditional = (index: number) => {
    setAdditionalTimezones(prev => prev.filter((_, i) => i !== index));
  };

  const handleCancel = () => {
    setSelectedTimezone(originalTimezoneRef.current);
    setAdditionalTimezones(originalAdditionalTimezonesRef.current);
    setDesktopEnabled(originalNotifPrefsRef.current.desktopEnabled);
    setSoundEnabled(originalNotifPrefsRef.current.soundEnabled);
    setShiftReminders(originalNotifPrefsRef.current.shiftReminders);
    setScreenshotNotifications(originalNotifPrefsRef.current.screenshotNotifications);
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
          additionalTimezones: additionalTimezones.filter(Boolean),
          notificationPreferences: { desktopEnabled, soundEnabled, shiftReminders, screenshotNotifications },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update');
      }

      originalTimezoneRef.current = selectedTimezone;
      originalAdditionalTimezonesRef.current = additionalTimezones.filter(Boolean);
      originalNotifPrefsRef.current = { desktopEnabled, soundEnabled, shiftReminders, screenshotNotifications };
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

        {/* Additional Timezones Section */}
        <div className="mb-6">
          <div className="mb-2">
            <label className="form-label">Additional Clocks</label>
            <p className="text-xs italic mt-1" style={{ color: 'var(--foreground-secondary)' }}>
              Select up to 2 extra time zones to display on your home screen clock widget.
            </p>
          </div>

          <div className="flex flex-col gap-2" ref={additionalDropdownRef}>
            {additionalTimezones.map((tz, index) => {
              const option = timezoneList.find(t => t.value === tz);
              const isOpen = additionalDropdownOpen === index;
              return (
                <div key={index} className="relative flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAdditionalDropdownOpen(isOpen ? null : index);
                      setAdditionalSearch('');
                    }}
                    className="form-input flex-1 flex items-center justify-between gap-2 text-left"
                    style={{ cursor: 'pointer' }}
                  >
                    <span
                      className="truncate"
                      style={{ color: option ? 'var(--foreground)' : 'var(--foreground-muted)' }}
                    >
                      {option
                        ? `${option.value.replace(/_/g, ' ')} (UTC${option.offset})`
                        : 'Select timezone...'}
                    </span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveAdditional(index)}
                    className="flex-shrink-0 p-1 rounded"
                    style={{ color: 'var(--foreground-muted)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--foreground-muted)'; }}
                    title="Remove"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>

                  {isOpen && (
                    <div
                      className="absolute top-full left-0 mt-1 w-full max-h-72 overflow-y-auto rounded-lg shadow-xl z-50"
                      style={{
                        background: 'var(--sidebar-background)',
                        border: '1px solid var(--border-subtle)',
                        width: 'calc(100% - 2rem)',
                      }}
                    >
                      <div className="p-2 sticky top-0" style={{ background: 'var(--sidebar-background)' }}>
                        <input
                          type="text"
                          className="form-input w-full"
                          placeholder="Search timezone or location..."
                          value={additionalSearch}
                          onChange={(e) => setAdditionalSearch(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          autoFocus
                        />
                      </div>
                      {filteredAdditional.length === 0 ? (
                        <div className="px-3 py-4 text-sm text-center" style={{ color: 'var(--foreground-muted)' }}>
                          No timezones found
                        </div>
                      ) : (
                        filteredAdditional.map((tzOpt) => (
                          <button
                            key={tzOpt.value}
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm transition-colors"
                            style={{ background: 'transparent' }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-background)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                            onClick={() => handleSelectAdditional(index, tzOpt.value)}
                          >
                            {tzOpt.label}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {additionalTimezones.length < 2 && (
              <button
                type="button"
                onClick={handleAddAdditionalSlot}
                className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg transition-colors"
                style={{
                  color: 'var(--foreground-secondary)',
                  border: '1px dashed var(--border-subtle)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--foreground-muted)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add timezone ({additionalTimezones.length}/2)
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Notifications Section */}
      <div className="mb-6">
        <div className="mb-4">
          <label className="form-label">Notifications</label>
        </div>

        {/* Desktop Notifications */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
              Desktop Notifications
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={desktopEnabled}
            onClick={() => setDesktopEnabled((v) => !v)}
            className="flex-shrink-0 relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none"
            style={{ background: desktopEnabled ? '#3b82f6' : 'var(--border-subtle)' }}
          >
            <span
              className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform"
              style={{ transform: desktopEnabled ? 'translateX(18px)' : 'translateX(2px)' }}
            />
          </button>
        </div>

        {/* Notification Sound */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
              Notification Sound
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={soundEnabled}
            onClick={() => setSoundEnabled((v) => !v)}
            className="flex-shrink-0 relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none"
            style={{ background: soundEnabled ? '#3b82f6' : 'var(--border-subtle)' }}
          >
            <span
              className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform"
              style={{ transform: soundEnabled ? 'translateX(18px)' : 'translateX(2px)' }}
            />
          </button>
        </div>

        {/* Screenshot Notifications */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
              Screenshot Notifications
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={screenshotNotifications}
            onClick={() => setScreenshotNotifications((v) => !v)}
            className="flex-shrink-0 relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none"
            style={{ background: screenshotNotifications ? '#3b82f6' : 'var(--border-subtle)' }}
          >
            <span
              className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform"
              style={{ transform: screenshotNotifications ? 'translateX(18px)' : 'translateX(2px)' }}
            />
          </button>
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
