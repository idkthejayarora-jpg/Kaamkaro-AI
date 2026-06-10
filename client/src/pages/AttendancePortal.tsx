/**
 * AttendancePortal — isolated portal for the attendance_manager role.
 * Has its own minimal top-nav layout (no sidebar).
 * Tabs: Today | Analytics | Monthly | Payroll | Staff | Leaves | Settings
 * V3: Analytics tab, Payroll tab, Manual override entry
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import {
  Clock, Calendar, Users, Settings, MonitorSmartphone, RefreshCw,
  CheckCircle2, AlertTriangle, XCircle, ChevronLeft, ChevronRight,
  Camera, Trash2, Eye, EyeOff, Save, CalendarOff, Megaphone,
  Send, ChevronDown, ChevronUp, Edit2, IndianRupee, TrendingUp,
  UserX, ScanFace, ChevronRight as ArrowRight, CalendarDays, Plus, Sun,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import * as faceapi from '@vladmandic/face-api';
import { attendanceAPI, staffAPI, leavesAPI, broadcastAPI, payrollAPI, holidaysAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import Select from '../components/Select';
import { KioskView } from './AttendanceKiosk';
import AttendanceDayEditor, { type DayRecord } from '../components/AttendanceDayEditor';

// ── Types ──────────────────────────────────────────────────────────────────────

interface TodayRecord {
  staffId: string; staffName: string; avatar: string;
  status: 'in' | 'out' | 'absent' | 'off';
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
  role?: string;
  phone?: string;
  gender?: 'male' | 'female';
  canSelfCheckin?: boolean;
  faceDescriptors?: number[][];
  shiftOverride?: { shiftStart: string; shiftEnd: string } | null;
}

interface AttendanceCfg {
  shiftStart: string; shiftEnd: string; lateGraceMins: number;
  expectedHours: number; kioskPin: string;
  womenShift?: { shiftStart: string; shiftEnd: string; expectedHours: number };
}

interface LeaveRecord {
  id: string; staffId: string; staffName: string; date: string;
  type: string; reason: string; markedBy: string; status: string;
}

interface PayrollStaff {
  staffId: string; staffName: string; avatar: string;
  monthlySalary: number; workingDays: number;
  workingDaysInMonth?: number; offDays?: number; basePay?: number;
  expectedHoursPerDay?: number; expectedMonthlyHours?: number; hourlyRate?: number;
  workedHours?: number; paidLeaveHours?: number;
  presentDays: number; absentDays: number; halfDays: number; fullLeaveDays: number;
  lateMinutesTotal: number; overtimeHours: number; totalHours: number;
  absentDeduction: number; halfDayDeduction: number; latePenalty: number;
  overtimePay: number; netPay: number; hasSalaryConfig: boolean;
}

interface PayrollSummary {
  month: string;
  totalPayroll: number;
  staff: PayrollStaff[];
}

interface PayrollConfig {
  staffId: string;
  monthlySalary: number;
  overtimeMultiplier: number;
  latePenaltyPerMin: number;
  workingDaysOverride: number | null;
}

interface AnalyticsTrendPoint {
  date: string;
  present: number;
  late: number;
  absent: number;
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

function StatusChip({ status }: { status: 'in' | 'out' | 'absent' | 'off' }) {
  if (status === 'in')     return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/25">● In</span>;
  if (status === 'out')    return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/12 text-blue-400 border border-blue-500/20">● Out</span>;
  if (status === 'off')    return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/8 text-white/40 border border-white/10">Day off</span>;
  return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/6 text-white/30 border border-white/10">Absent</span>;
}

function fmt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function inr(n: number) {
  return `₹${n.toLocaleString('en-IN')}`;
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

// Custom chart tooltip
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#1a1a1c', border: '1px solid #333', borderRadius: 10, padding: '8px 12px' }}>
      <p style={{ color: '#ffffff80', fontSize: 11, marginBottom: 4 }}>{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color, fontSize: 12, fontWeight: 600 }}>
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  );
}

// ── Face Enroll Modal ──────────────────────────────────────────────────────────

// 10 varied poses — more angles = tighter descriptor cluster per person,
// which is the primary way to stop face-mixing in the kiosk.
const GUIDED_PROMPTS = [
  'Look straight at the camera',
  'Tilt head slightly left',
  'Tilt head slightly right',
  'Chin up slightly',
  'Chin down slightly',
  'Look straight again',
  'Move a little closer',
  'Move a little further back',
  'Slight smile',
  'Neutral expression — final shot',
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

  const [modelReady,    setModelReady]    = useState(false);
  const [capturing,     setCapturing]     = useState(false);
  const [captures,      setCaptures]      = useState<Float32Array[]>([]);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [status,        setStatus]        = useState('Loading face models…');
  const [saving,        setSaving]        = useState(false);
  const [faceDetected,  setFaceDetected]  = useState(false);
  const [dupWarning,    setDupWarning]    = useState<string | null>(null);
  const TOTAL = 10; // 10 varied-angle captures → tighter per-person cluster, fewer false matches

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
      // 1200ms gap ensures the video frame actually changes between captures —
      // 800ms was barely one render cycle, leading to near-duplicate descriptors.
      await new Promise(r => setTimeout(r, 1200));

      // inputSize: 320 matches kiosk inference quality → same descriptor space.
      // scoreThreshold: 0.6 rejects weak/partial detections during enrollment.
      const det = await faceapi
        .detectSingleFace(videoRef.current!, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.6 }))
        .withFaceLandmarks(true)
        .withFaceDescriptor();

      if (!det) {
        setStatus(`⚠ No face detected — reposition and hold still…`);
        i--;
        await new Promise(r => setTimeout(r, 800));
        continue;
      }
      collected.push(det.descriptor);
      setCaptures([...collected]);
    }

    // Capture a 160×160 JPEG thumbnail from the live video frame
    if (videoRef.current) {
      try {
        const snap = document.createElement('canvas');
        snap.width = 160; snap.height = 160;
        const ctx = snap.getContext('2d');
        if (ctx) {
          ctx.drawImage(videoRef.current, 0, 0, 160, 160);
          setCapturedPhoto(snap.toDataURL('image/jpeg', 0.82));
        }
      } catch { /* non-fatal */ }
    }

    setStatus('✓ Captured! Check for duplicates, then Save.');
    setCapturing(false);
  }, [modelReady]);

  const checkDuplicateAndSave = async () => {
    if (captures.length < TOTAL) return;
    setSaving(true);
    setDupWarning(null);
    try {
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
      await staffAPI.enrollFace(staff.id, captures.map(d => Array.from(d)), capturedPhoto ?? undefined);
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
            {modelReady && !capturing && (
              <div className={`absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold ${faceDetected ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${faceDetected ? 'bg-green-400' : 'bg-amber-400'}`} />
                {faceDetected ? '✓ Face detected' : 'No face in frame'}
              </div>
            )}
          </div>

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

// ── Manual Entry Modal ─────────────────────────────────────────────────────────

function ManualEntryModal({ staffList, onClose, onSaved }: {
  staffList: StaffMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const now = new Date();
  const todayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const [staffId,   setStaffId]   = useState('');
  const [date,      setDate]      = useState(todayDate);
  const [loginAt,   setLoginAt]   = useState('09:30');
  const [logoutAt,  setLogoutAt]  = useState('18:30');
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');

  const submit = async () => {
    if (!staffId || !date || !loginAt) {
      setError('Staff, date and login time are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await attendanceAPI.manual({ staffId, date, loginAt, logoutAt: logoutAt || undefined });
      onSaved();
      onClose();
    } catch {
      setError('Failed to save — please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-dark-400 border border-dark-50 rounded-2xl w-full max-w-xs shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-dark-50">
          <div className="flex items-center gap-2">
            <Edit2 size={13} className="text-gold" />
            <p className="text-white font-semibold text-sm">Manual Entry</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-dark-200 text-white/30 hover:text-white transition-colors">
            <XCircle size={15} />
          </button>
        </div>

        {/* Form — flat compact stack */}
        <div className="p-4 space-y-3">
          <div>
            <label className="text-white/40 text-[10px] mb-1 block">Staff *</label>
            <Select
              value={staffId}
              onChange={e => setStaffId(e.target.value)}
              className="w-full bg-dark-300 border border-dark-50 rounded-xl px-3 py-2 text-white text-sm"
            >
              <option value="">Select staff…</option>
              {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>

          <div>
            <label className="text-white/40 text-[10px] mb-1 block">Date *</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full bg-dark-300 border border-dark-50 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-gold/40"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-white/40 text-[10px] mb-1 block">Check-in *</label>
              <input
                type="time"
                value={loginAt}
                onChange={e => setLoginAt(e.target.value)}
                className="w-full bg-dark-300 border border-dark-50 rounded-xl px-2 py-2 text-white text-sm focus:outline-none focus:border-gold/40"
              />
            </div>
            <div>
              <label className="text-white/40 text-[10px] mb-1 block">Check-out</label>
              <input
                type="time"
                value={logoutAt}
                onChange={e => setLogoutAt(e.target.value)}
                className="w-full bg-dark-300 border border-dark-50 rounded-xl px-2 py-2 text-white text-sm focus:outline-none focus:border-gold/40"
              />
            </div>
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={submit}
              disabled={saving || !staffId || !date || !loginAt}
              className="flex-1 py-2.5 rounded-xl bg-gold/15 border border-gold/30 text-gold text-sm font-semibold hover:bg-gold/20 transition-colors disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save Entry'}
            </button>
            <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-dark-50 text-white/40 hover:text-white text-sm transition-colors">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tab: Today ─────────────────────────────────────────────────────────────────

function TodayTab({ canEditTimes }: { canEditTimes: boolean }) {
  const [records,     setRecords]     = useState<TodayRecord[]>([]);
  const [staffList,   setStaffList]   = useState<StaffMember[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [manualOpen,  setManualOpen]  = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [recs, sl] = await Promise.all([
        attendanceAPI.today(),
        staffAPI.list(),
      ]);
      setRecords(recs);
      setStaffList(sl.filter((s: StaffMember) => s.active !== false));
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const present = records.filter(r => r.status === 'in' || r.status === 'out').length; // actually worked today (not 'off'/'absent')
  const late    = records.filter(r => r.isLate).length;
  const absent  = records.filter(r => r.status === 'absent').length;
  const inNow   = records.filter(r => r.status === 'in').length;
  const offToday = records.filter(r => r.status === 'off').length;

  return (
    <div className="space-y-5">
      {/* Summary tiles */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Present',      val: present, color: 'text-green-400',   bg: 'bg-gradient-to-br from-green-500/14 to-dark-400',   border: 'border-green-500/20' },
          { label: 'Currently In', val: inNow,   color: 'text-emerald-400', bg: 'bg-gradient-to-br from-emerald-500/14 to-dark-400', border: 'border-emerald-500/20' },
          { label: 'Late',         val: late,    color: 'text-amber-400',   bg: 'bg-gradient-to-br from-amber-500/14 to-dark-400',   border: 'border-amber-500/20' },
          { label: 'Absent',       val: absent,  color: 'text-red-400',     bg: 'bg-gradient-to-br from-red-500/14 to-dark-400',     border: 'border-red-500/20' },
        ].map(t => (
          <div key={t.label} className={`${t.bg} rounded-2xl border ${t.border} px-4 py-3 text-center`}>
            <p className={`text-3xl font-black ${t.color}`}>{t.val}</p>
            <p className="text-white/40 text-xs mt-0.5">{t.label}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-white/40 text-xs">
          {offToday > 0 ? <span className="text-white/55">Day off today · {offToday} staff off (Sun/holiday)</span> : 'Auto-updates every 60 seconds'}
        </p>
        <div className="flex items-center gap-2">
          {canEditTimes && (
            <button
              onClick={() => setManualOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gold/10 border border-gold/25 text-gold text-xs font-semibold hover:bg-gold/15 transition-colors"
            >
              <Edit2 size={11} />
              Manual Entry
            </button>
          )}
          <button onClick={load} className="p-1.5 rounded-lg hover:bg-dark-200 text-white/30 hover:text-white transition-colors">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Late alerts */}
      {late > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 to-amber-500/4 p-4 space-y-2">
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
            <div key={r.staffId} className={`bg-dark-400 border border-dark-50 rounded-2xl px-4 py-3 flex items-center gap-3 border-l-[3px] ${
              r.status === 'in'  ? 'border-l-green-500/70' :
              r.status === 'out' ? 'border-l-blue-500/50'  :
              r.isLate           ? 'border-l-amber-500/70' :
                                   'border-l-dark-50'
            }`}>
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

      {manualOpen && (
        <ManualEntryModal
          staffList={staffList}
          onClose={() => setManualOpen(false)}
          onSaved={load}
        />
      )}
    </div>
  );
}

// ── Tab: Analytics ─────────────────────────────────────────────────────────────

function AnalyticsTab() {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [trend,       setTrend]       = useState<AnalyticsTrendPoint[]>([]);
  const [totalStaff,  setTotalStaff]  = useState(0);
  const [monthlyData, setMonthlyData] = useState<MonthlyStaff[]>([]);
  const [loading,     setLoading]     = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [analyticsRes, monthlyRes] = await Promise.all([
        attendanceAPI.analytics(30),
        attendanceAPI.monthly(currentMonth),
      ]);
      setTrend(analyticsRes.dailyTrend || []);
      setTotalStaff(analyticsRes.totalStaff || 0);
      setMonthlyData(monthlyRes.staff || []);
    } catch {}
    finally { setLoading(false); }
  }, [currentMonth]);

  useEffect(() => { load(); }, [load]);

  // KPI calculations
  const avgAttendanceRate = trend.length > 0 && totalStaff > 0
    ? trend.reduce((sum, d) => sum + (d.present / totalStaff) * 100, 0) / trend.length
    : 0;

  const avgHoursPerDay = (() => {
    const staffWithHours = monthlyData.filter(s => s.presentDays > 0);
    if (!staffWithHours.length) return 0;
    const avg = staffWithHours.reduce((sum, s) => sum + s.totalHours / s.presentDays, 0) / staffWithHours.length;
    return avg;
  })();

  const totalOT = monthlyData.reduce((sum, s) => sum + s.overtimeHours, 0);
  const totalAbsent = monthlyData.reduce((sum, s) => sum + (s.totalDays - s.presentDays - s.leaveDays - s.sickDays - s.halfDays), 0);

  // Chart data: format dates as "DD MMM"
  const trendChartData = trend.map(d => ({
    ...d,
    dateLabel: new Date(d.date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
  }));

  // Staff performance chart (sorted desc by totalHours)
  const staffPerfData = [...monthlyData]
    .sort((a, b) => b.totalHours - a.totalHours)
    .map(s => ({ name: s.staffName.split(' ')[0], hours: s.totalHours }));

  // Late arrivals chart
  const lateData = monthlyData
    .filter(s => s.lateDays > 0)
    .sort((a, b) => b.lateDays - a.lateDays)
    .map(s => ({ name: s.staffName.split(' ')[0], late: s.lateDays }));

  const fmtHM = (h: number) => {
    const hrs = Math.floor(h);
    const mins = Math.round((h - hrs) * 60);
    return `${hrs}h ${mins}m`;
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => <div key={i} className="h-40 rounded-2xl bg-dark-400 animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Attendance Rate',     val: `${avgAttendanceRate.toFixed(1)}%`,  color: 'text-green-400',   icon: '✓', grad: 'from-green-500/12' },
          { label: 'Avg Hours/Day',       val: fmtHM(avgHoursPerDay),               color: 'text-gold',        icon: '⏱', grad: 'from-gold/10' },
          { label: 'Total OT This Month', val: `${totalOT.toFixed(1)}h`,            color: 'text-emerald-400', icon: '📈', grad: 'from-emerald-500/12' },
          { label: 'Absent Incidents',    val: Math.max(0, totalAbsent).toString(),  color: 'text-red-400',     icon: '✗', grad: 'from-red-500/12' },
        ].map(k => (
          <div key={k.label} className={`bg-gradient-to-br ${k.grad} to-dark-400 border border-dark-50 rounded-2xl px-4 py-4 text-center`}>
            <p className="text-white/30 text-lg mb-1">{k.icon}</p>
            <p className={`text-2xl font-black ${k.color}`}>{k.val}</p>
            <p className="text-white/30 text-xs mt-1">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Attendance Trend */}
      <div className="bg-dark-400 border border-dark-50 rounded-2xl p-5 shadow-lg shadow-black/20 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-gold/20 via-transparent to-transparent" />
        <div className="flex items-center gap-3 mb-4">
          <div>
            <p className="text-white/40 text-[10px] uppercase tracking-[0.18em] font-bold">Trends</p>
            <p className="text-white font-black text-lg mt-0.5">Last 30 Days</p>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={trendChartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="presentGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="lateGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
            <XAxis dataKey="dateLabel" tick={{ fill: '#ffffff30', fontSize: 10 }} interval={4} />
            <YAxis tick={{ fill: '#ffffff30', fontSize: 10 }} />
            <Tooltip content={<ChartTooltip />} />
            <Area type="monotone" dataKey="present" name="Present" stroke="#22c55e" strokeWidth={1.5} fill="url(#presentGrad)" />
            <Area type="monotone" dataKey="late"    name="Late"    stroke="#f59e0b" strokeWidth={1.5} fill="url(#lateGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Staff Performance */}
      {staffPerfData.length > 0 && (
        <div className="bg-dark-400 border border-dark-50 rounded-2xl p-5 shadow-lg shadow-black/20 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-gold/20 via-transparent to-transparent" />
          <p className="text-white/40 text-[10px] uppercase tracking-[0.18em] font-bold">Performance</p>
          <p className="text-white font-black text-lg mt-0.5 mb-4">Staff Hours This Month</p>
          <ResponsiveContainer width="100%" height={Math.max(180, staffPerfData.length * 36)}>
            <BarChart data={staffPerfData} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" horizontal={false} />
              <XAxis type="number" tick={{ fill: '#ffffff30', fontSize: 10 }} />
              <YAxis type="category" dataKey="name" tick={{ fill: '#ffffff60', fontSize: 11 }} width={70} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="hours" name="Hours" fill="#D4AF37" fillOpacity={0.8} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Late Arrivals */}
      {lateData.length > 0 && (
        <div className="bg-dark-400 border border-dark-50 rounded-2xl p-5 shadow-lg shadow-black/20 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-amber-500/20 via-transparent to-transparent" />
          <div className="flex items-center gap-2 mb-4">
            <UserX size={14} className="text-amber-400" />
            <div>
              <p className="text-white/40 text-[10px] uppercase tracking-[0.18em] font-bold">Punctuality</p>
              <p className="text-white font-black text-lg mt-0.5">Late Arrivals This Month</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={lateData} margin={{ top: 0, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
              <XAxis dataKey="name" tick={{ fill: '#ffffff30', fontSize: 11 }} />
              <YAxis tick={{ fill: '#ffffff30', fontSize: 10 }} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="late" name="Late Days" fill="#f59e0b" fillOpacity={0.75} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {lateData.length === 0 && staffPerfData.length === 0 && (
        <div className="text-center text-white/20 py-10 text-sm">No data available for this month yet</div>
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
    if (val === 'holiday')          return 'bg-white/5 text-white/25';
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
    if (val === 'holiday')  return '·';
    return '';
  };

  return (
    <div className="space-y-5">
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
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Total Hours',    val: `${data.staff.reduce((s,r) => s + r.totalHours, 0).toFixed(0)}h`,     color: 'text-white',       grad: 'from-gold/8' },
              { label: 'Overtime',       val: `${data.staff.reduce((s,r) => s + r.overtimeHours, 0).toFixed(1)}h`,  color: 'text-green-400',   grad: 'from-green-500/12' },
              { label: 'Undertime',      val: `${data.staff.reduce((s,r) => s + r.undertimeHours, 0).toFixed(1)}h`, color: 'text-red-400',     grad: 'from-red-500/12' },
              { label: 'Late Incidents', val: data.staff.reduce((s,r) => s + r.lateDays, 0),                         color: 'text-amber-400',   grad: 'from-amber-500/12' },
            ].map(t => (
              <div key={t.label} className={`bg-gradient-to-br ${t.grad} to-dark-400 border border-dark-50 rounded-2xl px-4 py-3 text-center`}>
                <p className={`text-xl font-black ${t.color}`}>{t.val}</p>
                <p className="text-white/30 text-xs mt-0.5">{t.label}</p>
              </div>
            ))}
          </div>

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

// ── Tab: Payroll ───────────────────────────────────────────────────────────────

function PayrollTab() {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [month,      setMonth]      = useState(defaultMonth);
  const [configs,    setConfigs]    = useState<PayrollConfig[]>([]);
  const [summary,    setSummary]    = useState<PayrollSummary | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [editingId,  setEditingId]  = useState<string | null>(null);
  const [editForm,   setEditForm]   = useState<{
    monthlySalary: string;
    overtimeMultiplier: string;
    latePenaltyPerMin: string;
    workingDaysOverride: string;
  }>({ monthlySalary: '', overtimeMultiplier: '1.5', latePenaltyPerMin: '0', workingDaysOverride: '' });
  const [saving,     setSaving]     = useState(false);
  const [payslipFor, setPayslipFor] = useState<PayrollStaff | null>(null);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    try {
      const [cfgs, summ] = await Promise.all([
        payrollAPI.configs(),
        payrollAPI.summary(m),
      ]);
      setConfigs(cfgs);
      setSummary(summ);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(month); }, [month, load]);

  const shiftMonth = (dir: -1 | 1) => {
    const [y, m2] = month.split('-').map(Number);
    const d = new Date(y, m2 - 1 + dir, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const openEdit = (s: PayrollStaff) => {
    const cfg = configs.find(c => c.staffId === s.staffId);
    setEditForm({
      monthlySalary:       String(cfg?.monthlySalary       ?? s.monthlySalary ?? ''),
      overtimeMultiplier:  String(cfg?.overtimeMultiplier  ?? 1.5),
      latePenaltyPerMin:   String(cfg?.latePenaltyPerMin   ?? 0),
      workingDaysOverride: cfg?.workingDaysOverride != null ? String(cfg.workingDaysOverride) : '',
    });
    setEditingId(s.staffId);
  };

  const saveConfig = async (staffId: string) => {
    setSaving(true);
    try {
      await payrollAPI.setConfig(staffId, {
        monthlySalary:      Number(editForm.monthlySalary)      || 0,
        overtimeMultiplier: Number(editForm.overtimeMultiplier) || 1.5,
        latePenaltyPerMin:  Number(editForm.latePenaltyPerMin)  || 0,
        workingDaysOverride: editForm.workingDaysOverride ? Number(editForm.workingDaysOverride) : null,
      });
      setEditingId(null);
      load(month);
    } catch {}
    finally { setSaving(false); }
  };

  const netPayColor = (net: number, base: number) => {
    if (!base) return 'text-white/40';
    const pct = net / base;
    if (pct >= 1)   return 'text-green-400';
    if (pct >= 0.8) return 'text-amber-400';
    return 'text-red-400';
  };

  const configuredCount = summary?.staff.filter(s => s.hasSalaryConfig).length ?? 0;

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

      {/* Month-in-progress notice — payroll accrues day by day, so a partial
          month shows pay EARNED SO FAR, not the final payslip. */}
      {(() => {
        const now = new Date();
        const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        if (month !== curMonth) return null;
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        return (
          <div className="rounded-2xl border border-blue-500/25 bg-blue-500/8 px-4 py-3 text-xs text-white/70 leading-relaxed">
            <b className="text-blue-300">This month is still in progress</b> — day {now.getDate()} of {lastDay}.
            These are wages <b className="text-white/90">earned so far</b> (pay accrues each working day). The full payslip is complete at month-end.
            To see a finished month, use ‹ to go back.
          </div>
        );
      })()}

      {/* Total payroll banner */}
      {summary && (
        <div className="bg-gradient-to-r from-gold/15 to-gold/5 border border-gold/25 rounded-2xl p-5 flex items-center justify-between shadow-lg shadow-gold/5">
          <div>
            <p className="text-gold/50 text-[10px] uppercase tracking-[0.18em] font-bold">This Month</p>
            <p className="text-white/70 text-sm mt-0.5">Total Payroll</p>
            <p className="text-gold text-3xl font-black mt-1">{inr(summary.totalPayroll)}</p>
          </div>
          <div className="text-right">
            <p className="text-white/30 text-xs">{configuredCount} of {summary.staff.length} staff configured</p>
            <div className="flex items-center gap-1.5 mt-2 justify-end">
              <IndianRupee size={12} className="text-gold/60" />
              <span className="text-white/40 text-xs">{month}</span>
            </div>
          </div>
        </div>
      )}

      {/* Staff payout table */}
      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 rounded-2xl bg-dark-400 animate-pulse" />)}</div>
      ) : summary && (
        <div className="rounded-2xl border border-dark-50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ minWidth: 760 }}>
              <thead>
                <tr className="bg-dark-500 text-white/40">
                  <th className="text-left px-4 py-3 font-semibold min-w-[140px]">Staff</th>
                  <th className="px-3 py-3 text-center font-semibold">Base Salary</th>
                  <th className="px-3 py-3 text-center font-semibold">Hours worked</th>
                  <th className="px-3 py-3 text-center font-semibold text-white/40">Absent (unpaid)</th>
                  <th className="px-3 py-3 text-center font-semibold text-white/40">Half-day</th>
                  <th className="px-3 py-3 text-center font-semibold text-amber-400/60">Late Penalty</th>
                  <th className="px-3 py-3 text-center font-semibold text-green-400/60">OT Bonus</th>
                  <th className="px-3 py-3 text-center font-semibold">Net Pay</th>
                  <th className="px-3 py-3 text-center font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-50/30">
                {summary.staff.map(s => (
                  <React.Fragment key={s.staffId}>
                    <tr className="bg-dark-400 hover:bg-dark-300 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Avatar name={s.staffName} size={28} />
                          <span className="text-white/80 font-medium">{s.staffName}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center text-white/60">
                        {s.hasSalaryConfig ? inr(s.monthlySalary) : <span className="text-white/20">—</span>}
                      </td>
                      <td className="px-3 py-3 text-center text-white/60">
                        <div>{(s.workedHours ?? 0)}h<span className="text-white/30"> / {s.expectedMonthlyHours ?? 0}h</span></div>
                        <div className="text-white/25 text-[10px]">{s.presentDays}/{s.workingDaysInMonth ?? s.workingDays} days{(s.offDays ?? 0) > 0 ? ` · ${s.offDays} off` : ''}</div>
                      </td>
                      <td className="px-3 py-3 text-center text-white/40">
                        {s.absentDays > 0 ? <span>{s.absentDays}d <span className="text-white/25 text-[10px]">(~{inr(s.absentDeduction)})</span></span> : '—'}
                      </td>
                      <td className="px-3 py-3 text-center text-white/40">
                        {s.halfDays > 0 ? <span>{s.halfDays} <span className="text-white/25 text-[10px]">(~{inr(s.halfDayDeduction)})</span></span> : '—'}
                      </td>
                      <td className="px-3 py-3 text-center text-amber-400">
                        {s.latePenalty > 0 ? `-${inr(s.latePenalty)}` : '—'}
                      </td>
                      <td className="px-3 py-3 text-center text-green-400">
                        {s.overtimePay > 0 ? `+${inr(s.overtimePay)}` : '—'}
                      </td>
                      <td className="px-3 py-3 text-center">
                        {s.hasSalaryConfig ? (
                          <span className={`font-black text-sm ${netPayColor(s.netPay, s.monthlySalary)}`}>
                            {inr(s.netPay)}
                          </span>
                        ) : (
                          <span className="text-white/20">Set salary</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {!s.hasSalaryConfig ? (
                            <button
                              onClick={() => openEdit(s)}
                              className="px-2.5 py-1 rounded-lg bg-gold/12 border border-gold/25 text-gold text-[10px] font-semibold hover:bg-gold/20 transition-colors"
                            >
                              Set Salary
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() => openEdit(s)}
                                className="p-1.5 rounded-lg text-white/30 hover:text-gold hover:bg-gold/10 transition-colors"
                                title="Edit salary config"
                              >
                                <Edit2 size={12} />
                              </button>
                              <button
                                onClick={() => setPayslipFor(s)}
                                className="p-1.5 rounded-lg text-white/30 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                                title="View payslip"
                              >
                                <Eye size={12} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Inline salary editor */}
                    {editingId === s.staffId && (
                      <tr className="bg-dark-500">
                        <td colSpan={9} className="px-4 py-4">
                          <div className="space-y-3">
                            <p className="text-white/50 text-xs font-semibold uppercase tracking-wider">Edit Salary Config — {s.staffName}</p>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                              <div>
                                <label className="text-white/30 text-[10px] mb-1 block">Monthly Salary (₹)</label>
                                <input
                                  type="number"
                                  value={editForm.monthlySalary}
                                  onChange={e => setEditForm(f => ({ ...f, monthlySalary: e.target.value }))}
                                  placeholder="e.g. 25000"
                                  className="w-full bg-dark-300 border border-dark-50 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-gold/40"
                                />
                              </div>
                              <div>
                                <label className="text-white/30 text-[10px] mb-1 block">OT Multiplier (e.g. 1.5)</label>
                                <input
                                  type="number"
                                  step="0.1"
                                  value={editForm.overtimeMultiplier}
                                  onChange={e => setEditForm(f => ({ ...f, overtimeMultiplier: e.target.value }))}
                                  className="w-full bg-dark-300 border border-dark-50 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-gold/40"
                                />
                              </div>
                              <div>
                                <label className="text-white/30 text-[10px] mb-1 block">Late Penalty/min (₹)</label>
                                <input
                                  type="number"
                                  step="0.5"
                                  value={editForm.latePenaltyPerMin}
                                  onChange={e => setEditForm(f => ({ ...f, latePenaltyPerMin: e.target.value }))}
                                  className="w-full bg-dark-300 border border-dark-50 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-gold/40"
                                />
                              </div>
                              <div>
                                <label className="text-white/30 text-[10px] mb-1 block">Working Days (blank = use month)</label>
                                <input
                                  type="number"
                                  value={editForm.workingDaysOverride}
                                  onChange={e => setEditForm(f => ({ ...f, workingDaysOverride: e.target.value }))}
                                  placeholder="e.g. 26"
                                  className="w-full bg-dark-300 border border-dark-50 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-gold/40"
                                />
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => saveConfig(s.staffId)}
                                disabled={saving}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gold/15 border border-gold/30 text-gold text-xs font-semibold hover:bg-gold/20 transition-colors disabled:opacity-40"
                              >
                                <Save size={11} />
                                {saving ? 'Saving…' : 'Save'}
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="px-4 py-2 rounded-xl border border-dark-50 text-white/30 hover:text-white text-xs transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}

                {/* Totals row */}
                {summary.staff.length > 0 && (
                  <tr className="bg-dark-500 border-t border-gold/20">
                    <td className="px-4 py-3 text-white/60 font-semibold text-xs" colSpan={3}>Total</td>
                    <td className="px-3 py-3 text-center text-white/40 font-semibold">
                      {summary.staff.reduce((s, r) => s + r.absentDays, 0)}d
                    </td>
                    <td className="px-3 py-3 text-center text-white/40 font-semibold">
                      {summary.staff.reduce((s, r) => s + r.halfDays, 0)}
                    </td>
                    <td className="px-3 py-3 text-center text-amber-400 font-semibold">
                      -{inr(summary.staff.reduce((s, r) => s + r.latePenalty, 0))}
                    </td>
                    <td className="px-3 py-3 text-center text-green-400 font-semibold">
                      +{inr(summary.staff.reduce((s, r) => s + r.overtimePay, 0))}
                    </td>
                    <td className="px-3 py-3 text-center text-gold font-black">
                      {inr(summary.totalPayroll)}
                    </td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Payslip Modal */}
      {payslipFor && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={() => setPayslipFor(null)}>
          <div className="bg-dark-400 border border-dark-50 rounded-t-2xl sm:rounded-2xl w-full max-w-sm shadow-2xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-dark-50 flex-shrink-0">
              <div>
                <p className="text-white font-semibold">Payslip</p>
                <p className="text-white/40 text-xs mt-0.5">{payslipFor.staffName} · {month}</p>
              </div>
              <button onClick={() => setPayslipFor(null)} className="p-1.5 rounded-lg hover:bg-dark-200 text-white/30 hover:text-white transition-colors">
                <XCircle size={16} />
              </button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              {/* Earnings — paid for hours actually worked (+ paid leave) */}
              <div className="flex justify-between text-sm">
                <span className="text-white/50">Earned
                  <span className="text-white/30 text-xs"> ({(payslipFor.workedHours ?? 0)}h worked{(payslipFor.paidLeaveHours ?? 0) > 0 ? ` + ${payslipFor.paidLeaveHours}h paid leave` : ''})</span>
                </span>
                <span className="text-white font-semibold">{inr(payslipFor.basePay ?? 0)}</span>
              </div>
              {payslipFor.overtimePay > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-white/50">OT bonus <span className="text-white/30 text-xs">({payslipFor.overtimeHours.toFixed(1)} hrs)</span></span>
                  <span className="text-green-400 font-semibold">+{inr(payslipFor.overtimePay)}</span>
                </div>
              )}
              {payslipFor.latePenalty > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-white/50">Late penalty <span className="text-white/30 text-xs">({payslipFor.lateMinutesTotal} min)</span></span>
                  <span className="text-amber-400 font-semibold">-{inr(payslipFor.latePenalty)}</span>
                </div>
              )}

              <div className="border-t border-dark-50 pt-3 mt-1">
                <div className="flex justify-between items-center">
                  <span className="text-white font-semibold">NET PAY</span>
                  <span className="text-gold text-2xl font-black">{inr(payslipFor.netPay)}</span>
                </div>
                <p className="text-white/30 text-xs mt-2">
                  Present {payslipFor.presentDays} / {payslipFor.workingDaysInMonth ?? payslipFor.workingDays} working days
                  {(payslipFor.offDays ?? 0) > 0 ? ` · ${payslipFor.offDays} off (Sun/holiday)` : ''}
                </p>
              </div>

              {/* Informational only — absent days are simply NOT PAID, never deducted */}
              {(payslipFor.absentDays > 0 || payslipFor.halfDays > 0) && (
                <div className="rounded-xl bg-white/5 border border-white/8 px-3 py-2.5 mt-1 space-y-1">
                  <p className="text-white/40 text-[10px] uppercase tracking-wider font-bold">Not paid (no deduction — just unpaid days)</p>
                  {payslipFor.absentDays > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-white/50">Absent · {payslipFor.absentDays} day{payslipFor.absentDays > 1 ? 's' : ''}</span>
                      <span className="text-white/40">missed ~{inr(payslipFor.absentDeduction)}</span>
                    </div>
                  )}
                  {payslipFor.halfDays > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-white/50">Half-day off · {payslipFor.halfDays}</span>
                      <span className="text-white/40">missed ~{inr(payslipFor.halfDayDeduction)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Staff ─────────────────────────────────────────────────────────────────

// Month calendar for one staff — manager taps a day to view/edit check-in/out.
function StaffAttendanceCalendar({ staff, onClose, canFullEdit = false, canNudge = true }: { staff: StaffMember; onClose: () => void; canFullEdit?: boolean; canNudge?: boolean }) {
  const [month, setMonth] = useState(() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`; });
  const [recs, setRecs]   = useState<DayRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [day, setDay]     = useState<{ date: string; record: DayRecord | null } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setLoading(true);
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    attendanceAPI.staffHistory(staff.id, `${month}-01`, `${month}-${String(lastDay).padStart(2, '0')}`)
      .then((r: DayRecord[]) => setRecs(Array.isArray(r) ? r : []))
      .catch(() => setRecs([]))
      .finally(() => setLoading(false));
  }, [staff.id, month, reload]);

  const byDate: Record<string, DayRecord> = {};
  for (const r of recs) byDate[r.date] = r;

  const [y, m] = month.split('-').map(Number);
  const firstDow = new Date(y, m - 1, 1).getDay();
  const lastDay  = new Date(y, m, 0).getDate();
  const shiftMonth = (dir: number) => {
    const d = new Date(y, m - 1 + dir, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const cellCls = (r?: DayRecord) => {
    if (!r || (!r.loginAt && !r.logoutAt)) return 'bg-dark-200 text-white/25';
    if (r.isLate) return 'bg-amber-500/25 text-amber-200';
    return 'bg-green-500/25 text-green-200';
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-dark-400 border border-dark-50 rounded-t-2xl sm:rounded-2xl w-full max-w-md shadow-2xl animate-slide-up sm:animate-scale-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-50">
          <div className="flex items-center gap-2.5">
            <Avatar name={staff.name} size={32} />
            <div>
              <p className="text-white font-semibold text-sm">{staff.name}</p>
              <p className="text-white/30 text-xs">Tap a day to view / edit times</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-white/40 hover:text-white"><XCircle size={18} /></button>
        </div>
        <div className="p-5">
          <div className="flex items-center justify-between mb-3">
            <button onClick={() => shiftMonth(-1)} className="p-2 rounded-xl hover:bg-dark-200 text-white/40 hover:text-white"><ChevronLeft size={16} /></button>
            <p className="text-white font-bold text-sm">{new Date(month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</p>
            <button onClick={() => shiftMonth(1)} className="p-2 rounded-xl hover:bg-dark-200 text-white/40 hover:text-white"><ChevronRight size={16} /></button>
          </div>
          {loading ? (
            <div className="h-48 rounded-xl bg-dark-200 animate-pulse" />
          ) : (
            <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
              {['S','M','T','W','T','F','S'].map((d, i) => <p key={i} className="text-[9px] text-white/20 text-center font-medium pb-0.5">{d}</p>)}
              {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
              {Array.from({ length: lastDay }, (_, i) => {
                const dateStr = `${month}-${String(i + 1).padStart(2, '0')}`;
                const r = byDate[dateStr];
                return (
                  <button key={dateStr} onClick={() => setDay({ date: dateStr, record: r || null })}
                    className={`aspect-square rounded-md flex items-center justify-center text-[10px] font-bold transition-all hover:ring-1 hover:ring-gold/50 active:scale-95 ${cellCls(r)}`}>
                    {i + 1}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-[10px] text-white/30">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500/25 inline-block" /> Present</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-500/25 inline-block" /> Late</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-dark-200 inline-block" /> No record</span>
          </div>
        </div>
      </div>

      {day && (
        <AttendanceDayEditor
          staffId={staff.id}
          date={day.date}
          record={day.record}
          canFullEdit={canFullEdit}
          canNudge={canNudge}
          onClose={() => setDay(null)}
          onSaved={() => { setDay(null); setReload(n => n + 1); }}
        />
      )}
    </div>,
    document.body
  );
}

function StaffTab({ canEditTimes }: { canEditTimes: boolean }) {
  const [staffList, setStaffList]   = useState<StaffMember[]>([]);
  const [loading,   setLoading]     = useState(true);
  const [enrollFor, setEnrollFor]   = useState<StaffMember | null>(null);
  const [search,    setSearch]      = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [shiftEdits, setShiftEdits] = useState<Record<string, { shiftStart: string; shiftEnd: string }>>({});
  const [savingShift,   setSavingShift]   = useState<string | null>(null);
  const [togglingRole,  setTogglingRole]  = useState<string | null>(null);
  const [calendarFor,   setCalendarFor]   = useState<StaffMember | null>(null);

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

  const toggleTour = async (s: StaffMember) => {
    try {
      await staffAPI.setTour(s.id, !s.canSelfCheckin);
      load();
    } catch {}
  };

  const toggleGender = async (s: StaffMember) => {
    const next = s.gender === 'female' ? 'male' : 'female';
    try {
      await staffAPI.setGender(s.id, next);
      load();
    } catch {}
  };

  const toggleManagerRole = async (s: StaffMember) => {
    const isManager = s.role === 'attendance_manager';
    setTogglingRole(s.id);
    try {
      await staffAPI.update(s.id, { role: isManager ? 'staff' : 'attendance_manager' });
      load();
    } catch {}
    finally { setTogglingRole(null); }
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
              <div key={s.id} className={`bg-dark-400 border border-dark-50 rounded-2xl overflow-hidden border-l-[3px] ${
                s.faceDescriptors?.length && s.canSelfCheckin ? 'border-l-amber-500/70' :
                s.faceDescriptors?.length                     ? 'border-l-green-500/50' :
                                                                'border-l-red-500/30'
              }`}>
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
                      {s.canSelfCheckin && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/12 text-amber-400 border border-amber-500/20">
                          🧳 On Tour
                        </span>
                      )}
                      {s.gender === 'female' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-pink-500/12 text-pink-400 border border-pink-500/20">
                          ♀ Women's shift
                        </span>
                      )}
                      {s.role === 'attendance_manager' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/12 text-amber-400 border border-amber-500/20">
                          Manager
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
                      onClick={() => setCalendarFor(s)}
                      className="p-1.5 rounded-xl text-white/30 hover:text-gold hover:bg-gold/10 transition-colors"
                      title="View attendance calendar"
                    >
                      <Calendar size={15} />
                    </button>
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
                      onClick={() => toggleTour(s)}
                      className={`p-1.5 rounded-xl transition-colors border text-xs
                        ${s.canSelfCheckin
                          ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                          : 'text-white/20 hover:text-amber-400 hover:bg-amber-500/10 border-white/10'}`}
                      title={s.canSelfCheckin ? 'On tour — click to disable self-scan' : 'Enable self-scan for touring staff'}
                    >
                      🧳
                    </button>
                    <button
                      onClick={() => toggleGender(s)}
                      className={`p-1.5 rounded-xl transition-colors border text-xs font-bold
                        ${s.gender === 'female'
                          ? 'text-pink-400 bg-pink-500/10 border-pink-500/20'
                          : 'text-white/20 hover:text-pink-400 hover:bg-pink-500/10 border-white/10'}`}
                      title={s.gender === 'female' ? 'Female — click to set male' : 'Set as female (women\'s shift)'}
                    >
                      ♀
                    </button>
                    <button
                      onClick={() => toggleManagerRole(s)}
                      disabled={togglingRole === s.id}
                      className={`p-1.5 rounded-xl transition-colors text-xs font-bold disabled:opacity-40
                        ${s.role === 'attendance_manager'
                          ? 'text-amber-400 bg-amber-500/10 hover:bg-red-500/10 hover:text-red-400 border border-amber-500/20'
                          : 'text-white/20 hover:text-amber-400 hover:bg-amber-500/10 border border-white/10'}`}
                      title={s.role === 'attendance_manager' ? 'Remove manager role' : 'Make attendance manager'}
                    >
                      {togglingRole === s.id ? '…' : '🛡'}
                    </button>
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
      {calendarFor && (
        <StaffAttendanceCalendar staff={calendarFor} onClose={() => setCalendarFor(null)} canFullEdit={canEditTimes} canNudge />
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
      <div className="bg-dark-400 border border-dark-50 rounded-2xl p-5 space-y-4">
        <p className="text-white font-semibold">Mark Leave</p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-white/40 text-xs mb-1 block">Staff</label>
            <Select
              value={selStaff}
              onChange={e => setSelStaff(e.target.value)}
              className="w-full bg-dark-300 border border-dark-50 rounded-xl px-3 py-2 text-white text-sm"
            >
              <option value="">Select staff…</option>
              {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
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

function SettingsTab({ onOpenKiosk }: { onOpenKiosk: () => void }) {
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
        <div>
          <p className="text-white/40 text-[10px] uppercase tracking-wider font-bold">Configuration</p>
          <p className="text-white font-bold text-base mt-0.5">Default Shift Hours</p>
        </div>
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

      {/* Women's Shift */}
      <div className="bg-dark-400 border border-dark-50 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-white/40 text-[10px] uppercase tracking-wider font-bold">Gender Hours</p>
            <p className="text-white font-bold text-base mt-0.5 flex items-center gap-2">
              <span>👩</span> Women's Shift
            </p>
            <p className="text-white/30 text-xs mt-0.5">Separate hours for female staff. Set gender on each staff member in the Staff tab.</p>
          </div>
          <button
            onClick={() => {
              if (cfg.womenShift) {
                setCfg({ ...cfg, womenShift: undefined });
              } else {
                setCfg({ ...cfg, womenShift: { shiftStart: cfg.shiftStart, shiftEnd: '19:00', expectedHours: 9.5 } });
              }
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors
              ${cfg.womenShift
                ? 'bg-pink-500/15 border-pink-500/30 text-pink-400 hover:bg-red-500/10 hover:text-red-400'
                : 'border-dark-50 text-white/30 hover:text-white hover:border-white/20'}`}
          >
            {cfg.womenShift ? 'Enabled' : 'Enable'}
          </button>
        </div>
        {cfg.womenShift && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-white/40 text-xs mb-1 block">Shift Start</label>
                <input type="time" value={cfg.womenShift.shiftStart}
                  onChange={e => setCfg({ ...cfg, womenShift: { ...cfg.womenShift!, shiftStart: e.target.value } })}
                  className="w-full bg-dark-300 border border-dark-50 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-gold/40"
                />
              </div>
              <div>
                <label className="text-white/40 text-xs mb-1 block">Shift End</label>
                <input type="time" value={cfg.womenShift.shiftEnd}
                  onChange={e => setCfg({ ...cfg, womenShift: { ...cfg.womenShift!, shiftEnd: e.target.value } })}
                  className="w-full bg-dark-300 border border-dark-50 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-gold/40"
                />
              </div>
            </div>
            <div>
              <label className="text-white/40 text-xs mb-1 block">Expected Hours/Day</label>
              <input type="number" min={1} max={24} step={0.5} value={cfg.womenShift.expectedHours}
                onChange={e => setCfg({ ...cfg, womenShift: { ...cfg.womenShift!, expectedHours: +e.target.value } })}
                className="w-full bg-dark-300 border border-dark-50 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-gold/40"
              />
            </div>
          </div>
        )}
      </div>

      <div className="bg-dark-400 border border-dark-50 rounded-2xl p-5 space-y-3">
        <div>
          <p className="text-white/40 text-[10px] uppercase tracking-wider font-bold">Security</p>
          <p className="text-white font-bold text-base mt-0.5">Kiosk PIN</p>
        </div>
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
        <button
          onClick={onOpenKiosk}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dark-50 text-white/50 hover:text-white hover:border-white/20 text-sm transition-colors"
        >
          <MonitorSmartphone size={14} />
          Open Kiosk
        </button>
      </div>

      {/* Payroll Defaults info card */}
      <div className="bg-dark-400 border border-dark-50 rounded-2xl p-5 space-y-2">
        <p className="text-white font-semibold flex items-center gap-2">
          <IndianRupee size={14} className="text-gold/60" />
          Payroll Defaults
        </p>
        <p className="text-white/30 text-xs">Per-staff salary configuration is managed in the Payroll tab. Default OT multiplier: 1.5x. Default late penalty: ₹0/min.</p>
        <p className="text-white/20 text-xs">Open the Payroll tab to set or update individual salary configs.</p>
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

// ── Tab: Holidays ──────────────────────────────────────────────────────────────
interface Holiday { id: string; date: string; label: string; type: 'holiday' | 'working'; createdBy?: string; }

function HolidaysTab() {
  const [list, setList]   = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate]   = useState('');
  const [label, setLabel] = useState('');
  const [type, setType]   = useState<'holiday' | 'working'>('holiday');
  const [saving, setSaving] = useState(false);
  const [err, setErr]     = useState('');

  const load = async () => {
    setLoading(true);
    try { setList(await holidaysAPI.list()); } catch { setList([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!date) { setErr('Pick a date'); return; }
    setSaving(true); setErr('');
    try {
      await holidaysAPI.add({ date, label: label.trim() || undefined, type });
      setDate(''); setLabel(''); setType('holiday');
      await load();
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  const remove = async (h: Holiday) => {
    if (!confirm(`Remove "${h.label}" on ${h.date}?`)) return;
    await holidaysAPI.remove(h.id);
    setList(l => l.filter(x => x.id !== h.id));
  };

  const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const isSunday = (d: string) => d && new Date(d + 'T00:00:00Z').getUTCDay() === 0;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 text-xs text-white/55 leading-relaxed">
        <b className="text-white/80">Sundays are off by default</b> every week — they're never counted as absent and never dock pay.
        Add a <b className="text-amber-300">Holiday</b> for any other day off, or open an off-day with <b className="text-green-300">Working day</b> (e.g. a Sunday in high season).
      </div>

      {/* Add form */}
      <div className="rounded-2xl bg-dark-400 border border-dark-50 p-4 space-y-3">
        <p className="text-white font-semibold text-sm flex items-center gap-2"><Plus size={14} className="text-gold" /> Add holiday / working day</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="bg-dark-300 border border-dark-50 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-gold/40 flex-1" />
          <input placeholder="Label (e.g. Diwali)" value={label} onChange={e => setLabel(e.target.value)}
            className="bg-dark-300 border border-dark-50 rounded-xl px-3 py-2.5 text-white text-sm placeholder-white/20 focus:outline-none focus:border-gold/40 flex-1" />
        </div>
        <div className="flex rounded-xl overflow-hidden border border-dark-50 w-full sm:w-auto">
          {(['holiday', 'working'] as const).map(t => (
            <button key={t} onClick={() => setType(t)}
              className={`flex-1 sm:flex-none px-4 py-2 text-xs font-semibold transition-colors ${type === t ? (t === 'working' ? 'bg-green-500/20 text-green-300' : 'bg-amber-500/20 text-amber-300') : 'text-white/40 hover:text-white/70'}`}>
              {t === 'holiday' ? '🔴 Holiday (day off)' : '🟢 Working day (open it)'}
            </button>
          ))}
        </div>
        {type === 'working' && date && !isSunday(date) && (
          <p className="text-white/35 text-[11px]">Note: this date isn't a Sunday — it's already a working day unless you also marked it a holiday.</p>
        )}
        {err && <p className="text-red-400 text-xs">{err}</p>}
        <button onClick={add} disabled={saving} className="btn-primary text-sm w-full sm:w-auto px-5">{saving ? 'Saving…' : 'Add'}</button>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">{[1, 2].map(i => <div key={i} className="h-14 rounded-2xl bg-dark-400 animate-pulse" />)}</div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl bg-dark-400 border border-dark-50 flex flex-col items-center py-10 gap-2 text-center">
          <Sun size={28} className="text-white/15" />
          <p className="text-white/40 text-sm">No custom holidays yet — only the weekly Sunday off applies</p>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map(h => (
            <div key={h.id} className={`flex items-center gap-3 px-4 py-3 rounded-2xl border bg-dark-400 ${h.type === 'working' ? 'border-green-500/25' : 'border-amber-500/25'}`}>
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${h.type === 'working' ? 'bg-green-500/15 text-green-400' : 'bg-amber-500/15 text-amber-400'}`}>
                {h.type === 'working' ? <Sun size={15} /> : <CalendarOff size={15} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-semibold truncate">{h.label}</p>
                <p className="text-white/35 text-[11px]">{fmt(h.date)} · {h.type === 'working' ? 'open / working' : 'day off'}</p>
              </div>
              <button onClick={() => remove(h)} className="p-2 rounded-lg text-white/25 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type Tab = 'today' | 'analytics' | 'monthly' | 'payroll' | 'staff' | 'leaves' | 'holidays' | 'settings';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'today',     label: 'Today',     icon: Clock },
  { id: 'analytics', label: 'Analytics', icon: TrendingUp },
  { id: 'monthly',   label: 'Monthly',   icon: Calendar },
  { id: 'payroll',   label: 'Payroll',   icon: IndianRupee },
  { id: 'staff',     label: 'Staff',     icon: Users },
  { id: 'leaves',    label: 'Leaves',    icon: CalendarOff },
  { id: 'holidays',  label: 'Holidays',  icon: CalendarDays },
  { id: 'settings',  label: 'Settings',  icon: Settings },
];

export default function AttendancePortal() {
  const { user, isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get('tab') as Tab) || 'today';
  const setTab = (t: Tab) => setSearchParams({ tab: t }, { replace: true });
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [showKiosk, setShowKiosk] = useState(false);

  // Time-edit grant: admins edit times anytime; managers only during a granted window.
  const [grant, setGrant] = useState<{ active: boolean; expiresAt: string | null; grantedBy: string | null } | null>(null);
  const [granting, setGranting] = useState(false);
  const loadGrant = useCallback(() => { attendanceAPI.editGrant().then(setGrant).catch(() => {}); }, []);
  useEffect(() => {
    loadGrant();
    const t = setInterval(loadGrant, 60_000); // refresh so expiry reflects automatically
    return () => clearInterval(t);
  }, [loadGrant]);

  const grantActive = !!(grant?.active && grant.expiresAt && new Date(grant.expiresAt).getTime() > Date.now());
  const canEditTimes = isAdmin || (user?.role === 'attendance_manager' && grantActive);

  const doGrant = async (hours: number) => { setGranting(true); try { setGrant(await attendanceAPI.grantEdit(hours)); } finally { setGranting(false); } };
  const doRevoke = async () => { setGranting(true); try { setGrant(await attendanceAPI.revokeEdit()); } finally { setGranting(false); } };
  const grantUntil = grantActive && grant?.expiresAt
    ? new Date(grant.expiresAt).toLocaleString('en-IN', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: true })
    : '';

  return (
    <div className="space-y-5 relative">
      {/* Kiosk overlay — rendered at document.body via portal so it covers
          the nav sidebar (which has z-50 + CSS transform stacking context) */}
      {showKiosk && createPortal(
        <KioskView pin="__auto__" onClose={() => setShowKiosk(false)} />,
        document.body
      )}
      {/* Page header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div className="h-[2px] w-8 bg-gradient-to-r from-gold to-transparent rounded-full" />
            <p className="text-gold/60 text-[10px] uppercase tracking-[0.22em] font-bold">Manager Portal</p>
          </div>
          <h1 className="text-white font-black text-2xl leading-tight">Attendance</h1>
          <p className="text-white/30 text-xs mt-0.5 hidden sm:block">Track staff hours, leaves and face recognition</p>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => setBroadcastOpen(true)}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-xl border border-dark-50 text-white/40 hover:text-white hover:border-white/20 text-xs font-semibold transition-colors"
            title="Send broadcast to all staff"
          >
            <Megaphone size={13} />
            <span className="hidden sm:inline">Broadcast</span>
          </button>
        </div>
      </div>

      {/* ── LOG ATTENDANCE — the manager's primary action, opens the face kiosk ── */}
      <button
        onClick={() => setShowKiosk(true)}
        className="group relative w-full overflow-hidden rounded-3xl border border-gold/30 p-6 sm:p-8 text-left transition-transform active:scale-[0.99] hover:border-gold/50"
        style={{
          background: 'linear-gradient(135deg, rgba(212,175,55,0.24), rgba(212,175,55,0.06) 45%, rgba(20,20,22,0.55))',
          boxShadow: '0 0 55px rgba(212,175,55,0.18)',
        }}
      >
        <span className="pointer-events-none absolute inset-0 opacity-70"
          style={{ background: 'radial-gradient(130% 130% at 100% 0%, rgba(212,175,55,0.28), transparent 55%)' }} />
        <div className="relative flex items-center gap-4 sm:gap-6">
          <div className="relative flex-shrink-0">
            <div className="w-16 h-16 sm:w-24 sm:h-24 rounded-3xl bg-gold/20 border border-gold/45 flex items-center justify-center group-hover:bg-gold/28 transition-colors">
              <ScanFace size={42} className="text-gold" style={{ filter: 'drop-shadow(0 0 10px rgba(212,175,55,0.7))' }} />
            </div>
            <span className="absolute inset-0 rounded-3xl border-2 border-gold/40 animate-ping opacity-25" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-gold/70 text-[10px] sm:text-[11px] uppercase tracking-[0.28em] font-bold">Tap to start</p>
            <p className="text-white font-black text-3xl sm:text-5xl leading-none mt-1.5">Log Attendance</p>
            <p className="text-white/45 text-xs sm:text-base mt-2.5">Open the face-recognition kiosk</p>
          </div>
          <ArrowRight size={32} className="text-gold/50 group-hover:text-gold group-hover:translate-x-1.5 transition-all flex-shrink-0" />
        </div>
      </button>

      {/* ── Time-edit access ──────────────────────────────────────────────────
          Admin: grant a manager a time-limited window to fix check-in/out times
          from the physical register. Manager: read-only status of their access. */}
      {isAdmin ? (
        <div className={`rounded-2xl border p-4 transition-colors ${grantActive ? 'border-green-500/30 bg-gradient-to-br from-green-500/10 to-dark-400' : 'border-dark-50 bg-dark-400'}`}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 border ${grantActive ? 'bg-green-500/15 border-green-500/30' : 'bg-dark-300 border-dark-100'}`}>
                <Edit2 size={16} className={grantActive ? 'text-green-400' : 'text-white/35'} />
              </div>
              <div className="min-w-0">
                <p className="text-white text-sm font-bold flex items-center gap-2">
                  Manager time-edit access
                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${grantActive ? 'bg-green-500/20 text-green-300' : 'bg-white/8 text-white/40'}`}>
                    {grantActive ? 'ON' : 'OFF'}
                  </span>
                </p>
                <p className="text-white/40 text-xs mt-0.5">
                  {grantActive ? `Managers can fix register times until ${grantUntil}` : 'Managers can only nudge times ±10 min until you grant access'}
                </p>
              </div>
            </div>
            {grantActive ? (
              <button onClick={doRevoke} disabled={granting}
                className="px-4 py-2 rounded-xl bg-red-500/15 border border-red-500/25 text-red-300 text-xs font-bold hover:bg-red-500/25 transition-colors active:scale-95">
                Revoke now
              </button>
            ) : (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-white/30 text-[10px] font-semibold uppercase tracking-wider mr-1 hidden sm:inline">Grant</span>
                {([['2h', 2], ['8h', 8], ['24h', 24]] as const).map(([label, h]) => (
                  <button key={label} onClick={() => doGrant(h)} disabled={granting}
                    className="px-3.5 py-2 rounded-xl bg-gold/12 border border-gold/30 text-gold text-xs font-bold hover:bg-gold/22 transition-colors disabled:opacity-40 active:scale-95">
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : user?.role === 'attendance_manager' && (
        <div className={`rounded-2xl border px-4 py-3 flex items-center gap-2.5 text-xs ${grantActive ? 'border-green-500/30 bg-gradient-to-br from-green-500/10 to-dark-400 text-green-300' : 'border-white/10 bg-dark-400 text-white/55'}`}>
          <Edit2 size={14} className={grantActive ? 'text-green-400 flex-shrink-0' : 'text-white/40 flex-shrink-0'} />
          <span>{grantActive
            ? <><b className="text-white">Edit access active</b> until {grantUntil} — set or fix any check-in/out time from the register.</>
            : <><b className="text-white/80">Edit access off.</b> You can move a time ≤10 min earlier; ask an admin for full access to set/enter times.</>}</span>
        </div>
      )}

      {/* Section nav on the LEFT (vertical on desktop), content on the right.
          On mobile it falls back to a horizontal scrolling pill bar up top. */}
      <div className="lg:grid lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-5">
        {/* Left rail */}
        <nav className="lg:sticky lg:top-2 lg:self-start mb-3 lg:mb-0">
          <div className="lg:hidden text-white/30 text-[10px] uppercase tracking-[0.2em] font-bold px-1 mb-1.5">Sections</div>
          <div className="flex lg:flex-col gap-1 overflow-x-auto no-scrollbar rounded-2xl border border-dark-50 bg-dark-400/70 backdrop-blur-xl p-1.5">
            {TABS.map(t => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-all flex-shrink-0 lg:w-full ${
                    active
                      ? 'bg-gold text-black shadow-md shadow-gold/25'
                      : 'text-white/45 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Icon size={16} className="flex-shrink-0" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Active section content */}
        <div className="min-w-0">
          {tab === 'today'     && <TodayTab canEditTimes={canEditTimes} />}
          {tab === 'analytics' && <AnalyticsTab />}
          {tab === 'monthly'   && <MonthlyTab />}
          {tab === 'payroll'   && <PayrollTab />}
          {tab === 'staff'     && <StaffTab canEditTimes={canEditTimes} />}
          {tab === 'leaves'    && <LeavesTab />}
          {tab === 'holidays'  && <HolidaysTab />}
          {tab === 'settings'  && <SettingsTab onOpenKiosk={() => setShowKiosk(true)} />}
        </div>
      </div>

      {broadcastOpen && <BroadcastModal onClose={() => setBroadcastOpen(false)} />}
    </div>
  );
}
