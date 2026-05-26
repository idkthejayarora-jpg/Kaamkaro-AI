/**
 * AttendanceKiosk — face-recognition attendance kiosk.
 *
 * Exports:
 *   default  AttendanceKiosk  — standalone full-screen page at /kiosk (PIN protected)
 *   named    KioskView        — embeddable inline component (no PIN, for portal overlay)
 *
 * Layout is responsive:
 *   Mobile  — camera fills screen, bottom sheet slides up for status/enrollment
 *   Desktop — camera left (flex-1), side panel right (w-72)
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import * as faceapi from '@vladmandic/face-api';
import { X } from 'lucide-react';
import { kioskAPI } from '../lib/api';
import Select from '../components/Select';

// ── Types ──────────────────────────────────────────────────────────────────────

interface StaffDescriptor {
  id: string; name: string; avatar: string;
  faceDescriptors: number[][];
}
interface TodayRecord {
  staffId: string; staffName: string; avatar: string;
  status: 'in' | 'out' | 'absent'; loginAt: string | null;
}
interface StaffBasic { id: string; name: string; avatar: string; }

type KioskState =
  | 'pin'        // PIN lock (standalone only)
  | 'loading'    // loading face models
  | 'idle'       // camera live, detecting
  | 'matched'    // face matched — confirming
  | 'processing' // API call
  | 'success'    // check-in/out done
  | 'error'      // error
  | 'enrolling'; // unknown face — link or create staff

const MATCH_THRESHOLD = 0.5;
const COOLDOWN_MS     = 60_000;
const CONFIRM_SECS    = 3;

function now12h() {
  return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}
function todayLong() {
  return new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ── PIN Screen ─────────────────────────────────────────────────────────────────

function PinScreen({ onUnlock }: { onUnlock: (pin: string) => void }) {
  const [entered, setEntered] = useState('');
  const [shake,   setShake]   = useState(false);
  const DIGITS = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

  const press = (d: string) => {
    if (d === '⌫') { setEntered(p => p.slice(0, -1)); return; }
    if (d === '') return;
    const next = entered + d;
    setEntered(next);
    if (next.length >= 4) {
      onUnlock(next);
      setTimeout(() => setEntered(''), 500);
    }
  };

  return (
    <div className="fixed inset-0 bg-dark-500 flex flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl bg-gold/15 border border-gold/25 flex items-center justify-center mx-auto mb-4">
          <span className="text-gold font-black text-2xl">K</span>
        </div>
        <p className="text-white font-bold text-xl">Attendance Kiosk</p>
        <p className="text-white/30 text-sm mt-1">Enter PIN to unlock</p>
      </div>
      <div className={`flex gap-4 ${shake ? 'animate-wiggle' : ''}`}>
        {[0,1,2,3].map(i => (
          <div key={i} className={`w-4 h-4 rounded-full border-2 transition-colors ${i < entered.length ? 'bg-gold border-gold' : 'border-white/20'}`} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3 w-full max-w-[240px]">
        {DIGITS.map((d, i) => (
          <button
            key={i}
            onClick={() => press(d)}
            disabled={!d && d !== '0'}
            className={`h-14 rounded-2xl text-xl font-semibold transition-all active:scale-95
              ${d ? 'bg-dark-300 hover:bg-dark-200 border border-dark-50 text-white active:bg-dark-100' : 'opacity-0 pointer-events-none'}`}
          >
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── KioskView — embeddable camera + detection + enrollment ─────────────────────

export function KioskView({ pin, onClose }: { pin: string; onClose?: () => void }) {
  const [kioskState,    setKioskState]    = useState<KioskState>('loading');
  const [modelStatus,   setModelStatus]   = useState('');
  const [descriptors,   setDescriptors]   = useState<StaffDescriptor[]>([]);
  const [todayStatus,   setTodayStatus]   = useState<TodayRecord[]>([]);
  const [time,          setTime]          = useState(now12h());
  const [matched,       setMatched]       = useState<StaffDescriptor | null>(null);
  const [actionType,    setActionType]    = useState<'checkin' | 'checkout'>('checkin');
  const [countdown,     setCountdown]     = useState(CONFIRM_SECS);
  const [successMsg,    setSuccessMsg]    = useState('');
  const [isLate,        setIsLate]        = useState(false);
  const [lateMinutes,   setLateMinutes]   = useState(0);
  const [errorMsg,      setErrorMsg]      = useState('');
  const [hasUnknown,    setHasUnknown]    = useState(false);

  // Enrollment
  const [enrollStaffList, setEnrollStaffList] = useState<StaffBasic[]>([]);
  const [enrollMode,      setEnrollMode]      = useState<'select' | 'create'>('select');
  const [enrollStaffId,   setEnrollStaffId]   = useState('');
  const [enrollNewName,   setEnrollNewName]   = useState('');
  const [enrollNewPhone,  setEnrollNewPhone]  = useState('');
  const [enrollBusy,      setEnrollBusy]      = useState(false);
  const [enrollMsg,       setEnrollMsg]       = useState('');

  const videoRef        = useRef<HTMLVideoElement>(null);
  const canvasRef       = useRef<HTMLCanvasElement>(null);
  const streamRef       = useRef<MediaStream | null>(null);
  const detectRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const cooldownRef     = useRef<Record<string, number>>({});
  const countdownRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const confirmedRef    = useRef(false);
  const faceMatcherRef  = useRef<faceapi.FaceMatcher | null>(null);
  const unknownDescRef  = useRef<Float32Array | null>(null);
  // Refs that mirror state — lets the detection interval read current values
  // without being listed as a dependency (prevents interval restart on every tick)
  const descriptorsRef  = useRef<StaffDescriptor[]>([]);
  const todayStatusRef  = useRef<TodayRecord[]>([]);
  const hasUnknownRef   = useRef(false);

  // Rebuild FaceMatcher when descriptors change + keep ref in sync
  useEffect(() => {
    descriptorsRef.current = descriptors;
    if (!descriptors.length) { faceMatcherRef.current = null; return; }
    try {
      const labeled = descriptors.map(s =>
        new faceapi.LabeledFaceDescriptors(s.id, s.faceDescriptors.map(d => new Float32Array(d)))
      );
      faceMatcherRef.current = new faceapi.FaceMatcher(labeled, MATCH_THRESHOLD);
    } catch { faceMatcherRef.current = null; }
  }, [descriptors]);

  // Keep today-status ref in sync
  useEffect(() => { todayStatusRef.current = todayStatus; }, [todayStatus]);

  // Clock
  useEffect(() => {
    const t = setInterval(() => setTime(now12h()), 5000);
    return () => clearInterval(t);
  }, []);

  // ── Load models + camera ────────────────────────────────────────────────────

  useEffect(() => {
    if (kioskState !== 'loading') return;
    let cancelled = false;

    async function init() {
      try {
        setModelStatus('Loading face models…');
        const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        ]);
        if (cancelled) return;

        setModelStatus('Starting camera…');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        // Load staff descriptors
        try { setDescriptors(await kioskAPI.descriptors(pin)); } catch {}
        if (!cancelled) setKioskState('idle');
      } catch (err) {
        if (!cancelled) {
          setModelStatus('Camera access denied — please allow camera permissions');
          console.error('[KioskView init]', err);
        }
      }
    }

    init();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (detectRef.current) clearInterval(detectRef.current);
    };
  }, [kioskState, pin]);

  // Refresh today status
  const refreshToday = useCallback(async () => {
    try { setTodayStatus(await kioskAPI.today(pin)); } catch {}
  }, [pin]);

  useEffect(() => {
    if (kioskState === 'idle' || kioskState === 'matched' || kioskState === 'success') {
      refreshToday();
      const t = setInterval(refreshToday, 30_000);
      return () => clearInterval(t);
    }
  }, [kioskState, refreshToday]);

  // ── Detection loop ──────────────────────────────────────────────────────────

  const triggerMatch = useCallback((staff: StaffDescriptor, isCheckin: boolean) => {
    setMatched(staff);
    setActionType(isCheckin ? 'checkin' : 'checkout');
    setCountdown(CONFIRM_SECS);
    confirmedRef.current = false;
    setKioskState('matched');
  }, []);

  useEffect(() => {
    if (kioskState !== 'idle') return;
    if (detectRef.current) clearInterval(detectRef.current);

    detectRef.current = setInterval(async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 3) return;

      const det = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.5 }))
        .withFaceLandmarks(true)
        .withFaceDescriptor();

      // Draw bounding box — read canvas dims from actual video element each tick
      const canvas = canvasRef.current;
      if (canvas && video.videoWidth > 0) {
        if (canvas.width !== video.videoWidth)  canvas.width  = video.videoWidth;
        if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (det) {
            const resized = faceapi.resizeResults(det,
              { width: video.videoWidth, height: video.videoHeight });
            ctx.strokeStyle = 'rgba(212,175,55,0.85)';
            ctx.lineWidth   = 2;
            const { x, y, width, height } = resized.detection.box;
            ctx.beginPath();
            ctx.roundRect(x, y, width, height, 6);
            ctx.stroke();
          }
        }
      }

      // Read volatile values from refs — no dependency on state
      const hasUnk  = hasUnknownRef.current;
      const descs   = descriptorsRef.current;
      const today   = todayStatusRef.current;
      const matcher = faceMatcherRef.current;

      if (!det) {
        if (hasUnk) { hasUnknownRef.current = false; setHasUnknown(false); unknownDescRef.current = null; }
        return;
      }

      if (!matcher) {
        // No enrolled staff yet — offer enrollment
        unknownDescRef.current = det.descriptor;
        if (!hasUnk) { hasUnknownRef.current = true; setHasUnknown(true); }
        return;
      }

      const bestMatch = matcher.findBestMatch(det.descriptor);
      if (bestMatch.label !== 'unknown') {
        if (hasUnk) { hasUnknownRef.current = false; setHasUnknown(false); unknownDescRef.current = null; }
        const matchedStaff = descs.find(s => s.id === bestMatch.label);
        if (!matchedStaff) return;
        if ((cooldownRef.current[matchedStaff.id] || 0) > Date.now()) return;
        const todayRec = today.find(r => r.staffId === matchedStaff.id);
        triggerMatch(matchedStaff, !todayRec || todayRec.status === 'out');
      } else {
        unknownDescRef.current = det.descriptor;
        if (!hasUnk) { hasUnknownRef.current = true; setHasUnknown(true); }
      }
    }, 600);

    return () => { if (detectRef.current) clearInterval(detectRef.current); };
  // Only restart when kioskState changes — everything else read from refs
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kioskState]);

  // ── Confirm action ──────────────────────────────────────────────────────────

  const confirmAction = useCallback(async () => {
    if (confirmedRef.current || !matched) return;
    confirmedRef.current = true;
    if (countdownRef.current) clearInterval(countdownRef.current);
    setKioskState('processing');
    try {
      let result;
      if (actionType === 'checkin') result = await kioskAPI.checkin(pin, matched.id);
      else                          result = await kioskAPI.checkout(pin, matched.id);
      setIsLate(result.isLate || false);
      setLateMinutes(result.lateMinutes || 0);
      setSuccessMsg(`${actionType === 'checkin' ? 'Checked in' : 'Checked out'} — ${result.isLate ? `${result.lateMinutes} mins late` : 'On time'}`);
      cooldownRef.current[matched.id] = Date.now() + COOLDOWN_MS;
      setKioskState('success');
      refreshToday();
      setTimeout(() => { setKioskState('idle'); setMatched(null); setSuccessMsg(''); }, 4000);
    } catch {
      setErrorMsg('Action failed — please try again.');
      setKioskState('error');
      setTimeout(() => { setKioskState('idle'); setErrorMsg(''); setMatched(null); }, 3000);
    }
  }, [matched, actionType, pin, refreshToday]);

  useEffect(() => {
    if (kioskState !== 'matched') return;
    if (countdownRef.current) clearInterval(countdownRef.current);
    let c = CONFIRM_SECS;
    setCountdown(c);
    countdownRef.current = setInterval(() => {
      c--;
      setCountdown(c);
      if (c <= 0) { clearInterval(countdownRef.current!); confirmAction(); }
    }, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [kioskState, confirmAction]);

  const cancelMatch = () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    confirmedRef.current = false;
    setMatched(null);
    setKioskState('idle');
  };

  // ── Enrollment ──────────────────────────────────────────────────────────────

  const openEnroll = useCallback(async () => {
    if (detectRef.current) clearInterval(detectRef.current);
    setKioskState('enrolling');
    setEnrollMode('select');
    setEnrollStaffId('');
    setEnrollNewName('');
    setEnrollNewPhone('');
    setEnrollMsg('');
    try { setEnrollStaffList(await kioskAPI.staffList(pin)); } catch { setEnrollStaffList([]); }
  }, [pin]);

  const cancelEnroll = useCallback(() => {
    hasUnknownRef.current = false;
    setHasUnknown(false);
    unknownDescRef.current = null;
    setEnrollMsg('');
    setKioskState('idle');
  }, []);

  const captureAndEnroll = useCallback(async (staffId: string) => {
    if (!videoRef.current) return;
    setEnrollBusy(true);
    setEnrollMsg('Capturing face…');
    try {
      const captures: Float32Array[] = [];
      if (unknownDescRef.current) captures.push(unknownDescRef.current);
      while (captures.length < 5) {
        await new Promise(r => setTimeout(r, 400));
        const det = await faceapi
          .detectSingleFace(videoRef.current!, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.4 }))
          .withFaceLandmarks(true).withFaceDescriptor();
        if (det) captures.push(det.descriptor);
      }
      if (captures.length === 0) { setEnrollMsg('No face — look at the camera'); setEnrollBusy(false); return; }
      await kioskAPI.enroll(pin, staffId, captures.map(d => Array.from(d)));
      setEnrollMsg('✓ Face enrolled!');
      const updated = await kioskAPI.descriptors(pin);
      setDescriptors(updated);
      setTimeout(() => cancelEnroll(), 1500);
    } catch { setEnrollMsg('Enrollment failed — try again'); setEnrollBusy(false); }
  }, [pin, cancelEnroll]);

  const handleEnrollLink = useCallback(async () => {
    if (enrollMode === 'select') {
      if (!enrollStaffId) { setEnrollMsg('Select a staff member'); return; }
      await captureAndEnroll(enrollStaffId);
    } else {
      if (!enrollNewName.trim()) { setEnrollMsg('Enter a name'); return; }
      setEnrollBusy(true);
      setEnrollMsg('Creating staff…');
      try {
        const s = await kioskAPI.quickStaff(pin, enrollNewName.trim(), enrollNewPhone.trim() || undefined);
        await captureAndEnroll(s.id);
      } catch (e: unknown) {
        const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setEnrollMsg(msg || 'Failed to create staff');
        setEnrollBusy(false);
      }
    }
  }, [enrollMode, enrollStaffId, enrollNewName, enrollNewPhone, pin, captureAndEnroll]);

  // ── Computed ────────────────────────────────────────────────────────────────

  const inCount  = todayStatus.filter(r => r.status === 'in').length;
  const allCount = todayStatus.length;

  // Whether the bottom panel is "expanded" (has content beyond just dots)
  const panelExpanded = kioskState === 'enrolling'
    || kioskState === 'matched'
    || kioskState === 'processing'
    || kioskState === 'success'
    || (kioskState === 'idle' && hasUnknown)
    || (kioskState === 'error' && !!errorMsg);

  // ── Main render ─────────────────────────────────────────────────────────────
  // IMPORTANT: <video> + <canvas> are ALWAYS rendered so the stream can be
  // attached during the loading phase (videoRef.current must be non-null when
  // init() calls video.srcObject = stream). Loading UI is an overlay, not an
  // early return that would unmount the video element.

  return (
    <div className="fixed inset-0 bg-black overflow-hidden select-none" style={{ fontFamily: 'inherit', zIndex: 50 }}>

      {/* ── Camera (full background) — always in DOM ── */}
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        className="absolute inset-0 w-full h-full object-cover"
        style={{ transform: 'scaleX(-1)' }}
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ transform: 'scaleX(-1)' }}
      />

      {/* ── Loading overlay — on top of camera, not instead of it ── */}
      {kioskState === 'loading' && (
        <div className="absolute inset-0 bg-dark-500/95 backdrop-blur-sm flex flex-col items-center justify-center gap-4 z-40">
          {onClose && (
            <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-xl bg-dark-300 text-white/40 hover:text-white transition-colors">
              <X size={18} />
            </button>
          )}
          <div className="w-10 h-10 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          <p className="text-white/50 text-sm">{modelStatus || 'Starting…'}</p>
        </div>
      )}

      {/* ── Everything below only shown after loading ── */}
      {kioskState !== 'loading' && (
        <>
      {/* Scan line — idle only */}
      {kioskState === 'idle' && (
        <div className="absolute left-0 right-0 h-px bg-gold/25 pointer-events-none"
          style={{ animation: 'scanLine 3s ease-in-out infinite' }} />
      )}

      {/* Idle camera hint */}
      {kioskState === 'idle' && !hasUnknown && (
        <div className="absolute bottom-28 md:bottom-8 left-0 right-0 md:right-72 text-center pointer-events-none">
          <p className="text-white/30 text-sm font-medium drop-shadow-lg">Look at the camera to check in / check out</p>
        </div>
      )}

      {/* ── Header bar ── */}
      <div className="absolute top-0 left-0 right-0 md:right-72 flex items-center justify-between px-4 py-3
        bg-black/50 backdrop-blur-sm border-b border-white/5 z-20">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gold/15 border border-gold/25 flex items-center justify-center">
            <span className="text-gold font-black text-sm">K</span>
          </div>
          <span className="text-white/70 text-sm font-semibold hidden sm:block">Attendance</span>
        </div>
        <div className="text-center">
          <p className="text-white font-bold text-base sm:text-lg leading-tight">{time}</p>
          <p className="text-white/30 text-[10px] sm:text-xs">{todayLong()}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-white/40 text-xs">{inCount}/{allCount} in</span>
          {onClose ? (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/60 hover:text-white transition-colors ml-1"
              title="Close kiosk"
            >
              <X size={15} />
            </button>
          ) : (
            <button
              onClick={() => { sessionStorage.removeItem('kiosk_pin'); window.location.reload(); }}
              className="p-1.5 rounded-lg hover:bg-dark-200 hover:text-white text-white/30 transition-colors ml-1 text-[10px]"
              title="Lock"
            >🔒</button>
          )}
        </div>
      </div>

      {/* ── Side panel (desktop right) / Bottom sheet (mobile) ── */}
      <div className={`
        absolute left-0 right-0 bottom-0 z-30
        md:top-0 md:left-auto md:right-0 md:w-72 md:bottom-0
        bg-dark-400/95 md:bg-dark-400 backdrop-blur-xl md:backdrop-blur-none
        border-t border-white/5 md:border-t-0 md:border-l md:border-white/5
        transition-all duration-300 ease-out
        ${panelExpanded ? 'max-h-[60vh] md:max-h-none' : 'max-h-24 md:max-h-none'}
        overflow-y-auto md:overflow-y-auto md:flex md:flex-col md:pt-14
      `}>

        {/* Panel content */}
        <div className="flex flex-col items-center justify-center p-4 md:p-6 md:flex-1">

          {/* ── Idle / Error ── */}
          {(kioskState === 'idle' || kioskState === 'error') && (
            <div className="w-full">
              {hasUnknown ? (
                // Unknown face — offer enrollment
                <div className="flex items-center gap-3 md:flex-col md:gap-4 md:text-center">
                  <div className="w-12 h-12 md:w-16 md:h-16 rounded-xl md:rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-xl md:text-3xl">🔍</span>
                  </div>
                  <div className="flex-1 md:flex-none">
                    <p className="text-amber-400 font-semibold text-sm">Unknown Face</p>
                    <p className="text-white/30 text-xs">Not enrolled yet</p>
                  </div>
                  <button
                    onClick={openEnroll}
                    className="flex-shrink-0 md:w-full px-4 py-2 md:py-2.5 rounded-xl bg-gold/15 border border-gold/30 text-gold font-semibold text-xs md:text-sm hover:bg-gold/25 transition-all active:scale-95"
                  >
                    + Enroll
                  </button>
                </div>
              ) : (
                // Waiting — compact on mobile
                <div className="flex items-center justify-between md:flex-col md:justify-center md:gap-4 md:text-center">
                  <div className="flex items-center gap-2 md:flex-col md:gap-0">
                    <span className="text-2xl md:text-4xl md:mb-2">👤</span>
                    <p className="text-white/20 text-xs md:text-sm">Waiting for face…</p>
                  </div>
                  {/* Today dots — visible in compact state on mobile */}
                  <div className="flex gap-1.5 flex-wrap justify-end md:hidden max-w-[140px]">
                    {todayStatus.slice(0, 8).map(r => (
                      <div
                        key={r.staffId}
                        title={`${r.staffName} — ${r.status}`}
                        className="w-6 h-6 rounded-md flex items-center justify-center text-[9px] font-bold"
                        style={{
                          background: r.status === 'in' ? 'rgba(74,222,128,0.15)' : r.status === 'out' ? 'rgba(96,165,250,0.10)' : 'rgba(255,255,255,0.05)',
                          border: r.status === 'in' ? '1px solid rgba(74,222,128,0.3)' : r.status === 'out' ? '1px solid rgba(96,165,250,0.2)' : '1px solid rgba(255,255,255,0.08)',
                          color: r.status === 'in' ? '#4ade80' : r.status === 'out' ? '#60a5fa' : 'rgba(255,255,255,0.2)',
                        }}
                      >
                        {r.staffName.split(' ').map(w => w[0]).join('').slice(0, 2)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {errorMsg && <p className="text-red-400 text-xs text-center mt-2">{errorMsg}</p>}
            </div>
          )}

          {/* ── Matched / Processing ── */}
          {(kioskState === 'matched' || kioskState === 'processing') && matched && (
            <div className="w-full space-y-3 text-center">
              <div className="flex items-center gap-3 md:flex-col md:gap-4">
                <div className="w-14 h-14 md:w-20 md:h-20 rounded-xl md:rounded-2xl bg-dark-300 border border-dark-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-white/60 font-black text-xl md:text-2xl">
                    {matched.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 text-left md:text-center">
                  <p className="text-white font-bold text-base md:text-xl">{matched.name}</p>
                  <p className="text-white/40 text-xs md:text-sm">
                    {actionType === 'checkin' ? '→ Checking In' : '← Checking Out'}
                  </p>
                  <p className="text-white/30 text-[10px] md:text-xs">{now12h()}</p>
                </div>
                {kioskState === 'matched' && (
                  <div className="relative w-12 h-12 md:w-16 md:h-16 flex-shrink-0 md:mx-auto">
                    <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
                      <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="4" />
                      <circle cx="32" cy="32" r="28" fill="none"
                        stroke={actionType === 'checkin' ? '#4ade80' : '#60a5fa'}
                        strokeWidth="4" strokeLinecap="round"
                        strokeDasharray="175.9"
                        strokeDashoffset={`${175.9 * (1 - countdown / CONFIRM_SECS)}`}
                        style={{ transition: 'stroke-dashoffset 1s linear' }}
                      />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-white font-black text-xl md:text-2xl">{countdown}</span>
                  </div>
                )}
                {kioskState === 'processing' && (
                  <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin flex-shrink-0" />
                )}
              </div>
              {kioskState === 'matched' && (
                <button onClick={cancelMatch} className="text-white/25 text-xs hover:text-white/50 transition-colors">
                  Cancel
                </button>
              )}
            </div>
          )}

          {/* ── Success ── */}
          {kioskState === 'success' && matched && (
            <div className="w-full space-y-3 text-center">
              <div className="flex items-center gap-3 md:flex-col md:gap-4">
                <div className="w-14 h-14 md:w-20 md:h-20 rounded-xl md:rounded-2xl bg-green-500/15 border border-green-500/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-2xl md:text-4xl">{actionType === 'checkin' ? '✓' : '👋'}</span>
                </div>
                <div className="flex-1 text-left md:text-center">
                  <p className="text-white font-bold text-base md:text-xl">{matched.name}</p>
                  <p className="text-green-400 font-semibold text-sm">{successMsg}</p>
                  {isLate && lateMinutes > 0 && (
                    <p className="text-amber-400 text-xs mt-0.5">⚠ {lateMinutes} mins late</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Enrolling ── */}
          {kioskState === 'enrolling' && (
            <div className="w-full space-y-3">
              <div className="flex items-center gap-3 md:flex-col md:text-center mb-1">
                <div className="w-12 h-12 md:w-14 md:h-14 rounded-xl bg-gold/10 border border-gold/25 flex items-center justify-center flex-shrink-0">
                  <span className="text-2xl">🆔</span>
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">Enroll Face</p>
                  <p className="text-white/30 text-xs">Link this face to a staff member</p>
                </div>
              </div>

              {/* Mode toggle */}
              <div className="flex rounded-xl overflow-hidden border border-dark-50">
                <button
                  onClick={() => setEnrollMode('select')}
                  className={`flex-1 py-2 text-xs font-semibold transition-colors
                    ${enrollMode === 'select' ? 'bg-gold/20 text-gold' : 'text-white/30 hover:text-white/60'}`}
                >
                  Select Staff
                </button>
                <button
                  onClick={() => setEnrollMode('create')}
                  className={`flex-1 py-2 text-xs font-semibold transition-colors border-l border-dark-50
                    ${enrollMode === 'create' ? 'bg-gold/20 text-gold' : 'text-white/30 hover:text-white/60'}`}
                >
                  New Staff
                </button>
              </div>

              {enrollMode === 'select' ? (
                <Select
                  value={enrollStaffId}
                  onChange={e => setEnrollStaffId(e.target.value)}
                  className="w-full bg-dark-200 border border-dark-50 rounded-xl px-3 py-2.5 text-sm"
                >
                  <option value="">— Select staff member —</option>
                  {enrollStaffList.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </Select>
              ) : (
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Full name *"
                    value={enrollNewName}
                    onChange={e => setEnrollNewName(e.target.value)}
                    className="w-full bg-dark-200 border border-dark-50 rounded-xl px-3 py-2.5 text-white text-sm placeholder-white/20 focus:outline-none focus:border-gold/40"
                  />
                  <input
                    type="text"
                    placeholder="Phone (optional)"
                    value={enrollNewPhone}
                    onChange={e => setEnrollNewPhone(e.target.value)}
                    className="w-full bg-dark-200 border border-dark-50 rounded-xl px-3 py-2.5 text-white text-sm placeholder-white/20 focus:outline-none focus:border-gold/40"
                  />
                </div>
              )}

              {enrollMsg && (
                <p className={`text-xs text-center ${enrollMsg.startsWith('✓') ? 'text-green-400' : 'text-amber-400'}`}>
                  {enrollMsg}
                </p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleEnrollLink}
                  disabled={enrollBusy}
                  className="flex-1 py-2.5 rounded-xl bg-gold text-black text-sm font-bold hover:bg-gold/90 transition disabled:opacity-40"
                >
                  {enrollBusy ? 'Saving…' : 'Link Face'}
                </button>
                <button
                  onClick={cancelEnroll}
                  disabled={enrollBusy}
                  className="px-3 py-2.5 rounded-xl border border-dark-50 text-white/40 hover:text-white text-sm transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Today dots — desktop only sidebar section */}
        <div className="hidden md:block border-t border-white/5 p-4 flex-shrink-0">
          <p className="text-white/25 text-[10px] uppercase tracking-wider mb-2">Today</p>
          <div className="flex flex-wrap gap-2">
            {todayStatus.map(r => (
              <div
                key={r.staffId}
                title={`${r.staffName} — ${r.status}`}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold"
                style={{
                  background: r.status === 'in' ? 'rgba(74,222,128,0.15)' : r.status === 'out' ? 'rgba(96,165,250,0.10)' : 'rgba(255,255,255,0.05)',
                  border: r.status === 'in' ? '1px solid rgba(74,222,128,0.3)' : r.status === 'out' ? '1px solid rgba(96,165,250,0.2)' : '1px solid rgba(255,255,255,0.08)',
                  color: r.status === 'in' ? '#4ade80' : r.status === 'out' ? '#60a5fa' : 'rgba(255,255,255,0.2)',
                }}
              >
                {r.staffName.split(' ').map(w => w[0]).join('').slice(0, 2)}
              </div>
            ))}
          </div>
        </div>
      </div>
      </> /* end kioskState !== 'loading' */
      )}

      {/* Scan line CSS */}
      <style>{`
        @keyframes scanLine {
          0%   { top: 15%; opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { top: 85%; opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ── Standalone Kiosk (PIN-protected, at /kiosk route) ─────────────────────────

export default function AttendanceKiosk() {
  const [pin,      setPin]      = useState('');
  const [pinError, setPinError] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  const unlock = useCallback(async (enteredPin: string) => {
    try {
      await kioskAPI.descriptors(enteredPin); // validates PIN
      setPin(enteredPin);
      sessionStorage.setItem('kiosk_pin', enteredPin);
      setUnlocked(true);
    } catch {
      setPinError(true);
      setTimeout(() => setPinError(false), 1500);
    }
  }, []);

  // Restore saved PIN or check auto-unlock
  useEffect(() => {
    const auto = sessionStorage.getItem('kk_kiosk_autounlock');
    if (auto) {
      sessionStorage.removeItem('kk_kiosk_autounlock');
      setPin('__auto__');
      setUnlocked(true);
      return;
    }
    const saved = sessionStorage.getItem('kiosk_pin');
    if (saved) unlock(saved);
  }, [unlock]);

  if (!unlocked) {
    return (
      <div className={pinError ? 'animate-wiggle' : ''}>
        <PinScreen onUnlock={unlock} />
        {pinError && (
          <div className="fixed top-8 left-1/2 -translate-x-1/2 bg-red-500/20 border border-red-500/30 text-red-400 px-5 py-2.5 rounded-xl text-sm font-semibold z-50">
            Incorrect PIN — try again
          </div>
        )}
      </div>
    );
  }

  return <KioskView pin={pin} />;
}
