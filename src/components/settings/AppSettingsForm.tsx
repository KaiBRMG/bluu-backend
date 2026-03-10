"use client";

import { useState, useEffect, useRef, useMemo } from 'react';
import { useUserData } from '@/hooks/useUserData';
import { useAuth } from '@/components/AuthProvider';
import { getTimezoneList, getOffsetForTimezone, TimezoneOption } from '@/lib/timezoneData';
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { CheckIcon, ChevronDownIcon, PlusIcon, XIcon } from "lucide-react";

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
  const [primaryOpen, setPrimaryOpen] = useState(false);
  const [additionalOpen, setAdditionalOpen] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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

  const addressIsSet = !!(userData?.address?.city && userData?.address?.country);
  const isDisabled = !addressIsSet && !userData?.timezone;

  // Get current selection display
  const selectedOption: TimezoneOption | undefined = timezoneList.find(tz => tz.value === selectedTimezone);

  const handleSelect = (tz: TimezoneOption) => {
    setSelectedTimezone(tz.value);
    setPrimaryOpen(false);
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

  const handleAddAdditionalSlot = () => {
    if (additionalTimezones.length < 2) {
      setAdditionalTimezones(prev => [...prev, '']);
      setAdditionalOpen(additionalTimezones.length);
    }
  };

  const handleSelectAdditional = (index: number, tz: string) => {
    setAdditionalTimezones(prev => {
      const next = [...prev];
      next[index] = tz;
      return next;
    });
    setAdditionalOpen(null);
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
              <Button
                type="button"
                variant="link"
                onClick={() => onSectionChange('personal-info')}
                className="h-auto p-0 text-sm"
              >
                Personal Information
              </Button>
            </p>
          )}

          {/* Primary Timezone Dropdown */}
          <div style={{ opacity: isDisabled ? 0.5 : 1, pointerEvents: isDisabled ? 'none' : 'auto' }}>
            <Popover open={primaryOpen} onOpenChange={setPrimaryOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
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
                  <ChevronDownIcon className="size-3 flex-shrink-0" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search timezone or location..." />
                  <CommandList className="max-h-64">
                    <CommandEmpty>No timezones found</CommandEmpty>
                    <CommandGroup>
                      {timezoneList.map((tz) => (
                        <CommandItem
                          key={tz.value}
                          value={tz.label}
                          onSelect={() => handleSelect(tz)}
                        >
                          <CheckIcon
                            className="mr-2 size-4"
                            style={{ opacity: tz.value === selectedTimezone ? 1 : 0 }}
                          />
                          {tz.label}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
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

          <div className="flex flex-col gap-2">
            {additionalTimezones.map((tz, index) => {
              const option = timezoneList.find(t => t.value === tz);
              const isOpen = additionalOpen === index;
              return (
                <div key={index} className="flex items-center gap-2">
                  <Popover open={isOpen} onOpenChange={(open) => setAdditionalOpen(open ? index : null)}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
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
                        <ChevronDownIcon className="size-3 flex-shrink-0" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search timezone or location..." />
                        <CommandList className="max-h-64">
                          <CommandEmpty>No timezones found</CommandEmpty>
                          <CommandGroup>
                            {availableForAdditional.map((tzOpt) => (
                              <CommandItem
                                key={tzOpt.value}
                                value={tzOpt.label}
                                onSelect={() => handleSelectAdditional(index, tzOpt.value)}
                              >
                                {tzOpt.label}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveAdditional(index)}
                    className="flex-shrink-0 size-8 text-muted-foreground hover:text-destructive"
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                </div>
              );
            })}

            {additionalTimezones.length < 2 && (
              <Button
                type="button"
                variant="outline"
                onClick={handleAddAdditionalSlot}
                className="justify-start gap-1.5 border-dashed text-muted-foreground"
              >
                <PlusIcon className="size-3" />
                Add timezone ({additionalTimezones.length}/2)
              </Button>
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
        <div className="flex items-center justify-between gap-4 mb-4">
          <Label htmlFor="desktop-notif" className="text-sm font-medium cursor-pointer" style={{ color: 'var(--foreground)' }}>
            Desktop Notifications
          </Label>
          <Switch
            id="desktop-notif"
            checked={desktopEnabled}
            onCheckedChange={setDesktopEnabled}
          />
        </div>

        {/* Notification Sound */}
        <div className="flex items-center justify-between gap-4 mb-4">
          <Label htmlFor="sound-notif" className="text-sm font-medium cursor-pointer" style={{ color: 'var(--foreground)' }}>
            Notification Sound
          </Label>
          <Switch
            id="sound-notif"
            checked={soundEnabled}
            onCheckedChange={setSoundEnabled}
          />
        </div>

        {/* Screenshot Notifications */}
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="screenshot-notif" className="text-sm font-medium cursor-pointer" style={{ color: 'var(--foreground)' }}>
            Screenshot Notifications
          </Label>
          <Switch
            id="screenshot-notif"
            checked={screenshotNotifications}
            onCheckedChange={setScreenshotNotifications}
          />
        </div>
      </div>

      {/* Footer with Save/Cancel */}
      <div
        className="flex items-center justify-between pt-4 mt-4"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        <div>
          {saveMessage && (
            <Alert variant={saveMessage.type === 'error' ? 'destructive' : 'default'} className="py-2 px-3">
              <AlertDescription>{saveMessage.text}</AlertDescription>
            </Alert>
          )}
        </div>
        <div className="flex gap-3">
          {hasChanges && (
            <Button
              type="button"
              onClick={handleCancel}
              variant="outline"
              disabled={isSubmitting}
            >
              Cancel
            </Button>
          )}
          <Button
            type="button"
            onClick={handleSave}
            disabled={!hasChanges || isSubmitting || isDisabled}
          >
            {isSubmitting ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}
