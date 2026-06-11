/**
 * AttendanceDayEditor — view / edit one day's check-in & check-out times.
 *
 * Three levels of access:
 *   • Staff (read-only)     — just see the times.
 *   • Nudge (manager always) — move an EXISTING time earlier by up to 10 min
 *                              (queue/rain buffer). No grant needed.
 *   • Full edit (admin, or  — set any time freely and ENTER times for days the
 *     manager-when-granted)    kiosk missed, from the physical register.
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

const BUFFER_MINS = 10; // max minutes a non-granted manager can move a time earlier

function isoToHM(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
const hmToMins = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const minsToHM = (t: number) => { const x = Math.max(0, Math.min(23 * 60 + 59, t)); return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
function hm12(hm: string | null): string {
  if (!hm) return '—';
  const [h, m] = hm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// One row: full-edit shows a free time input; nudge-only shows a ≤10-min ← button.
// IMPORTANT: defined at module scope (NOT inside AttendanceDayEditor). When it was
// declared inside the component it became a new function type on every render, so
// React unmounted/remounted the <input type="time"> on every keystroke and on every
// parent re-render (e.g. the 60s edit-grant poll) — the field lost focus and the
// native picker dismissed mid-entry, which read as the editor "glitching".
function Row({ label, icon, value, orig, set, accent, backBy, canFullEdit, canNudge }: {
  label: string; icon: React.ReactNode; value: string | null; orig: string | null;
  set: (v: string | null) => void; accent: string; backBy: number;
  canFullEdit: boolean; canNudge: boolean;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-2xl bg-dark-200 border border-dark-100">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: accent + '22', color: accent }}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white/40 text-[10px] uppercase tracking-wider font-bold">{label}</p>
        {canFullEdit ? (
          <input
            type="time"
            value={value || ''}
            onChange={e => set(e.target.value || null)}
            className="bg-transparent text-white font-black text-xl leading-tight outline-none w-full mt-0.5"
          />
        ) : (
          <p className="text-white font-black text-xl leading-tight">{hm12(value)}</p>
        )}
        {backBy > 0 && <p className="text-amber-400/70 text-[10px] mt-0.5">−{backBy} min from {hm12(orig)}</p>}
      </div>
      {/* Nudge-only: ≤10-min earlier on an existing time (no grant needed) */}
      {!canFullEdit && canNudge && orig != null && (
        <div className="flex flex-col items-center gap-1 flex-shrink-0">
          <button
            onClick={() => set(minsToHM(hmToMins(value || orig) - 1))}
            disabled={backBy >= BUFFER_MINS}
            className="w-9 h-9 rounded-xl bg-dark-100 hover:bg-white/10 text-white/70 flex items-center justify-center transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
            title={backBy >= BUFFER_MINS ? 'Max 10-min buffer' : 'Move 1 min earlier'}
          >
            <ChevronLeft size={15} />
          </button>
          <span className="text-[9px] text-white/25 font-semibold">{BUFFER_MINS - backBy} left</span>
        </div>
      )}
    </div>
  );
}

export default function AttendanceDayEditor({
  staffId, date, record, canFullEdit, canNudge, onClose, onSaved,
}: {
  staffId: string;
  date: string;
  record: DayRecord | null;
  canFullEdit: boolean;   // admin, or manager while an edit grant is active
  canNudge: boolean;      // manager/admin — ≤10-min earlier on existing times, always
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

  const loginBackBy  = origIn  && login  ? hmToMins(origIn)  - hmToMins(login)  : 0;
  const logoutBackBy = origOut && logout ? hmToMins(origOut) - hmToMins(logout) : 0;

  const hours = (login && logout) ? (() => {
    const diff = hmToMins(logout) - hmToMins(login);
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

  // No record + can't enter (staff, or manager without grant) → nothing to show/do.
  const nothingToShow = !record && !canFullEdit;

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
        {nothingToShow ? (
          <div className="flex flex-col items-center py-8 gap-2">
            <Clock size={26} className="text-white/15" />
            <p className="text-white/40 text-sm">No attendance recorded</p>
            {canNudge && <p className="text-white/25 text-[11px] text-center">Ask an admin to grant edit access to enter times.</p>}
          </div>
        ) : (
          <>
            <Row label="Check in"  icon={<LogIn size={16} />}  value={login}  orig={origIn}  set={setLogin}  accent="#22c55e" backBy={loginBackBy}  canFullEdit={canFullEdit} canNudge={canNudge} />
            <Row label="Check out" icon={<LogOut size={16} />} value={logout} orig={origOut} set={setLogout} accent="#3b82f6" backBy={logoutBackBy} canFullEdit={canFullEdit} canNudge={canNudge} />

            <div className="flex items-center justify-between px-1 pt-1">
              <span className="text-white/35 text-xs">Hours worked</span>
              <span className="text-white font-bold text-sm">{hours !== null ? `${hours} h` : '—'}</span>
            </div>
            {record?.isLate && (record?.lateMinutes ?? 0) > 0 && (
              <p className="text-amber-400 text-xs">⚠ Marked late by {record.lateMinutes} min</p>
            )}
            {canFullEdit ? (
              <div className="rounded-xl bg-dark-100 px-3 py-2 text-[10px] text-white/40 leading-relaxed">
                Full edit access — set any check-in/out time from the physical register. Leave a field blank to clear it.
              </div>
            ) : canNudge && (origIn || origOut) ? (
              <div className="rounded-xl bg-dark-100 px-3 py-2 text-[10px] text-white/35 leading-relaxed">
                ← Moves a time <b className="text-white/55">earlier only</b>, up to 10 min (queue/rain buffer). For bigger changes, ask an admin for edit access.
              </div>
            ) : null}
            {err && <p className="text-red-400 text-xs text-center">{err}</p>}
          </>
        )}
      </div>

      {(canFullEdit || canNudge) && !nothingToShow && (
        <div className="flex gap-2 px-5 py-4 border-t border-dark-100">
          <button onClick={() => { setLogin(origIn); setLogout(origOut); }} disabled={saving || !dirty} className="btn-secondary flex-1 py-2.5 text-sm disabled:opacity-40">Reset</button>
          <button onClick={save} disabled={saving || !dirty} className="btn-primary flex-1 py-2.5 text-sm disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      )}
    </Modal>
  );
}
