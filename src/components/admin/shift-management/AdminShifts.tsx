'use client';

import { useState, useMemo } from 'react';
import { useShifts, getMondayOfWeek, todayStr } from '@/hooks/useShifts';
import type { ShiftUser, CreateShiftPayload, UpdateShiftPayload } from '@/hooks/useShifts';
import type { ExpandedShift } from '@/lib/utils/recurrence';
import ShiftCard from './ShiftCard';
import ShiftModal from './ShiftModal';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

const AVATAR_COLORS = [
  '#E57373', '#F06292', '#BA68C8', '#7986CB', '#64B5F6',
  '#4DD0E1', '#4DB6AC', '#81C784', '#FFB74D', '#A1887F',
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

function getAvatarColor(name: string): string {
  return AVATAR_COLORS[hashString(name) % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  if (!name?.trim()) return '?';
  return name.split(' ').map((p) => p[0]).filter(Boolean).join('').toUpperCase().slice(0, 2) || '?';
}
import { RefreshCcw, ChevronDownIcon } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// ─── Helpers ─────────────────────────────────────────────────────────

/** Returns an array of 7 "YYYY-MM-DD" strings starting from `mondayStr`. */
function getWeekDays(mondayStr: string): string[] {
  const [y, m, d] = mondayStr.split('-').map(Number);
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    return dt.toISOString().slice(0, 10);
  });
}

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function toLocalDateStr(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms));
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

// ─── Modal state types ───────────────────────────────────────────────

type ModalState =
  | { mode: 'create'; userId: string; date: string }
  | { mode: 'edit';   shift: ExpandedShift };

// ─── Component ───────────────────────────────────────────────────────

export default function AdminShifts() {
  const today      = todayStr();
  const [weekStart, setWeekStart] = useState(() => getMondayOfWeek(today));
  const [weekPickerOpen, setWeekPickerOpen] = useState(false);
  const [groupFilter,    setGroupFilter]    = useState('all');
  const [showUnscheduled, setShowUnscheduled] = useState(true);
  const [modalState,     setModalState]     = useState<ModalState | null>(null);

  const { shifts, users, loading, error, refetch, createShift, updateShift, deleteShift } = useShifts(weekStart);

  const weekDays = getWeekDays(weekStart);

  // ── Filter users ──────────────────────────────────────────────────
  const filteredUsers = useMemo(() => {
    let list = [...users];
    if (groupFilter !== 'all') {
      list = list.filter(u => u.groups.includes(groupFilter));
    }
    if (!showUnscheduled) {
      const usersWithShifts = new Set(shifts.map(s => s.userId));
      list = list.filter(u => usersWithShifts.has(u.uid));
    }
    return list;
  }, [users, shifts, groupFilter, showUnscheduled]);

  // All unique groups across eligible users
  const allGroups = useMemo(() => {
    const gs = new Set<string>();
    users.forEach(u => u.groups.forEach(g => { if (g !== 'unassigned') gs.add(g); }));
    return [...gs].sort();
  }, [users]);

  // ── Map shifts to cells ───────────────────────────────────────────
  const shiftMap = useMemo(() => {
    const map = new Map<string, ExpandedShift[]>();
    for (const shift of shifts) {
      const user = users.find(u => u.uid === shift.userId);
      const tz   = user?.timezone ?? 'UTC';
      const localDate = toLocalDateStr(shift.occurrenceStart, tz);
      const key = `${shift.userId}:${localDate}`;
      const existing = map.get(key) ?? [];
      existing.push(shift);
      map.set(key, existing);
    }
    return map;
  }, [shifts, users]);

  // ── Save handler ──────────────────────────────────────────────────
  async function handleSave(
    shiftId: string | null,
    payload: CreateShiftPayload | UpdateShiftPayload,
    saveMode: 'single' | 'future' | 'all',
  ) {
    if (shiftId) {
      await updateShift(shiftId, payload as UpdateShiftPayload);
    } else {
      await createShift(payload as CreateShiftPayload);
    }
  }

  // ── Delete handler ────────────────────────────────────────────────
  async function handleDelete(shiftId: string, mode: 'single' | 'future' | 'series', overrideDate?: string) {
    await deleteShift(shiftId, mode, overrideDate);
  }

  // ── Toggle styles ─────────────────────────────────────────────────
  const toggleStyle: React.CSSProperties = {
    position: 'relative',
    display: 'inline-block',
    width: '32px',
    height: '18px',
    flexShrink: 0,
  };

  const sliderStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    borderRadius: '18px',
    background: showUnscheduled ? '#4B8FCC' : 'var(--border-subtle)',
    transition: 'background 0.2s',
    cursor: 'pointer',
  };

  const knobStyle: React.CSSProperties = {
    position: 'absolute',
    top: '2px',
    left: showUnscheduled ? '16px' : '2px',
    width: '14px',
    height: '14px',
    borderRadius: '50%',
    background: '#fff',
    transition: 'left 0.2s',
    pointerEvents: 'none',
  };

  // ── Grid styles ───────────────────────────────────────────────────
  const controlStyle: React.CSSProperties = {
    padding: '5px 9px',
    borderRadius: '6px',
    border: '1px solid var(--border-subtle)',
    background: 'transparent',
    color: 'var(--foreground)',
    fontSize: '13px',
    cursor: 'pointer',
  };

  const headerCellStyle: React.CSSProperties = {
    padding: '6px 8px',
    borderBottom: '1px solid var(--border-subtle)',
    borderRight: '1px solid rgba(255,255,255,0.07)',
    fontSize: '11px',
    fontWeight: 600,
    color: 'var(--foreground-secondary)',
    textAlign: 'center',
    whiteSpace: 'nowrap',
    background: 'rgba(0,0,0,0.15)',
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
  };

  const cellStyle: React.CSSProperties = {
    borderRight: '1px solid rgba(255,255,255,0.06)',
    padding: '4px 5px',
    verticalAlign: 'top',
    minWidth: '130px',
    cursor: 'pointer',
  };

  return (
    <div>
      {/* ── Toolbar ────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>

        {/* Week navigation group */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(addDays(weekStart, -7))}>←</Button>
          <Popover open={weekPickerOpen} onOpenChange={setWeekPickerOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" style={{ fontWeight: 'normal', fontSize: '13px', gap: '4px' }}>
                {weekStart}
                <ChevronDownIcon style={{ width: '12px', height: '12px' }} />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto overflow-hidden p-0" align="start">
              <Calendar
                mode="single"
                selected={weekStart ? new Date(weekStart + 'T00:00:00') : undefined}
                captionLayout="dropdown"
                onSelect={(date: Date | undefined) => {
                  if (date) setWeekStart(getMondayOfWeek(date.toLocaleDateString('en-CA')));
                  setWeekPickerOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(addDays(weekStart, 7))}>→</Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekStart(getMondayOfWeek(today))}
            style={{ color: 'var(--foreground-secondary)', fontSize: '12px' }}
          >
            Today
          </Button>
        </div>

        {/* Divider */}
        <div style={{ width: '1px', height: '20px', background: 'var(--border-subtle)', flexShrink: 0 }} />

        {/* Group filter */}
        <select
          value={groupFilter}
          onChange={e => setGroupFilter(e.target.value)}
          style={{ ...controlStyle, background: 'var(--sidebar-background)' }}
        >
          <option value="all">All Groups</option>
          {allGroups.map(g => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>

        {/* Show Unscheduled toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <span style={{ fontSize: '12px', color: 'var(--foreground-secondary)', whiteSpace: 'nowrap' }}>
            Show Unscheduled
          </span>
          <div style={toggleStyle} onClick={() => setShowUnscheduled(v => !v)}>
            <div style={sliderStyle} />
            <div style={knobStyle} />
          </div>
        </div>

        {/* Refresh icon button — pushed to far right */}
        <Button
          onClick={refetch}
          title="Refresh"
          variant="outline"
          size="icon"
          style={{ marginLeft: 'auto' }}
        >
          <RefreshCcw style={{ width: '14px', height: '14px', opacity: 0.7 }} />
        </Button>
      </div>

      {/* ── Loading / error ────────────────────────────────────────── */}
      {loading && (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--foreground-muted)', fontSize: '13px' }}>
          Loading shifts...
        </div>
      )}
      {error && (
        <div style={{ padding: '12px', background: 'rgba(239,68,68,0.1)', borderRadius: '8px', color: '#ef4444', fontSize: '13px', marginBottom: '12px' }}>
          {error}
        </div>
      )}

      {/* ── Calendar grid ─────────────────────────────────────────── */}
      {!loading && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                {/* Employee column header */}
                <th style={{ ...headerCellStyle, width: '150px', textAlign: 'left', paddingLeft: '10px' }}>
                  Employee
                </th>
                {weekDays.map((day, i) => {
                  const isToday = day === today;
                  const dateLabel = new Date(Date.UTC(...(day.split('-').map(Number) as [number, number, number])))
                    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
                  return (
                    <th
                      key={day}
                      style={{
                        ...headerCellStyle,
                        color: isToday ? 'var(--foreground)' : 'var(--foreground-secondary)',
                        borderBottom: isToday ? '2px solid var(--foreground)' : '1px solid var(--border-subtle)',
                        background: isToday ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.15)',
                      }}
                    >
                      {DAY_SHORT[i]}
                      <span style={{ display: 'block', fontSize: '10px', fontWeight: 400, marginTop: '1px', textTransform: 'none', letterSpacing: 0 }}>
                        {dateLabel}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: 'var(--foreground-muted)', fontSize: '13px' }}>
                    No employees to display.
                  </td>
                </tr>
              )}
              {filteredUsers.map(user => (
                <tr key={user.uid} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {/* User cell */}
                  <td style={{ padding: '6px 10px', verticalAlign: 'middle', borderRight: '1px solid rgba(255,255,255,0.06)', height: '52px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                      <Avatar className="size-7" style={{ background: getAvatarColor(user.displayName || 'User') }}>
                        {user.photoURL && <AvatarImage src={user.photoURL} alt={user.displayName} />}
                        <AvatarFallback style={{ background: getAvatarColor(user.displayName || 'User'), color: '#fff' }}>
                          {getInitials(user.displayName)}
                        </AvatarFallback>
                      </Avatar>
                      <span style={{ fontSize: '12px', fontWeight: 400, color: 'var(--foreground)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                        {user.displayName}
                      </span>
                    </div>
                  </td>

                  {/* Day cells */}
                  {weekDays.map(day => {
                    const key       = `${user.uid}:${day}`;
                    const dayShifts = shiftMap.get(key) ?? [];
                    const isToday   = day === today;

                    return (
                      <td
                        key={day}
                        style={{
                          ...cellStyle,
                          background: isToday ? 'rgba(255,255,255,0.025)' : 'transparent',
                          height: '52px',
                        }}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest('[data-shift-card]')) return;
                          setModalState({ mode: 'create', userId: user.uid, date: day });
                        }}
                      >
                        {dayShifts.map(shift => (
                          <div key={shift.shiftId + shift.occurrenceStart} data-shift-card>
                            <ShiftCard
                              shift={shift}
                              user={user}
                              onClick={() => setModalState({ mode: 'edit', shift })}
                            />
                          </div>
                        ))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modal ─────────────────────────────────────────────────── */}
      {modalState && (
        <ShiftModal
          mode={modalState.mode}
          shift={modalState.mode === 'edit' ? modalState.shift : undefined}
          prefillUserId={modalState.mode === 'create' ? modalState.userId : undefined}
          prefillDate={modalState.mode === 'create' ? modalState.date : undefined}
          users={users}
          onSave={handleSave}
          onDelete={modalState.mode === 'edit' ? handleDelete : undefined}
          onClose={() => setModalState(null)}
        />
      )}
    </div>
  );
}
