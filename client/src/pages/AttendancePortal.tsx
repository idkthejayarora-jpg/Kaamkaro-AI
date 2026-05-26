/**
 * AttendancePortal — isolated portal for the attendance_manager role.
 * Has its own minimal top-nav layout (no sidebar).
 * Tabs: Today | Monthly | Staff | Leaves | Settings
 * V2: Leaves tab, per-staff shift override, broadcast modal, improved face enrollment
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Clock, Calendar, Users, Settings, MonitorSmartphone, RefreshCw,
  CheckCircle2, AlertTriangle, XCircle, ChevronLeft, ChevronRight,
  Camera, Trash2, Eye, EyeOff, Save, CalendarOff, Megaphone,
  Send, ChevronDown, ChevronUp,
} from 'lucide-react';
import * as faceapi from '@vladmandic/face-api';
import { attendanceAPI, staffAPI, leavesAPI, broadcastAPI } from '../lib/api';

// ── Types ──────────────────────────────────────────────────────────────────────

interface TodayRecord {
  staffId: string; staffName: string; avatar: string;
  status: 'in' | 'out' | 'absent';
  loginAt: string | null; logoutAt: string | null;
  isLate: boolean; lateMinutes: number; hoursWorked: number;
  faceEnrolled: boolean;
  leaveToday: { type: string; reason: string } | null;
}

interface MonthlyStaff {
  staffId: string; staffName: string; avatar: string; faceEnrolled: boolean;
  presentDays: number; lateDays: number; leaveDays: number; halfDays: number; sickDays: number;
  totalHours: number; overtimeHours: number; undertimeHours: number;
  dailyMap: Record<string, string>;
  totalDays: number;
  shiftOverride: { shiftStart: string; shiftEnd: string } | null;
}

interface StaffMember {
  id: string; name: string; avatar: string; active: boolean;
  faceDescriptors?: number[][];
  shiftOverride?: { shiftStart: string; shiftEnd: string } | null;
}

interface AttendanceCfg {
  shiftStart: string; shiftEnd: string; lateGraceMins: number;
  expectedHours: number; kioskPin: string;
}

interface LeaveRecord {
  id: string; staffId: string; staffName: string; date: string;
  type: string; reason: string; markedBy: string; status: string;
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

const LEAVE_TYPES = [
  { value: 'full_day',    label: 'Full Day',    color: 'text-blue-400 bg-blue-500/12 border-blue-500/20' },
  { value: 'half_day_am', label: 'Half Day AM', color: 'text-purple-400 bg-purple-500/12 border-purple-500/20' },
  { value: 'half_day_pm', label: 'Half Day PM', color: 'text-purple-400 bg-purple-500/12 border-purple-500/20' },
  { value: 'sick',        label: 'Sick',        color: 'text-amber-400 bg-amber-500/12 border-amber-500/20' },
  { value: 'emergency',   label: 'Emergency',   color: 'text-red-400 bg-red-500/12 border-red-500/20' },
];

function leaveChip(type: string) {
  const t = LEAVE_TYPES.find(lt => lt.value === type);
  return t ? (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${t.color}`}>{t.label}</span>
  ) : null;
}

// ── Face Enroll Modal ──────────────────────────────────────────────────────────

const GUIDED_PROMPTS = [
  'Look straight at the camera',
  'Tilt slightly left',
  'Tilt slightly right',
  'Chin up slightly',
  'Look straight again',
];

function FaceEnrollModal({ staff, onClose, onEnrolled }: {
  staff: StaffMember;
  onClose: () => void;
  onEnrolled: () => void;
}) {
  const videoRef   = useRef<HTMLVideoElement>(null);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);
  const detectLoopRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [modelReady,   setModelReady]   = useState(false);
  const [capturing,    setCapturing]    = useState(false);
  const [captures,     setCaptures]     = useState<Float32Array[]>([]);
  const [status,       setStatus]       = useState('Loading face models…');
  const [saving,       setSaving]       = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [dupWarning,   setDupWarning]   = useState<string | null>(null);
  const TOTAL = 5;

  // Start live detection loop for preview bounding box
  const startDetectLoop = useCallback(() => {
    if (detectLoopRef.current) clearInterval(detectLoopRef.current);
    detectLoopRef.current = setInterval(async () => {
      if (!videoRef.current || !canvasRef.current) return;
      const det = await faceapi
        .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks(true);

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width  = videoRef.current.videoWidth  || 480;
      canvas.height = videoRef.current.videoHeight || 360;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (det) {
        setFaceDetected(true);
        const { x, y, width, height } = det.detection.box;
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth   = 2;
        ctx.strokeRect(x, y, width, height);
      } else {
        setFaceDetected(false);
      }
    }, 300);
  }, []);

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

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: 480, height: 360 },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        if (!cancelled) {
          setModelReady(true);
          setStatus('Position face and click Start Capture');
          startDetectLoop();
        }
      } catch {
        if (!cancelled) setStatus('Camera access denied or models unavailable.');
      }
    }
    init();
    return () => {
      cancelled = true;
      if (detectLoopRef.current) clearInterval(detectLoopRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [startDetectLoop]);

  const startCapture = useCallback(async () => {
    if (!videoRef.current || !modelReady) return;
    setCapturing(true);
    setCaptures([]);
    const collected: Float32Array[] = [];

    for (let i = 0; i < TOTAL; i++) {
      setStatus(`📸 ${GUIDED_PROMPTS[i]}`);
      await new Promise(r => setTimeout(r, 800));

      const det = await faceapi
        .detectSingleFace(videoRef.current!, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks(true)
        .withFaceDescriptor();

      if (!det) {
        setStatus(`⚠ No face detected — repositioning…`);
        i--;
        await new Promise(r => setTimeout(r, 600));
        continue;
      }
      // Store descriptor as-is (do NOT average — V2: keep all 5 separate)
      collected.push(det.descriptor);
      setCaptures([...collected]);
    }

    setStatus('✓ Captured! Check for duplicates, then Save.');
    setCapturing(false);
  }, [modelReady]);

  const checkDuplicateAndSave = async () => {
    if (captures.length < TOTAL) return;
    setSaving(true);
    setDupWarning(null);
    try {
      // Duplicate face check against existing enrolled staff
      const allFaces = await staffAPI.faceCheck() as { id: string; name: string; faceDescriptors: number[][] }[];
      const others = allFaces.filter(f => f.id !== staff.id);
      let closestName = '';
      let closestDist = 1;

      for (const other of others) {
        const labeled = new faceapi.LabeledFaceDescriptors(
          other.name,
          other.faceDescriptors.map(d => new Float32Array(d)),
        );
        const matcher = new faceapi.FaceMatcher([labeled], 0.4);
        for (const cap of captures) {
          const match = matcher.findBestMatch(cap);
          if (match.label !== 'unknown' && match.distance < closestDist) {
            closestDist = match.distance;
            closestName = other.name;
          }
        }
      }

      if (closestDist < 0.4 && closestName) {
        setSaving(false);
        setDupWarning(closestName);
        return;
      }

      await doSave();
    } catch {
      setStatus('Save failed — try again.');
      setSaving(false);
    }
  };

  const doSave = async () => {
    setSaving(true);
    try {
      // Save all 5 descriptors separately (not averaged)
      await staffAPI.enrollFace(staff.id, captures.map(d => Array.from(d)));
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
          {/* Camera preview + canvas overlay */}
          <div className="relative rounded-xl overflow-hidden bg-dark-500 aspect-[4/3]">
            <video ref={videoRef} muted playsInline className="w-full h-full object-cover" />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }} />
            {!modelReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-dark-500/80">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-6 h-6 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                  <p className="text-white/40 text-xs">Loading…</p>
                </div>
              </div>
            )}
            {/* Live detection indicator */}
            {modelReady && !capturing && (
              <div className={`absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold ${faceDetected ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${faceDetected ? 'bg-green-400' : 'bg-amber-400'}`} />
                {faceDetected ? '✓ Face detected' : 'No face in frame'}
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

          {/* Duplicate warning */}
          {dupWarning && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 space-y-2">
              <p className="text-amber-400 text-xs font-bold">⚠ Face closely matches {dupWarning}. Proceed anyway?</p>
              <div className="flex gap-2">
                <button onClick={doSave} disabled={saving}
                  className="flex-1 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-400 text-xs font-semibold hover:bg-amber-500/30 transition-colors disabled:opacity-40">
                  Proceed
                </button>
                <button onClick={() => setDupWarning(null)}
                  className="flex-1 py-1.5 rounded-lg bg-dark-300 border border-dark-50 text-white/40 text-xs font-semibold hover:text-white transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {!dupWarning && (
            <div className="flex gap-3">
              {captures.length < TOTAL ? (
                <button
                  onClick={startCapture}
                  disabled={!modelReady || capturing || !faceDetected}
                  className="flex-1 py-2.5 rounded-xl bg-gold/15 border border-gold/30 text-gold text-sm font-semibold hover:bg-gold/20 transition-colors disabled:opacity-40"
                >
                  {capturing ? 'Capturing…' : 'Start Capture'}
                </button>
              ) : (
                <button
                  onClick={checkDuplicateAndSave}
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-xl bg-green-500/15 border border-green-500/30 text-green-400 text-sm font-semibold hover:bg-green-500/20 transition-colors disabled:opacity-40"
                >
                  {saving ? 'Checking…' : '✓ Save Enrollment'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Broadcast Modal ────────────────────────────────────────────────────────────

function BroadcastModal({ onClose }: { onClose: () => void }) {
  const [title,   setTitle]   = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent,    setSent]    = useState(false);

  const send = async () => {
    if (!message.trim()) return;
    setSending(true);
    try {
      await broadcastAPI.send(message.trim(), title.trim() || undefined);
      setSent(true);
      setTimeout(() => onClose(), 1500);
    } catch {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-dark-400 border border-dark-50 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-50">
          <div className="flex items-center gap-2">
            <Megaphone size={15} className="text-gold" />
            <p className="text-white font-semibold">Send Broadcast</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-dark-200 text-white/30 hover:text-white transition-colors">
            <XCircle size={16} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-white/40 text-xs mb-1 block">Title (optional)</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Lunch break 30 mins"
              className="w-full bg-dark-300 border border-dark-50 rounded-xl px-3 py-2 text-white text-sm placeholder-white/20 focus:outline-none focus:border-gold/40"
            />
          </div>
          <div>
            <label className="text-white/40 text-xs mb-1 block">Message *</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={3}
              placeholder="Message to all staff…"
              className="w-full bg-dark-300 border border-dark-50 rounded-xl px-3 py-2 text-white text-sm placeholder-white/20 focus:outline-none focus:border-gold/40 resize-none"
            />
          </div>
          {sent ? (
            <div className="text-center text-green-400 text-sm font-semibold">✓ Broadcast sent!</div>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={send}
                disabled={sending || !message.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gold/15 border border-gold/30 text-gold text-sm font-semibold hover:bg-gold/20 transition-colors disabled:opacity-40"
              >
                <Send size={13} />
                {sending ? 'Sending…' : 'Send to All Staff'}
              </button>
              <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-dark-50 text-white/40 hover:text-white text-sm transition-colors">
                Cancel
              </button>
            </div>
          )}
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
          { label: 'Present',      val: present, color: 'text-green-400',   bg: 'bg-green-500/8' },
          { label: 'Currently In', val: inNow,   color: 'text-emerald-400', bg: 'bg-emerald-500/8' },
          { label: 'Late',         val: late,    color: 'text-amber-400',   bg: 'bg-amber-500/8' },
          { label: 'Absent',       val: absent,  color: 'text-red-400',     bg: 'bg-red-500/8' },
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
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${r.status === 'in' ? 'bg-green-400' : r.status === 'out' ? 'bg-blue-400' : 'bg-dark-100'}`} />
              <Avatar name={r.staffName} size={36} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-white font-semibold text-sm">{r.staffName}</p>
                  <StatusChip status={r.status} />
                  {r.isLate && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">+{r.lateMinutes}m late</span>}
                  {r.leaveToday && leaveChip(r.leaveToday.type)}
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

  const lastDay = data
    ? new Date(parseInt(month.split('-')[0]), parseInt(month.split('-')[1]), 0).getDate()
    : 31;

  const days = Array.from({ length: lastDay }, (_, i) => String(i + 1).padStart(2, '0'));

  const cellColor = (val?: string) => {
    if (!val || val === 'absent')   return 'bg-red-500/15 text-red-500/50';
    if (val === 'late')             return 'bg-amber-500/20 text-amber-400';
    if (val === 'present')          return 'bg-green-500/15 text-green-400';
    if (val === 'leave')            return 'bg-blue-500/15 text-blue-400';
    if (val === 'sick')             return 'bg-amber-600/20 text-amber-500';
    if (val === 'half_day')         return 'bg-purple-500/15 text-purple-400';
    return 'bg-dark-200 text-white/10';
  };

  const cellLabel = (val?: string) => {
    if (!val)               return '';
    if (val === 'absent')   return 'A';
    if (val === 'late')     return 'L';
    if (val === 'present')  return '✓';
    if (val === 'leave')    return 'Le';
    if (val === 'sick')     return 'S';
    if (val === 'half_day') return '½';
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
              { label: 'Total Hours',   val: `${data.staff.reduce((s,r) => s + r.totalHours, 0).toFixed(0)}h`,   color: 'text-white' },
              { label: 'Overtime',      val: `${data.staff.reduce((s,r) => s + r.overtimeHours, 0).toFixed(1)}h`, color: 'text-green-400' },
              { label: 'Undertime',     val: `${data.staff.reduce((s,r) => s + r.undertimeHours, 0).toFixed(1)}h`, color: 'text-red-400' },
              { label: 'Late Incidents', val: data.staff.reduce((s,r) => s + r.lateDays, 0),                       color: 'text-amber-400' },
            ].map(t => (
              <div key={t.label} className="bg-dark-400 border border-dark-50 rounded-2xl px-4 py-3 text-center">
                <p className={`text-xl font-black ${t.color}`}>{t.val}</p>
                <p className="text-white/30 text-xs mt-0.5">{t.label}</p>
              </div>
            ))}
          </div>

          {/* Calendar table */}
          <div className="rounded-2xl border border-dark-50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs" style={{ minWidth: Math.max(600, lastDay * 28 + 280) }}>
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
                          <div>
                            <span className="text-white/80 font-medium block truncate max-w-[90px]">{s.staffName}</span>
                            {s.shiftOverride && (
                              <span className="text-[9px] text-purple-400/70">{s.shiftOverride.shiftStart}–{s.shiftOverride.shiftEnd}</span>
                            )}
                          </div>
                        </div>
                      </td>
                      {days.map(d => {
                        const val = s.dailyMap[d];
                        return (
                          <td key={d} className="px-0.5 py-1 text-center">
                            <span className={`inline-flex w-6 h-6 rounded text-[8px] font-bold items-center justify-center ${cellColor(val)}`}>
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
          <div className="flex flex-wrap items-center gap-3 text-xs text-white/30">
            <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-green-500/15 text-green-400 inline-flex items-center justify-center text-[8px] font-bold">✓</span> Present</span>
            <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-amber-500/20 text-amber-400 inline-flex items-center justify-center text-[8px] font-bold">L</span> Late</span>
            <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-red-500/15 text-red-500/50 inline-flex items-center justify-center text-[8px] font-bold">A</span> Absent</span>
            <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-blue-500/15 text-blue-400 inline-flex items-center justify-center text-[8px] font-bold">Le</span> Leave</span>
            <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-amber-600/20 text-amber-500 inline-flex items-center justify-center text-[8px] font-bold">S</span> Sick</span>
            <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-purple-500/15 text-purple-400 inline-flex items-center justify-center text-[8px] font-bold">½</span> Half Day</span>
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [shiftEdits, setShiftEdits] = useState<Record<string, { shiftStart: string; shiftEnd: string }>>({});
  const [savingShift, setSavingShift] = useState<string | null>(null);

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

  const saveShift = async (s: StaffMember) => {
    const edit = shiftEdits[s.id];
    if (!edit) return;
    setSavingShift(s.id);
    try {
      await staffAPI.setShift(s.id, edit);
      load();
      setExpandedId(null);
    } catch {}
    finally { setSavingShift(null); }
  };

  const clearShift = async (id: string) => {
    setSavingShift(id);
    try {
      await staffAPI.setShift(id, null);
      load();
    } catch {}
    finally { setSavingShift(null); }
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
          {filtered.map(s => {
            const isExpanded = expandedId === s.id;
            const editVal = shiftEdits[s.id] ?? { shiftStart: s.shiftOverride?.shiftStart ?? '09:30', shiftEnd: s.shiftOverride?.shiftEnd ?? '18:30' };
            return (
              <div key={s.id} className="bg-dark-400 border border-dark-50 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 flex items-center gap-3">
                  <Avatar name={s.name} size={40} />
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold text-sm">{s.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {s.faceDescriptors?.length ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/12 text-green-400 border border-green-500/20 flex items-center gap-1">
                          <CheckCircle2 size={9} /> Face enrolled
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/6 text-white/30 border border-white/10 flex items-center gap-1">
                          <XCircle size={9} /> No face
                        </span>
                      )}
                      {s.shiftOverride ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/12 text-purple-400 border border-purple-500/20">
                          {s.shiftOverride.shiftStart}–{s.shiftOverride.shiftEnd}
                        </span>
                      ) : (
                        <span className="text-[10px] text-white/20 border border-white/10 px-1.5 py-0.5 rounded-full">Default shift</span>
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
                      <button onClick={() => clearFace(s.id)} className="p-1.5 rounded-xl text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Clear face">
                        <Trash2 size={13} />
                      </button>
                    ) : null}
                    <button
                      onClick={() => {
                        setExpandedId(isExpanded ? null : s.id);
                        setShiftEdits(prev => ({ ...prev, [s.id]: editVal }));
                      }}
                      className="p-1.5 rounded-xl text-white/30 hover:text-white hover:bg-dark-200 transition-colors"
                      title="Edit shift hours"
                    >
                      {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                  </div>
                </div>

                {/* Shift editor */}
                {isExpanded && (
                  <div className="border-t border-dark-50 px-4 py-3 bg-dark-500/50 space-y-3">
                    <p className="text-white/50 text-xs font-semibold uppercase tracking-wider">Custom Shift Hours</p>
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <label className="text-white/30 text-[10px] mb-1 block">Start</label>
                        <input
                          type="time"
                          value={editVal.shiftStart}
                          onChange={e => setShiftEdits(prev => ({ ...prev, [s.id]: { ...editVal, shiftStart: e.target.value } }))}
                          className="w-full bg-dark-300 border border-dark-50 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-gold/40"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-white/30 text-[10px] mb-1 block">End</label>
                        <input
                          type="time"
                          value={editVal.shiftEnd}
                          onChange={e => setShiftEdits(prev => ({ ...prev, [s.id]: { ...editVal, shiftEnd: e.target.value } }))}
                          className="w-full bg-dark-300 border border-dark-50 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-gold/40"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveShift(s)}
                        disabled={savingShift === s.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-gold/15 border border-gold/30 text-gold hover:bg-gold/20 transition-colors disabled:opacity-40"
                      >
                        <Save size={11} />
                        {savingShift === s.id ? 'Saving…' : 'Save'}
                      </button>
                      {s.shiftOverride && (
                        <button
                          onClick={() => clearShift(s.id)}
                          disabled={savingShift === s.id}
                          className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-dark-50 text-white/30 hover:text-white transition-colors disabled:opacity-40"
                        >
                          Use Default
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
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

// ── Tab: Leaves ────────────────────────────────────────────────────────────────

function LeavesTab() {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [leaves,    setLeaves]    = useState<LeaveRecord[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [marking,  setMarking]   = useState(false);
  const [error,    setError]     = useState('');

  const [selStaff, setSelStaff] = useState('');
  const [selDate,  setSelDate]  = useState(todayStr);
  const [selType,  setSelType]  = useState('full_day');
  const [reason,   setReason]   = useState('');
  const [month,    setMonth]    = useState(curMonth);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sl, lv] = await Promise.all([staffAPI.list(), leavesAPI.list(undefined, month)]);
      setStaffList(sl.filter((s: StaffMember) => s.active !== false));
      setLeaves(lv);
    } catch {}
    finally { setLoading(false); }
  }, [month]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const markLeave = async () => {
    if (!selStaff || !selDate || !selType) return;
    setMarking(true);
    setError('');
    try {
      await leavesAPI.mark({ staffId: selStaff, date: selDate, type: selType, reason });
      setReason('');
      loadAll();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      setError(err?.response?.data?.error || 'Failed to mark leave');
    } finally {
      setMarking(false);
    }
  };

  const cancelLeave = async (id: string) => {
    try {
      await leavesAPI.cancel(id);
      loadAll();
    } catch {}
  };

  // Group leaves by staff
  const byStaff = leaves.reduce<Record<string, LeaveRecord[]>>((acc, l) => {
    if (!acc[l.staffId]) acc[l.staffId] = [];
    acc[l.staffId].push(l);
    return acc;
  }, {});

  const shiftMonth = (dir: -1 | 1) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + dir, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  return (
    <div className="space-y-5">
      {/* Mark leave form */}
      <div className="bg-dark-400 border border-dark-50 rounded-2xl p-5 space-y-4">
        <p className="text-white font-semibold">Mark Leave</p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-white/40 text-xs mb-1 block">Staff</label>
            <select
              value={selStaff}
              onChange={e => setSelStaff(e.target.value)}
              className="w-full bg-dark-300 border border-dark-50 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-gold/40"
            >
              <option value="">Select staff…</option>
              {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-white/40 text-xs mb-1 block">Date</label>
            <input
              type="date"
              value={selDate}
              onChange={e => setSelDate(e.target.value)}
              className="w-full bg-dark-300 border border-dark-50 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-gold/40"
            />
          </div>
        </div>

        <div>
          <label className="text-white/40 text-xs mb-2 block">Leave Type</label>
          <div className="flex flex-wrap gap-2">
            {LEAVE_TYPES.map(lt => (
              <button
                key={lt.value}
                onClick={() => setSelType(lt.value)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                  selType === lt.value ? lt.color : 'border-dark-50 text-white/30 hover:text-white'
                }`}
              >
                {lt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-white/40 text-xs mb-1 block">Reason (optional)</label>
          <input
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="e.g. Medical appointment"
            className="w-full bg-dark-300 border border-dark-50 rounded-xl px-3 py-2 text-white text-sm placeholder-white/20 focus:outline-none focus:border-gold/40"
          />
        </div>

        {error && <p className="text-red-400 text-xs">{error}</p>}

        <button
          onClick={markLeave}
          disabled={marking || !selStaff || !selDate}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gold/15 border border-gold/30 text-gold text-sm font-semibold hover:bg-gold/20 transition-colors disabled:opacity-40"
        >
          <CheckCircle2 size={14} />
          {marking ? 'Marking…' : 'Mark Leave'}
        </button>
      </div>

      {/* Month browser */}
      <div className="flex items-center gap-3">
        <button onClick={() => shiftMonth(-1)} className="p-2 rounded-xl hover:bg-dark-200 text-white/40 hover:text-white transition-colors"><ChevronLeft size={16} /></button>
        <p className="text-white font-semibold flex-1 text-center">
          {new Date(month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
        </p>
        <button onClick={() => shiftMonth(1)} className="p-2 rounded-xl hover:bg-dark-200 text-white/40 hover:text-white transition-colors"><ChevronRight size={16} /></button>
        <button onClick={loadAll} className="p-2 rounded-xl hover:bg-dark-200 text-white/30 hover:text-white transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Leave list */}
      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 rounded-2xl bg-dark-400 animate-pulse" />)}</div>
      ) : leaves.length === 0 ? (
        <div className="text-center text-white/20 py-10 text-sm">No leaves recorded this month</div>
      ) : (
        <div className="space-y-4">
          {Object.entries(byStaff).map(([, staffLeaves]) => {
            const first = staffLeaves[0];
            return (
              <div key={first.staffId} className="bg-dark-400 border border-dark-50 rounded-2xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-dark-50/40 flex items-center gap-2">
                  <Avatar name={first.staffName} size={24} />
                  <p className="text-white font-semibold text-sm">{first.staffName}</p>
                  <span className="text-white/30 text-xs ml-auto">{staffLeaves.length} leave{staffLeaves.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="divide-y divide-dark-50/30">
                  {staffLeaves.sort((a,b) => b.date.localeCompare(a.date)).map(l => (
                    <div key={l.id} className="px-4 py-2.5 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-white/70 text-sm font-medium">
                            {new Date(l.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                          </p>
                          {leaveChip(l.type)}
                        </div>
                        {l.reason && <p className="text-white/30 text-xs mt-0.5">{l.reason}</p>}
                        <p className="text-white/20 text-[10px]">by {l.markedBy}</p>
                      </div>
                      <button
                        onClick={() => cancelLeave(l.id)}
                        className="p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Cancel leave"
                      >
                        <XCircle size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
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
        <p className="text-white font-semibold">Default Shift Hours</p>
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

type Tab = 'today' | 'monthly' | 'staff' | 'leaves' | 'settings';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'today',    label: 'Today',    icon: Clock },
  { id: 'monthly',  label: 'Monthly',  icon: Calendar },
  { id: 'staff',    label: 'Staff',    icon: Users },
  { id: 'leaves',   label: 'Leaves',   icon: CalendarOff },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function AttendancePortal() {
  const [tab, setTab] = useState<Tab>('today');
  const [broadcastOpen, setBroadcastOpen] = useState(false);

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-white font-bold text-xl">Attendance</h1>
          <p className="text-white/30 text-sm mt-0.5">Track staff hours, leaves and face recognition</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Broadcast */}
          <button
            onClick={() => setBroadcastOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dark-50 text-white/40 hover:text-white hover:border-white/20 text-xs font-semibold transition-colors"
            title="Send broadcast to all staff"
          >
            <Megaphone size={13} />
            Broadcast
          </button>

          {/* Open kiosk */}
          <a
            href="/kiosk"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dark-50 text-white/40 hover:text-white hover:border-white/20 text-xs font-semibold transition-colors whitespace-nowrap"
          >
            <MonitorSmartphone size={13} />
            Open Kiosk
          </a>
        </div>
      </div>

      {/* Tab row */}
      <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
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
                  : 'text-white/40 hover:text-white hover:bg-dark-200 border border-transparent'
              }`}
            >
              <Icon size={12} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {tab === 'today'    && <TodayTab />}
      {tab === 'monthly'  && <MonthlyTab />}
      {tab === 'staff'    && <StaffTab />}
      {tab === 'leaves'   && <LeavesTab />}
      {tab === 'settings' && <SettingsTab />}

      {/* Broadcast modal */}
      {broadcastOpen && <BroadcastModal onClose={() => setBroadcastOpen(false)} />}
    </div>
  );
}
