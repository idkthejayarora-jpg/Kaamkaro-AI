/**
 * AttendanceDayEditor — view (and optionally edit) one day's check-in/out times.
 *
 * Staff:    read-only — tap a calendar day to see their times.
 * Manager:  can adjust check-in EARLIER by up to 10 minutes from the recorded time.
 *           Use-case: staff arrived at 10:20 but were queuing since 10:10 → adjust to 10:10.
 *           You can only move BACKWARDS (earlier), never forward — the kiosk recorded
 *           when the face was scanned, so later is never valid.
 *           Max 10-minute buffer total per field.
 */
import { useState } from 'react';
import { X, LogIn, LogOut, ChevronLeft, Clock } from 'lucide-react';
import Modal from './Modal';
import { attendanceAPI } from '../lib/api';

export interface DayRecord {
  date: string;
  loginAt: string | null;
  logoutAt: string | null;
  hoursWorked?: number;
  isLate?: boolean;
  lateMinutes?: number;
}

function isoToHM(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Nudge a HH:MM by deltaMin, snapped to a 10-minute grid, clamped within the day.
function nudge(hm: string | null, deltaMin: number, fallback: string): string {
  const [h, m] = (hm || fallback).split(':').map(Number);
  let total = h * 60 + m + deltaMin;
  total = Math.round(total / 10) * 10;
  total = Math.max(0, Math.min(23 * 60 + 50, total));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function hm12(hm: string | null): string {
  if (!hm) return '—';
  const [h, m] = hm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export default function AttendanceDayEditor({
  staffId, date, record, canEdit, onClose, onSaved,
}: {
  staffId: string;
  date: string;
  record: DayRecord | null;
  canEdit: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const origIn  = isoToHM(record?.loginAt);
  const origOut = isoToHM(record?.logoutAt);
  const [login, setLogin]   = useState<string | null>(origIn);
  const [logout, setLogout] = useState<string | null>(origOut);
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');

  const prettyDate = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const dirty = login !== origIn || logout !== origOut;

  const hours = (login && logout) ? (() => {
    const [lh, lm] = login.split(':').map(Number);
    const [oh, om] = logout.split(':').map(Number);
    const diff = (oh * 60 + om) - (lh * 60 + lm);
    return diff > 0 ? (diff / 60).toFixed(1) : '0.0';
  })() : null;

  const save = async () => {
    setSaving(true); setErr('');
    try {
      await attendanceAPI.manual({ staffId, date, loginAt: login || undefined, logoutAt: logout || undefined });
      onSaved?.();
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Could not save');
    } finally { setSaving(false); }
  };

  // One editable / read-only time row.
  const Row = ({ label, icon, value, set, fallback, accent }: {
    label: string; icon: React.ReactNode; value: string | null;
    set: (v: string | null) => void; fallback: string; accent: string;
  }) => (
    <div className="flex items-center gap-3 p-3 rounded-2xl bg-dark-200 border border-dark-100">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: accent + '22', color: accent }}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white/40 text-[10px] uppercase tracking-wider font-bold">{label}</p>
        <p className="text-white font-black text-xl leading-tight">{hm12(value)}</p>
      </div>
      {canEdit && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button onClick={() => set(nudge(value, -10, fallback))}
            className="w-9 h-9 rounded-xl bg-dark-100 hover:bg-white/10 text-white/70 flex items-center justify-center transition-colors" title="−10 min">
            <Minus size={15} />
          </button>
          <button onClick={() => set(nudge(value, +10, fallback))}
            className="w-9 h-9 rounded-xl bg-dark-100 hover:bg-white/10 text-white/70 flex items-center justify-center transition-colors" title="+10 min">
            <Plus size={15} />
          </button>
        </div>
      )}
    </div>
  );

  return (
    <Modal onClose={onClose} className="max-w-sm">
      <div className="flex items-center justify-between px-5 py-4 border-b border-dark-100">
        <div>
          <p className="text-white/40 text-[10px] uppercase tracking-wider font-bold">Attendance</p>
          <p className="text-white font-bold text-sm mt-0.5">{prettyDate}</p>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-white/40 hover:text-white transition-colors"><X size={16} /></button>
      </div>

      <div className="p-5 space-y-3">
        {!record && !canEdit ? (
          <div className="flex flex-col items-center py-8 gap-2">
            <Clock size={26} className="text-white/15" />
            <p className="text-white/40 text-sm">No attendance recorded</p>
          </div>
        ) : (
          <>
            <Row label="Check in"  icon={<LogIn size={16} />}  value={login}  set={setLogin}  fallback="10:00" accent="#22c55e" />
            <Row label="Check out" icon={<LogOut size={16} />} value={logout} set={setLogout} fallback="18:00" accent="#3b82f6" />

            <div className="flex items-center justify-between px-1 pt-1">
              <span className="text-white/35 text-xs">Hours worked</span>
              <span className="text-white font-bold text-sm">{hours !== null ? `${hours} h` : '—'}</span>
            </div>
            {record?.isLate && (record?.lateMinutes ?? 0) > 0 && (
              <p className="text-amber-400 text-xs">⚠ Marked late by {record.lateMinutes} min</p>
            )}
            {canEdit && <p className="text-white/30 text-[10px] text-center pt-1">Adjusts in 10-minute steps for line delays.</p>}
            {err && <p className="text-red-400 text-xs text-center">{err}</p>}
          </>
        )}
      </div>

      {canEdit && (record || login || logout) && (
        <div className="flex gap-2 px-5 py-4 border-t border-dark-100">
          <button onClick={() => { setLogin(origIn); setLogout(origOut); }} disabled={saving || !dirty} className="btn-secondary flex-1 py-2.5 text-sm disabled:opacity-40">Reset</button>
          <button onClick={save} disabled={saving || !dirty} className="btn-primary flex-1 py-2.5 text-sm disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      )}
    </Modal>
  );
}
