/**
 * AttendancePortal — isolated portal for the attendance_manager role.
 * Has its own minimal top-nav layout (no sidebar).
 * Tabs: Today | Monthly | Staff | Settings
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock, Calendar, Users, Settings, MonitorSmartphone, RefreshCw,
  CheckCircle2, AlertTriangle, XCircle, ChevronLeft, ChevronRight,
  Camera, Trash2, Eye, EyeOff, Save, LogOut,
} from 'lucide-react';
import * as faceapi from '@vladmandic/face-api';
import { attendanceAPI, staffAPI, kioskAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

// ── Types ──────────────────────────────────────────────────────────────────────

interface TodayRecord {
  staffId: string; staffName: string; avatar: string;
  status: 'in' | 'out' | 'absent';
  loginAt: string | null; logoutAt: string | null;
  isLate: boolean; lateMinutes: number; hoursWorked: number;
  faceEnrolled: boolean;
}

interface MonthlyStaff {
  staffId: string; staffName: string; avatar: string; faceEnrolled: boolean;
  presentDays: number; lateDays: number; totalHours: number;
  overtimeHours: number; undertimeHours: number;
  dailyMap: Record<string, string>;
  totalDays: number;
}

interface StaffMember {
  id: string; name: string; avatar: string; active: boolean;
  faceDescriptors?: number[][];
}

interface AttendanceCfg {
  shiftStart: string; shiftEnd: string; lateGraceMins: number;
  expectedHours: number; kioskPin: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  return (
    <div
      className="rounded-xl bg-dark-200 border border-dark-100 flex items-center justify-center flex-shrink-0 font-bold text-white/60"
      style={{ width: size, height: size, fontSize: size * 0.35 }}
    >
      {initials}
    </div>
  );
}

function StatusChip({ status }: { status: 'in' | 'out' | 'absent' }) {
  if (status === 'in')     return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/25">● In</span>;
  if (status === 'out')    return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/12 text-blue-400 border border-blue-500/20">● Out</span>;
  return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/6 text-white/30 border border-white/10">Absent</span>;
}

function fmt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// ── Face Enroll Modal ──────────────────────────────────────────────────────────

function FaceEnrollModal({ staff, onClose, onEnrolled }: {
  staff: StaffMember;
  onClose: () => void;
  onEnrolled: () => void;
}) {
  const videoRef   = useRef<HTMLVideoElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);
  const [modelReady, setModelReady]   = useState(false);
  const [capturing,  setCapturing]    = useState(false);
  const [captures,   setCaptures]     = useState<Float32Array[]>([]);
  const [status,     setStatus]       = useState('Loading face models…');
  const [saving,     setSaving]       = useState(false);
  const TOTAL = 5;

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        setStatus('Loading face models…');
        const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        ]);
        if (cancelled) return;

        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 480, height: 360 } });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        if (!cancelled) { setModelReady(true); setStatus('Face detected — click Start Capture'); }
      } catch (e) {
        if (!cancelled) setStatus('Camera access denied or models unavailable.');
      }
    }
    init();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  const startCapture = useCallback(async () => {
    if (!videoRef.current || !modelReady) return;
    setCapturing(true);
    setCaptures([]);
    const collected: Float32Array[] = [];

    for (let i = 0; i < TOTAL; i++) {
      setStatus(`Capturing ${i + 1} of ${TOTAL}… hold still`);
      await new Promise(r => setTimeout(r, 600));
      const det = await faceapi.detectSingleFace(
        videoRef.current, new faceapi.TinyFaceDetectorOptions()
      ).withFaceLandmarks(true).withFaceDescriptor();

      if (!det) { setStatus(`No face detected — try again`); i--; await new Promise(r => setTimeout(r, 400)); continue; }
      collected.push(det.descriptor);
      setCaptures([...collected]);
    }

    setStatus('Captured! Click Save to enroll.');
    setCapturing(false);
  }, [modelReady]);

  const save = async () => {
    if (captures.length < TOTAL) return;
    setSaving(true);
    try {
      // Average the descriptors for robustness
      const averaged = new Float32Array(128);
      for (let j = 0; j < 128; j++) {
        averaged[j] = captures.reduce((s, d) => s + d[j], 0) / captures.length;
      }
      await staffAPI.enrollFace(staff.id, [Array.from(averaged)]);
      onEnrolled();
      onClose();
    } catch {
      setStatus('Save failed — try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-dark-400 border border-dark-50 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-50">
          <div>
            <p className="text-white font-semibold">📸 Enroll Face</p>
            <p className="text-white/40 text-xs mt-0.5">{staff.name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-dark-200 text-white/30 hover:text-white transition-colors">
            <XCircle size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Camera preview */}
          <div className="relative rounded-xl overflow-hidden bg-dark-500 aspect-[4/3]">
            <video ref={videoRef} muted playsInline className="w-full h-full object-cover" />
            {!modelReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-dark-500/80">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-6 h-6 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                  <p className="text-white/40 text-xs">Loading…</p>
                </div>
              </div>
            )}
          </div>

          {/* Progress dots */}
          <div className="flex items-center justify-center gap-2">
            {Array.from({ length: TOTAL }).map((_, i) => (
              <div
                key={i}
                className="w-3 h-3 rounded-full transition-all duration-300"
                style={{ background: i < captures.length ? '#D4AF37' : 'rgba(255,255,255,0.1)' }}
              />
            ))}
          </div>

          <p className="text-white/50 text-sm text-center">{status}</p>

          <div className="flex gap-3">
            {captures.length < TOTAL ? (
              <button
                onClick={startCapture}
                disabled={!modelReady || capturing}
                className="flex-1 py-2.5 rounded-xl bg-gold/15 border border-gold/30 text-gold text-sm font-semibold hover:bg-gold/20 transition-colors disabled:opacity-40"
              >
                {capturing ? 'Capturing…' : 'Start Capture'}
              </button>
            ) : (
              <button
                onClick={save}
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-green-500/15 border border-green-500/30 text-green-400 text-sm font-semibold hover:bg-green-500/20 transition-colors disabled:opacity-40"
              >
                {saving ? 'Saving…' : '✓ Save Enrollment'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tab: Today ─────────────────────────────────────────────────────────────────

function TodayTab() {
  const [records, setRecords] = useState<TodayRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRecords(await attendanceAPI.today()); } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const present = records.filter(r => r.status !== 'absent').length;
  const late    = records.filter(r => r.isLate).length;
  const absent  = records.filter(r => r.status === 'absent').length;
  const inNow   = records.filter(r => r.status === 'in').length;

  return (
    <div className="space-y-5">
      {/* Summary tiles */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Present', val: present, color: 'text-green-400', bg: 'bg-green-500/8' },
          { label: 'Currently In', val: inNow, color: 'text-emerald-400', bg: 'bg-emerald-500/8' },
          { label: 'Late', val: late, color: 'text-amber-400', bg: 'bg-amber-500/8' },
          { label: 'Absent', val: absent, color: 'text-red-400', bg: 'bg-red-500/8' },
        ].map(t => (
          <div key={t.label} className={`${t.bg} rounded-2xl border border-dark-50 px-4 py-3 text-center`}>
            <p className={`text-2xl font-black ${t.color}`}>{t.val}</p>
            <p className="text-white/40 text-xs mt-0.5">{t.label}</p>
          </div>
        ))}
      </div>

      {/* Refresh */}
      <div className="flex items-center justify-between">
        <p className="text-white/40 text-xs">Auto-updates every 60 seconds</p>
        <button onClick={load} className="p-1.5 rounded-lg hover:bg-dark-200 text-white/30 hover:text-white transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Late alerts */}
      {late > 0 && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-2">
          <p className="text-amber-400 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
            <AlertTriangle size={12} /> Late Arrivals
          </p>
          {records.filter(r => r.isLate).map(r => (
            <div key={r.staffId} className="flex items-center gap-3">
              <Avatar name={r.staffName} size={28} />
              <p className="text-white/70 text-sm flex-1">{r.staffName}</p>
              <p className="text-amber-400 text-xs font-semibold">{r.lateMinutes} min late</p>
              <p className="text-white/30 text-xs">{fmt(r.loginAt)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Staff list */}
      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 rounded-2xl bg-dark-400 animate-pulse" />)}</div>
      ) : (
        <div className="space-y-2">
          {records.map(r => (
            <div key={r.staffId} className="bg-dark-400 border border-dark-50 rounded-2xl px-4 py-3 flex items-center gap-3">
              {/* Status dot */}
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${r.status === 'in' ? 'bg-green-400' : r.status === 'out' ? 'bg-blue-400' : 'bg-dark-100'}`} />
              <Avatar name={r.staffName} size={36} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-white font-semibold text-sm">{r.staffName}</p>
                  <StatusChip status={r.status} />
                  {r.isLate && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">+{r.lateMinutes}m late</span>}
                </div>
                <p className="text-white/30 text-xs mt-0.5">
                  {r.loginAt ? `In: ${fmt(r.loginAt)}` : 'Not checked in'}
                  {r.logoutAt ? ` · Out: ${fmt(r.logoutAt)}` : ''}
                  {r.hoursWorked > 0 ? ` · ${r.hoursWorked.toFixed(1)}h` : ''}
                </p>
              </div>
              {!r.faceEnrolled && (
                <span className="text-[10px] text-white/20 border border-white/10 px-1.5 py-0.5 rounded-full">No face</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tab: Monthly ───────────────────────────────────────────────────────────────

function MonthlyTab() {
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [data,  setData]  = useState<{ month: string; expectedHours: number; staff: MonthlyStaff[] } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    try { setData(await attendanceAPI.monthly(m)); } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(month); }, [month, load]);

  const shiftMonth = (dir: -1 | 1) => {
    const [y, m2] = month.split('-').map(Number);
    const d = new Date(y, m2 - 1 + dir, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const lastDay = data ? Object.keys(data.staff[0]?.dailyMap || {}).length > 0
    ? Math.max(...Object.keys(data.staff[0].dailyMap).map(Number), 0)
    : new Date(parseInt(month.split('-')[0]), parseInt(month.split('-')[1]), 0).getDate()
    : 31;

  const days = Array.from({ length: lastDay }, (_, i) => String(i + 1).padStart(2, '0'));

  const cellColor = (val?: string) => {
    if (!val || val === 'absent') return 'bg-red-500/15 text-red-500/50';
    if (val === 'late') return 'bg-amber-500/20 text-amber-400';
    if (val === 'present') return 'bg-green-500/15 text-green-400';
    return 'bg-dark-200 text-white/10';
  };

  const cellLabel = (val?: string) => {
    if (!val) return '';
    if (val === 'absent') return 'A';
    if (val === 'late') return 'L';
    if (val === 'present') return '✓';
    return '';
  };

  return (
    <div className="space-y-5">
      {/* Month selector */}
      <div className="flex items-center gap-3">
        <button onClick={() => shiftMonth(-1)} className="p-2 rounded-xl hover:bg-dark-200 text-white/40 hover:text-white transition-colors"><ChevronLeft size={16} /></button>
        <p className="text-white font-semibold flex-1 text-center">
          {new Date(month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
        </p>
        <button onClick={() => shiftMonth(1)} className="p-2 rounded-xl hover:bg-dark-200 text-white/40 hover:text-white transition-colors"><ChevronRight size={16} /></button>
        <button onClick={() => load(month)} className="p-2 rounded-xl hover:bg-dark-200 text-white/30 hover:text-white transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 rounded-xl bg-dark-400 animate-pulse" />)}</div>
      ) : data && (
        <>
          {/* Summary totals */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Total Hours', val: `${data.staff.reduce((s,r) => s + r.totalHours, 0).toFixed(0)}h`, color: 'text-white' },
              { label: 'Overtime', val: `${data.staff.reduce((s,r) => s + r.overtimeHours, 0).toFixed(1)}h`, color: 'text-green-400' },
              { label: 'Undertime', val: `${data.staff.reduce((s,r) => s + r.undertimeHours, 0).toFixed(1)}h`, color: 'text-red-400' },
              { label: 'Late Incidents', val: data.staff.reduce((s,r) => s + r.lateDays, 0), color: 'text-amber-400' },
            ].map(t => (
              <div key={t.label} className="bg-dark-400 border border-dark-50 rounded-2xl px-4 py-3 text-center">
                <p className={`text-xl font-black ${t.color}`}>{t.val}</p>
                <p className="text-white/30 text-xs mt-0.5">{t.label}</p>
              </div>
            ))}
          </div>

          {/* Calendar table — scrollable horizontally */}
          <div className="rounded-2xl border border-dark-50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs" style={{ minWidth: Math.max(600, lastDay * 28 + 240) }}>
                <thead>
                  <tr className="bg-dark-500 text-white/30">
                    <th className="text-left px-3 py-2 font-semibold sticky left-0 bg-dark-500 z-10 min-w-[140px]">Staff</th>
                    {days.map(d => <th key={d} className="px-1 py-2 text-center font-normal w-7">{parseInt(d)}</th>)}
                    <th className="px-2 py-2 text-center font-semibold">Days</th>
                    <th className="px-2 py-2 text-center font-semibold">Hrs</th>
                    <th className="px-2 py-2 text-center font-semibold text-green-400/60">OT</th>
                    <th className="px-2 py-2 text-center font-semibold text-red-400/60">UT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-50/30">
                  {data.staff.map(s => (
                    <tr key={s.staffId} className="bg-dark-400 hover:bg-dark-300 transition-colors">
                      <td className="px-3 py-2 sticky left-0 bg-dark-400 z-10">
                        <div className="flex items-center gap-2">
                          <Avatar name={s.staffName} size={24} />
                          <span className="text-white/80 font-medium truncate max-w-[90px]">{s.staffName}</span>
                        </div>
                      </td>
                      {days.map(d => {
                        const val = s.dailyMap[d];
                        return (
                          <td key={d} className="px-0.5 py-1 text-center">
                            <span className={`inline-block w-6 h-6 rounded text-[9px] font-bold flex items-center justify-center ${cellColor(val)}`}>
                              {cellLabel(val)}
                            </span>
                          </td>
                        );
                      })}
                      <td className="px-2 py-2 text-center text-white/60 font-semibold">{s.presentDays}</td>
                      <td className="px-2 py-2 text-center text-white/60">{s.totalHours.toFixed(1)}</td>
                      <td className="px-2 py-2 text-center text-green-400 font-semibold">{s.overtimeHours > 0 ? `+${s.overtimeHours.toFixed(1)}` : '—'}</td>
                      <td className="px-2 py-2 text-center text-red-400 font-semibold">{s.undertimeHours > 0 ? `-${s.undertimeHours.toFixed(1)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 text-xs text-white/30">
            <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-green-500/15 text-green-400 flex items-center justify-center text-[9px] font-bold">✓</span> Present</span>
            <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-amber-500/20 text-amber-400 flex items-center justify-center text-[9px] font-bold">L</span> Late</span>
            <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-red-500/15 text-red-500/50 flex items-center justify-center text-[9px] font-bold">A</span> Absent</span>
          </div>
        </>
      )}
    </div>
  );
}

// ── Tab: Staff ─────────────────────────────────────────────────────────────────

function StaffTab() {
  const [staffList, setStaffList]   = useState<StaffMember[]>([]);
  const [loading,   setLoading]     = useState(true);
  const [enrollFor, setEnrollFor]   = useState<StaffMember | null>(null);
  const [search,    setSearch]      = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { setStaffList(await staffAPI.list()); } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = staffList.filter(s =>
    s.active !== false && s.name.toLowerCase().includes(search.toLowerCase())
  );

  const clearFace = async (id: string) => {
    await staffAPI.clearFace(id);
    load();
  };

  return (
    <div className="space-y-4">
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search staff…"
        className="w-full bg-dark-400 border border-dark-50 rounded-xl px-4 py-2.5 text-white text-sm placeholder-white/20 focus:outline-none focus:border-gold/40"
      />

      {loading ? (
        <div className="space-y-2">{[1,2,3,4].map(i => <div key={i} className="h-16 rounded-2xl bg-dark-400 animate-pulse" />)}</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(s => (
            <div key={s.id} className="bg-dark-400 border border-dark-50 rounded-2xl px-4 py-3 flex items-center gap-3">
              <Avatar name={s.name} size={40} />
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold text-sm">{s.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {s.faceDescriptors?.length ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/12 text-green-400 border border-green-500/20 flex items-center gap-1">
                      <CheckCircle2 size={9} /> Face enrolled
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/6 text-white/30 border border-white/10 flex items-center gap-1">
                      <XCircle size={9} /> No face
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setEnrollFor(s)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-gold/10 border border-gold/25 text-gold hover:bg-gold/15 transition-colors"
                >
                  <Camera size={11} />
                  {s.faceDescriptors?.length ? 'Re-enroll' : 'Enroll'}
                </button>
                {s.faceDescriptors?.length ? (
                  <button
                    onClick={() => clearFace(s.id)}
                    className="p-1.5 rounded-xl text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Clear face data"
                  >
                    <Trash2 size={13} />
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {enrollFor && (
        <FaceEnrollModal
          staff={enrollFor}
          onClose={() => setEnrollFor(null)}
          onEnrolled={() => { load(); setEnrollFor(null); }}
        />
      )}
    </div>
  );
}

// ── Tab: Settings ──────────────────────────────────────────────────────────────

function SettingsTab() {
  const [cfg,     setCfg]     = useState<AttendanceCfg | null>(null);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [showPin, setShowPin] = useState(false);

  useEffect(() => {
    attendanceAPI.config().then(setCfg).catch(() => {});
  }, []);

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      await attendanceAPI.updateConfig(cfg as unknown as Record<string, unknown>);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  if (!cfg) return <div className="h-32 rounded-2xl bg-dark-400 animate-pulse" />;

  return (
    <div className="space-y-5 max-w-lg">
      <div className="bg-dark-400 border border-dark-50 rounded-2xl p-5 space-y-4">
        <p className="text-white font-semibold">Shift Hours</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-white/40 text-xs mb-1 block">Shift Start</label>
            <input type="time" value={cfg.shiftStart}
              onChange={e => setCfg({ ...cfg, shiftStart: e.target.value })}
              className="w-full bg-dark-300 border border-dark-50 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-gold/40"
            />
          </div>
          <div>
            <label className="text-white/40 text-xs mb-1 block">Shift End</label>
            <input type="time" value={cfg.shiftEnd}
              onChange={e => setCfg({ ...cfg, shiftEnd: e.target.value })}
              className="w-full bg-dark-300 border border-dark-50 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-gold/40"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-white/40 text-xs mb-1 block">Late Grace Period (mins)</label>
            <input type="number" min={0} max={60} value={cfg.lateGraceMins}
              onChange={e => setCfg({ ...cfg, lateGraceMins: +e.target.value })}
              className="w-full bg-dark-300 border border-dark-50 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-gold/40"
            />
          </div>
          <div>
            <label className="text-white/40 text-xs mb-1 block">Expected Hours/Day</label>
            <input type="number" min={1} max={24} step={0.5} value={cfg.expectedHours}
              onChange={e => setCfg({ ...cfg, expectedHours: +e.target.value })}
              className="w-full bg-dark-300 border border-dark-50 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-gold/40"
            />
          </div>
        </div>
      </div>

      <div className="bg-dark-400 border border-dark-50 rounded-2xl p-5 space-y-3">
        <p className="text-white font-semibold">Kiosk PIN</p>
        <p className="text-white/30 text-xs">PIN required to unlock the tablet kiosk. Share only with trusted staff.</p>
        <div className="relative">
          <input
            type={showPin ? 'text' : 'password'}
            value={cfg.kioskPin}
            onChange={e => setCfg({ ...cfg, kioskPin: e.target.value })}
            maxLength={8}
            className="w-full bg-dark-300 border border-dark-50 rounded-xl px-3 py-2.5 text-white text-lg tracking-[0.3em] font-mono focus:outline-none focus:border-gold/40 pr-10"
          />
          <button
            onClick={() => setShowPin(!showPin)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
          >
            {showPin ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <a
          href="/kiosk"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dark-50 text-white/50 hover:text-white hover:border-white/20 text-sm transition-colors"
        >
          <MonitorSmartphone size={14} />
          Open Kiosk in New Tab
        </a>
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gold/15 border border-gold/30 text-gold font-semibold text-sm hover:bg-gold/20 transition-colors disabled:opacity-40"
      >
        <Save size={14} />
        {saving ? 'Saving…' : saved ? '✓ Saved!' : 'Save Settings'}
      </button>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

type Tab = 'today' | 'monthly' | 'staff' | 'settings';

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { id: 'today',    label: 'Today',    icon: Clock },
  { id: 'monthly',  label: 'Monthly',  icon: Calendar },
  { id: 'staff',    label: 'Staff',    icon: Users },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function AttendancePortal() {
  const [tab, setTab] = useState<Tab>('today');
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // Redirect non-attendance-managers away
  useEffect(() => {
    if (user && user.role !== 'attendance_manager' && user.role !== 'admin') {
      navigate('/dashboard', { replace: true });
    }
  }, [user, navigate]);

  return (
    <div className="min-h-screen bg-dark-500 flex flex-col">
      {/* Top nav */}
      <header className="bg-dark-400 border-b border-dark-50 px-4 py-3 flex items-center gap-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gold/15 border border-gold/25 flex items-center justify-center">
            <Clock size={14} className="text-gold" />
          </div>
          <span className="text-white font-bold text-sm">Attendance</span>
        </div>

        {/* Tab bar */}
        <nav className="flex items-center gap-1 flex-1 overflow-x-auto">
          {TABS.map(t => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-gold/15 border border-gold/30 text-gold'
                    : 'text-white/40 hover:text-white hover:bg-dark-200'
                }`}
              >
                <Icon size={12} />
                {t.label}
              </button>
            );
          })}
        </nav>

        {/* Kiosk link */}
        <a
          href="/kiosk"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-dark-50 text-white/40 hover:text-white hover:border-white/20 text-xs font-semibold transition-colors whitespace-nowrap"
        >
          <MonitorSmartphone size={12} />
          Open Kiosk
        </a>

        {/* User + logout */}
        <div className="flex items-center gap-2 text-white/40 text-xs">
          <span className="hidden sm:block">{user?.name}</span>
          <button onClick={logout} className="p-1.5 rounded-lg hover:bg-dark-200 hover:text-white transition-colors" title="Logout">
            <LogOut size={14} />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-5xl w-full mx-auto">
        {tab === 'today'    && <TodayTab />}
        {tab === 'monthly'  && <MonthlyTab />}
        {tab === 'staff'    && <StaffTab />}
        {tab === 'settings' && <SettingsTab />}
      </main>
    </div>
  );
}
