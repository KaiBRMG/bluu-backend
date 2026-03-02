'use client';

import { useState, useEffect, useCallback } from 'react';
import type { ExpandedShift } from '@/lib/utils/recurrence';
import type { ShiftUser, CreateShiftPayload, UpdateShiftPayload } from '@/hooks/useShifts';
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ChevronDownIcon } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────

type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly';
type DeleteMode = 'single' | 'future' | 'series';
type SaveMode   = 'single' | 'future' | 'all';

interface Props {
  mode: 'create' | 'edit';
  shift?: ExpandedShift;        // for edit
  prefillUserId?: string;       // for create from cell click
  prefillDate?: string;         // "YYYY-MM-DD" for create from cell click
  users: ShiftUser[];
  onSave: (shiftId: string | null, payload: CreateShiftPayload | UpdateShiftPayload, saveMode: SaveMode) => Promise<void>;
  onDelete?: (shiftId: string, mode: DeleteMode, overrideDate?: string) => Promise<void>;
  onClose: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toLocalDateString(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

function toLocalTimeString(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
}

/** Convert a local "YYYY-MM-DD HH:mm" in a given IANA tz to a UTC ISO string. */
function localToUtcIso(dateStr: string, timeStr: string, tz: string): string {
  // Use the same iterative approach as recurrence.ts wallClockToUtcMs
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, min]  = timeStr.split(':').map(Number);

  let guessMs = Date.UTC(y, m - 1, d, h, min, 0, 0);

  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(guessMs));

    const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value ?? '0', 10);
    let lh = get('hour');
    if (lh === 24) lh = 0;

    const diffMs =
      (y   - get('year'))   * 365.25 * 24 * 3_600_000 +
      (m   - get('month'))  *    30  * 24 * 3_600_000 +
      (d   - get('day'))    *          24 * 3_600_000 +
      (h   - lh)            *               3_600_000 +
      (min - get('minute')) *                  60_000;

    if (Math.abs(diffMs) < 60_000) break;
    guessMs += diffMs;
  }

  return new Date(guessMs).toISOString();
}

// ─── Component ───────────────────────────────────────────────────────

export default function ShiftModal({
  mode,
  shift,
  prefillUserId,
  prefillDate,
  users,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const isEdit   = mode === 'edit';
  const isRecurringShift = !!shift?.isRecurring;

  // Determine display timezone: use selected user's timezone
  const getUserTz = useCallback((uid: string) =>
    users.find(u => u.uid === uid)?.timezone ?? 'UTC', [users]);

  // ── Form state ──────────────────────────────────────────────────────
  const defaultUser = prefillUserId ?? shift?.userId ?? users[0]?.uid ?? '';
  const defaultTz   = getUserTz(defaultUser);

  const defaultStartDate = prefillDate
    ?? (shift ? toLocalDateString(shift.occurrenceStart, getUserTz(shift.userId)) : new Date().toISOString().slice(0, 10));
  const defaultEndDate   = shift
    ? toLocalDateString(shift.occurrenceEnd, getUserTz(shift.userId))
    : defaultStartDate;
  const defaultStartTime = shift ? toLocalTimeString(shift.occurrenceStart, getUserTz(shift.userId)) : '09:00';
  const defaultEndTime   = shift ? toLocalTimeString(shift.occurrenceEnd,   getUserTz(shift.userId)) : '17:00';

  const [userId,        setUserId]        = useState(defaultUser);
  const [startDate,     setStartDate]     = useState(defaultStartDate);
  const [endDate,       setEndDate]       = useState(defaultEndDate);
  const [startTime,     setStartTime]     = useState(defaultStartTime);
  const [endTime,       setEndTime]       = useState(defaultEndTime);
  const [isRecurring,   setIsRecurring]   = useState(shift?.isRecurring ?? false);
  const [frequency,     setFrequency]     = useState<RecurrenceFrequency>(
    (shift?.recurrence?.frequency as RecurrenceFrequency) ?? 'weekly',
  );
  const [interval,      setInterval]      = useState(shift?.recurrence?.interval ?? 1);
  const [daysOfWeek,    setDaysOfWeek]    = useState<number[]>(
    shift?.recurrence?.daysOfWeek ?? [],
  );
  const [endCondition,  setEndCondition]  = useState<'none' | 'date' | 'count'>(
    shift?.recurrence?.endDate ? 'date' :
    shift?.recurrence?.count  ? 'count' : 'none',
  );
  const [recurEndDate,  setRecurEndDate]  = useState(
    shift?.recurrence?.endDate ? new Date(shift.recurrence.endDate as unknown as string).toISOString().slice(0, 10) : '',
  );
  const [count,         setCount]         = useState(shift?.recurrence?.count ?? 10);

  // ── Date picker open states ──────────────────────────────────────────
  const [startDateOpen,  setStartDateOpen]  = useState(false);
  const [endDateOpen,    setEndDateOpen]    = useState(false);
  const [recurEndOpen,   setRecurEndOpen]   = useState(false);

  // ── Save dialogue (for recurring edits) ─────────────────────────────
  const [showSaveDialogue,   setShowSaveDialogue]   = useState(false);
  const [showDeleteDialogue, setShowDeleteDialogue] = useState(false);
  const [saving,             setSaving]             = useState(false);
  const [deleting,           setDeleting]           = useState(false);
  const [error,              setError]              = useState<string | null>(null);

  // Update daysOfWeek default when frequency changes to weekly
  useEffect(() => {
    if (frequency === 'weekly' && daysOfWeek.length === 0 && startDate) {
      const [y, m, d] = startDate.split('-').map(Number);
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      setDaysOfWeek([dow]);
    }
  }, [frequency]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Validation ────────────────────────────────────────────────────────
  function validate(): string | null {
    if (!userId)     return 'Please select an employee.';
    if (!startDate)  return 'Please set a start date.';
    if (!endDate)    return 'Please set an end date.';
    if (!startTime)  return 'Please set a start time.';
    if (!endTime)    return 'Please set an end time.';
    const tz  = getUserTz(userId);
    const startMs = new Date(localToUtcIso(startDate, startTime, tz)).getTime();
    const endMs   = new Date(localToUtcIso(endDate,   endTime,   tz)).getTime();
    if (endMs <= startMs) return 'End must be after start.';
    if (isRecurring && frequency === 'weekly' && daysOfWeek.length === 0)
      return 'Select at least one day for weekly recurrence.';
    return null;
  }

  // ── Build payload ────────────────────────────────────────────────────
  function buildPayload() {
    const tz = getUserTz(userId);

    const recurrencePayload = isRecurring ? {
      frequency,
      interval,
      daysOfWeek: frequency === 'weekly' ? daysOfWeek : [],
      endDate: endCondition === 'date' && recurEndDate ? localToUtcIso(recurEndDate, '00:00', tz) : null,
      count:   endCondition === 'count' ? count : null,
      parentShiftId: null,
    } : null;

    return {
      userId,
      startTime:      localToUtcIso(startDate, startTime, tz),
      endTime:        localToUtcIso(endDate,   endTime,   tz),
      wallClockStart: startTime,
      wallClockEnd:   endTime,
      userTimezone:   tz,
      recurrence:     recurrencePayload,
    };
  }

  // ── Save handlers ────────────────────────────────────────────────────
  async function handleSave(saveMode: SaveMode) {
    const validationError = validate();
    if (validationError) { setError(validationError); return; }

    setSaving(true);
    setError(null);

    try {
      const payload = buildPayload();

      if (isEdit && shift) {
        const updatePayload: UpdateShiftPayload = {
          ...payload,
          ...(saveMode !== 'all' && {
            saveMode: saveMode as 'single' | 'future',
            overrideDate: shift.overrideDate ?? shift.startTime,
          }),
        };
        await onSave(shift.shiftId, updatePayload, saveMode);
      } else {
        await onSave(null, payload as CreateShiftPayload, saveMode);
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save shift');
    } finally {
      setSaving(false);
    }
  }

  function handleSaveClick() {
    const validationError = validate();
    if (validationError) { setError(validationError); return; }

    if (isEdit && isRecurringShift) {
      setShowSaveDialogue(true);
    } else {
      handleSave('all');
    }
  }

  // ── Delete handlers ──────────────────────────────────────────────────
  async function handleDelete(deleteMode: DeleteMode) {
    if (!shift || !onDelete) return;

    setDeleting(true);
    setError(null);

    try {
      await onDelete(
        shift.shiftId,
        deleteMode,
        (deleteMode === 'single' || deleteMode === 'future')
          ? (shift.overrideDate ?? shift.startTime)
          : undefined,
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete shift');
      setDeleting(false);
    }
  }

  // ── Styles ────────────────────────────────────────────────────────────
  const labelStyle: React.CSSProperties = {
    fontSize: '12px',
    fontWeight: 500,
    color: 'var(--foreground-secondary)',
    marginBottom: '4px',
    display: 'block',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '7px 10px',
    borderRadius: '6px',
    border: '1px solid var(--border-subtle)',
    background: 'var(--input-background, var(--sidebar-background))',
    color: 'var(--foreground)',
    fontSize: '13px',
    outline: 'none',
    boxSizing: 'border-box',
  };

  const sectionStyle: React.CSSProperties = {
    marginBottom: '14px',
  };

  const btnPrimary: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: '7px',
    background: 'var(--foreground)',
    color: 'var(--background)',
    fontSize: '13px',
    fontWeight: 600,
    border: 'none',
    cursor: saving ? 'not-allowed' : 'pointer',
    opacity: saving ? 0.6 : 1,
  };

  const btnSecondary: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: '7px',
    background: 'transparent',
    color: 'var(--foreground-secondary)',
    fontSize: '13px',
    fontWeight: 500,
    border: '1px solid var(--border-subtle)',
    cursor: 'pointer',
  };

  const btnDanger: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: '7px',
    background: '#ef4444',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 500,
    border: 'none',
    cursor: deleting ? 'not-allowed' : 'pointer',
    opacity: deleting ? 0.6 : 1,
  };

  const dialogueOptionStyle: React.CSSProperties = {
    padding: '10px 14px',
    borderRadius: '7px',
    border: '1px solid var(--border-subtle)',
    background: 'var(--sidebar-background)',
    color: 'var(--foreground)',
    fontSize: '13px',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    marginBottom: '6px',
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: 'var(--background)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '480px',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '24px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        }}
      >
        <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '20px', color: 'var(--foreground)' }}>
          {isEdit ? 'Edit Shift' : 'Create Shift'}
        </h2>

        {/* Employee selector */}
        <div style={sectionStyle}>
          <label style={labelStyle}>Employee</label>
          <select
            value={userId}
            onChange={e => setUserId(e.target.value)}
            style={inputStyle}
            disabled={isEdit}
          >
            {users.map(u => (
              <option key={u.uid} value={u.uid}>{u.displayName}</option>
            ))}
          </select>
        </div>

        {/* Start date + time */}
        <div style={{ ...sectionStyle, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <label style={labelStyle}>Start Date</label>
            <Popover open={startDateOpen} onOpenChange={setStartDateOpen}>
              <PopoverTrigger asChild>
                <button type="button" style={{ ...inputStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                  {startDate || 'Select date'}
                  <ChevronDownIcon style={{ width: '14px', height: '14px', flexShrink: 0 }} />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto overflow-hidden p-0" align="start">
                <Calendar
                  mode="single"
                  selected={startDate ? new Date(startDate + 'T00:00:00') : undefined}
                  captionLayout="dropdown"
                  onSelect={(date: Date | undefined) => {
                    if (date) {
                      const val = date.toLocaleDateString('en-CA');
                      setStartDate(val);
                      if (endDate === startDate) setEndDate(val);
                    }
                    setStartDateOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>
          <div>
            <label style={labelStyle}>Start Time</label>
            <Input
              type="time"
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>

        {/* End date + time */}
        <div style={{ ...sectionStyle, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <label style={labelStyle}>End Date</label>
            <Popover open={endDateOpen} onOpenChange={setEndDateOpen}>
              <PopoverTrigger asChild>
                <button type="button" style={{ ...inputStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                  {endDate || 'Select date'}
                  <ChevronDownIcon style={{ width: '14px', height: '14px', flexShrink: 0 }} />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto overflow-hidden p-0" align="start">
                <Calendar
                  mode="single"
                  selected={endDate ? new Date(endDate + 'T00:00:00') : undefined}
                  captionLayout="dropdown"
                  onSelect={(date: Date | undefined) => {
                    if (date) setEndDate(date.toLocaleDateString('en-CA'));
                    setEndDateOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>
          <div>
            <label style={labelStyle}>End Time</label>
            <Input
              type="time"
              value={endTime}
              onChange={e => setEndTime(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>

        {/* Timezone note */}
        <div style={{ marginBottom: '16px', fontSize: '11px', color: 'var(--foreground-muted)' }}>
          Times are in {getUserTz(userId)}
        </div>

        {/* Recurrence toggle */}
        {!isEdit && (
          <div style={{ ...sectionStyle, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Checkbox
              id="recurring-toggle"
              checked={isRecurring}
              onCheckedChange={(checked) => setIsRecurring(checked === true)}
            />
            <label htmlFor="recurring-toggle" style={{ ...labelStyle, marginBottom: 0, cursor: 'pointer' }}>
              Recurring shift
            </label>
          </div>
        )}

        {/* Recurrence options */}
        {isRecurring && (
          <div
            style={{
              background: 'var(--sidebar-background)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              padding: '14px',
              marginBottom: '14px',
            }}
          >
            {/* Frequency + interval */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: '10px', marginBottom: '12px' }}>
              <div>
                <label style={labelStyle}>Frequency</label>
                <select
                  value={frequency}
                  onChange={e => setFrequency(e.target.value as RecurrenceFrequency)}
                  style={inputStyle}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Every</label>
                <Input
                  type="number"
                  min={1}
                  max={99}
                  value={interval}
                  onChange={e => setInterval(Math.max(1, parseInt(e.target.value) || 1))}
                  style={inputStyle}
                />
              </div>
            </div>

            {/* Days of week (weekly only) */}
            {frequency === 'weekly' && (
              <div style={{ marginBottom: '12px' }}>
                <label style={labelStyle}>Repeat on</label>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {DAY_LABELS.map((label, dow) => {
                    const selected = daysOfWeek.includes(dow);
                    return (
                      <button
                        key={dow}
                        type="button"
                        onClick={() => setDaysOfWeek(
                          selected
                            ? daysOfWeek.filter(d => d !== dow)
                            : [...daysOfWeek, dow],
                        )}
                        style={{
                          padding: '4px 8px',
                          borderRadius: '5px',
                          border: '1px solid var(--border-subtle)',
                          background: selected ? 'var(--foreground)' : 'transparent',
                          color: selected ? 'var(--background)' : 'var(--foreground-secondary)',
                          fontSize: '12px',
                          cursor: 'pointer',
                          fontWeight: selected ? 600 : 400,
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* End condition */}
            <div>
              <label style={labelStyle}>Ends</label>
              <RadioGroup
                value={endCondition}
                onValueChange={(value) => setEndCondition(value as typeof endCondition)}
                style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <RadioGroupItem value="none" id="end-none" />
                  <Label htmlFor="end-none" style={{ fontSize: '13px', color: 'var(--foreground)', cursor: 'pointer' }}>Never</Label>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <RadioGroupItem value="date" id="end-date" />
                  <Label htmlFor="end-date" style={{ fontSize: '13px', color: 'var(--foreground)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    On date
                    <Popover open={recurEndOpen} onOpenChange={setRecurEndOpen}>
                      <PopoverTrigger asChild>
                        <button type="button" style={{ ...inputStyle, width: 'auto', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', cursor: 'pointer' }}>
                          {recurEndDate || 'Select date'}
                          <ChevronDownIcon style={{ width: '14px', height: '14px', flexShrink: 0 }} />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto overflow-hidden p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={recurEndDate ? new Date(recurEndDate + 'T00:00:00') : undefined}
                          captionLayout="dropdown"
                          onSelect={(date: Date | undefined) => {
                            if (date) setRecurEndDate(date.toLocaleDateString('en-CA'));
                            setRecurEndOpen(false);
                          }}
                        />
                      </PopoverContent>
                    </Popover>
                  </Label>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <RadioGroupItem value="count" id="end-count" />
                  <Label htmlFor="end-count" style={{ fontSize: '13px', color: 'var(--foreground)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    After
                    <Input
                      type="number"
                      min={1}
                      max={999}
                      value={count}
                      onChange={e => setCount(Math.max(1, parseInt(e.target.value) || 1))}
                      style={{ ...inputStyle, width: '70px' }}
                    />
                    occurrences
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            marginBottom: '12px',
            padding: '8px 12px',
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: '6px',
            fontSize: '13px',
            color: '#ef4444',
          }}>
            {error}
          </div>
        )}

        {/* Save dialogue (recurring edit) */}
        {showSaveDialogue && (
          <div style={{
            marginBottom: '14px',
            padding: '14px',
            background: 'var(--sidebar-background)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
          }}>
            <p style={{ fontSize: '13px', marginBottom: '10px', color: 'var(--foreground)' }}>
              This is a recurring shift. Which occurrences do you want to update?
            </p>
            <button style={dialogueOptionStyle} onClick={() => handleSave('single')} disabled={saving}>
              This occurrence only
            </button>
            <button style={dialogueOptionStyle} onClick={() => handleSave('future')} disabled={saving}>
              This and all future occurrences
            </button>
            <button style={{ ...dialogueOptionStyle, border: 'none', color: 'var(--foreground-muted)', background: 'transparent' }}
              onClick={() => setShowSaveDialogue(false)}>
              Cancel
            </button>
          </div>
        )}

        {/* Delete dialogue */}
        {showDeleteDialogue && (
          <div style={{
            marginBottom: '14px',
            padding: '14px',
            background: 'rgba(239,68,68,0.07)',
            border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: '8px',
          }}>
            <p style={{ fontSize: '13px', marginBottom: '10px', color: 'var(--foreground)' }}>
              {isRecurringShift
                ? 'Which occurrences do you want to delete?'
                : 'Are you sure you want to delete this shift?'}
            </p>
            {isRecurringShift ? (
              <>
                <button style={dialogueOptionStyle} onClick={() => handleDelete('single')} disabled={deleting}>
                  This occurrence only
                </button>
                <button style={dialogueOptionStyle} onClick={() => handleDelete('future')} disabled={deleting}>
                  This and all future occurrences
                </button>
                <button style={{ ...dialogueOptionStyle, borderColor: 'rgba(239,68,68,0.4)', color: '#ef4444' }}
                  onClick={() => handleDelete('series')} disabled={deleting}>
                  All occurrences
                </button>
                <button style={{ ...dialogueOptionStyle, border: 'none', color: 'var(--foreground-muted)', background: 'transparent' }}
                  onClick={() => setShowDeleteDialogue(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button variant="destructive" onClick={() => handleDelete('single')} disabled={deleting}>
                  {deleting ? 'Deleting...' : 'Delete'}
                </Button>
                <Button variant="outline" onClick={() => setShowDeleteDialogue(false)}>Cancel</Button>
              </div>
            )}
          </div>
        )}

        {/* Footer buttons */}
        {!showSaveDialogue && !showDeleteDialogue && (
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button onClick={handleSaveClick} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
            </div>

            {isEdit && onDelete && (
              <Button
                variant="destructive"
                onClick={() => setShowDeleteDialogue(true)}
                disabled={deleting}
              >
                Delete
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
