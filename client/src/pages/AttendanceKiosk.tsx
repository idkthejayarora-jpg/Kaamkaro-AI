/**
 * AttendanceKiosk — full-screen tablet kiosk.
 * Public route (/kiosk) — no JWT needed, uses X-Kiosk-Pin header.
 *
 * Flow:
 *   PIN lock screen → (unlocked) → live camera + face detection loop
 *   → face matched → confirm panel (2s countdown) → check-in / check-out
 *   → success flash → back to idle
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import * as faceapi from '@vladmandic/face-api';
import { kioskAPI } from '../lib/api';

// ── Types ──────────────────────────────────────────────────────────────────────

interface StaffDescriptor {
  id: string; name: string; avatar: string;
  faceDescriptors: number[][];
}

interface TodayRecord {
  staffId: string; staffName: string; avatar: string;
  status: 'in' | 'out' | 'absent';
  loginAt: string | null;
}

type KioskState =
  | 'pin'          // PIN lock screen
  | 'loading'      // loading face models
  | 'idle'         // camera live, no face / no match
  | 'matched'      // face matched, confirming
  | 'processing'   // API call in progress
  | 'success'      // check-in/out confirmed
  | 'error'        // something went wrong
  | 'enrolling';   // unknown face — link to staff or create new

interface StaffBasic { id: string; name: string; avatar: string; }

const MATCH_THRESHOLD = 0.5;    // FaceMatcher distance — lower = stricter
const COOLDOWN_MS     = 60_000; // 60s per staff after successful scan
const CONFIRM_SECS    = 3;      // countdown before auto-confirm

function now12h() {
  return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function todayLong() {
  return new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ── PIN Screen ─────────────────────────────────────────────────────────────────

function PinScreen({ onUnlock }: { onUnlock: (pin: string) => void }) {
  const [entered, setEntered]   = useState('');
  const [shake,   setShake]     = useState(false);
  const [error,   setError]     = useState('');

  const DIGITS = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

  const press = (d: string) => {
    if (d === '⌫') { setEntered(p => p.slice(0, -1)); setError(''); return; }
    if (d === '') return;
    const next = entered + d;
    setEntered(next);
    if (next.length >= 4) {
      onUnlock(next);
      setEntered('');
    }
  };

  return (
    <div className="fixed inset-0 bg-dark-500 flex flex-col items-center justify-center gap-8 p-8">
      {/* Logo */}
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl bg-gold/15 border border-gold/25 flex items-center justify-center mx-auto mb-4">
          <span className="text-gold font-black text-2xl">K</span>
        </div>
        <p className="text-white font-bold text-xl">Attendance Kiosk</p>
        <p className="text-white/30 text-sm mt-1">Enter kiosk PIN to unlock</p>
      </div>

      {/* PIN dots */}
      <div className={`flex gap-4 ${shake ? 'animate-wiggle' : ''}`}>
        {[0,1,2,3].map(i => (
          <div
            key={i}
            className="w-4 h-4 rounded-full border-2 transition-all"
            style={{
              borderColor: i < entered.length ? '#D4AF37' : 'rgba(255,255,255,0.2)',
              background:  i < entered.length ? '#D4AF37' : 'transparent',
            }}
          />
        ))}
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {/* Numpad */}
      <div className="grid grid-cols-3 gap-3 w-full max-w-[240px]">
        {DIGITS.map((d, i) => (
          <button
            key={i}
            onClick={() => press(d)}
            disabled={d === ''}
            className={`h-16 rounded-2xl text-white font-bold text-xl transition-all active:scale-95 ${
              d === '' ? 'opacity-0 pointer-events-none'
              : d === '⌫' ? 'bg-dark-300 border border-dark-50 text-white/50'
              : 'bg-dark-400 border border-dark-50 hover:bg-dark-300 hover:border-white/20'
            }`}
          >
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main Kiosk ─────────────────────────────────────────────────────────────────

export default function AttendanceKiosk() {
  const [kioskState,   setKioskState]   = useState<KioskState>('pin');
  const [pin,          setPin]          = useState('');
  const [pinError,     setPinError]     = useState(false);
  const [modelStatus,  setModelStatus]  = useState('');
  const [descriptors,  setDescriptors]  = useState<StaffDescriptor[]>([]);
  const [todayStatus,  setTodayStatus]  = useState<TodayRecord[]>([]);
  const [time,         setTime]         = useState(now12h());
  const [matched,      setMatched]      = useState<StaffDescriptor | null>(null);
  const [actionType,   setActionType]   = useState<'checkin' | 'checkout'>('checkin');
  const [countdown,    setCountdown]    = useState(CONFIRM_SECS);
  const [successMsg,   setSuccessMsg]   = useState('');
  const [isLate,       setIsLate]       = useState(false);
  const [lateMinutes,  setLateMinutes]  = useState(0);
  const [errorMsg,     setErrorMsg]     = useState('');

  const videoRef      = useRef<HTMLVideoElement>(null);
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const streamRef     = useRef<MediaStream | null>(null);
  const detectRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const cooldownRef   = useRef<Record<string, number>>({});
  const countdownRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const confirmedRef  = useRef(false);
  const faceMatcherRef = useRef<faceapi.FaceMatcher | null>(null);

  // Rebuild FaceMatcher whenever descriptors change
  useEffect(() => {
    if (!descriptors.length) { faceMatcherRef.current = null; return; }
    try {
      const labeled = descriptors.map(s =>
        new faceapi.LabeledFaceDescriptors(
          s.id,
          s.faceDescriptors.map(d => new Float32Array(d)),
        )
      );
      faceMatcherRef.current = new faceapi.FaceMatcher(labeled, MATCH_THRESHOLD);
    } catch { faceMatcherRef.current = null; }
  }, [descriptors]);

  // Clock
  useEffect(() => {
    const t = setInterval(() => setTime(now12h()), 5000);
    return () => clearInterval(t);
  }, []);

  // ── Unlock ─────────────────────────────────────────────────────────────────

  const unlock = useCallback(async (enteredPin: string) => {
    // Try the pin by calling descriptors endpoint
    try {
      const staff = await kioskAPI.descriptors(enteredPin);
      setPin(enteredPin);
      sessionStorage.setItem('kiosk_pin', enteredPin);
      setDescriptors(staff);
      setKioskState('loading');
      setPinError(false);
    } catch {
      setPinError(true);
      setTimeout(() => setPinError(false), 1500);
    }
  }, []);

  // Check for saved PIN or auto-unlock flag on mount
  useEffect(() => {
    // Auto-unlock: portal set this flag when "Open Kiosk" was clicked by an authenticated admin/manager
    const autoUnlock = sessionStorage.getItem('kk_kiosk_autounlock');
    if (autoUnlock) {
      sessionStorage.removeItem('kk_kiosk_autounlock');
      // Fetch descriptors without PIN validation — use a bypass sentinel
      kioskAPI.descriptors('__auto__')
        .then(staff => {
          setDescriptors(staff);
          setPin('__auto__');
          sessionStorage.setItem('kiosk_pin', '__auto__');
          setKioskState('loading');
        })
        .catch(() => {
          // Auto-unlock failed (e.g. no descriptors endpoint) — fall back to PIN
          const saved = sessionStorage.getItem('kiosk_pin');
          if (saved) unlock(saved);
        });
      return;
    }
    const saved = sessionStorage.getItem('kiosk_pin');
    if (saved) unlock(saved);
  }, [unlock]);

  // ── Load face-api models and start camera ──────────────────────────────────

  useEffect(() => {
    if (kioskState !== 'loading') return;
    let cancelled = false;

    async function init() {
      try {
        setModelStatus('Loading face detection models…');
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
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        if (!cancelled) setKioskState('idle');
      } catch (e) {
        if (!cancelled) { setErrorMsg('Camera access denied or models failed to load.'); setKioskState('error'); }
      }
    }

    init();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [kioskState]);

  // ── Refresh today's status every 30s ──────────────────────────────────────

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

  // ── Detection loop (every 500ms) ────────────────────────────────────────────

  const triggerMatch = useCallback((staff: StaffDescriptor, isCheckin: boolean) => {
    setMatched(staff);
    setActionType(isCheckin ? 'checkin' : 'checkout');
    setCountdown(CONFIRM_SECS);
    confirmedRef.current = false;
    setKioskState('matched');
  }, []);

  useEffect(() => {
    if (kioskState !== 'idle' || !descriptors.length) return;
    if (detectRef.current) clearInterval(detectRef.current);

    detectRef.current = setInterval(async () => {
      if (!videoRef.current || videoRef.current.readyState < 2) return;

      const det = await faceapi
        .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.5 }))
        .withFaceLandmarks(true)
        .withFaceDescriptor();

      if (!det) return;

      // Draw bounding box on canvas
      if (canvasRef.current && videoRef.current) {
        const dims = { width: videoRef.current.videoWidth, height: videoRef.current.videoHeight };
        faceapi.matchDimensions(canvasRef.current, dims);
        const resized = faceapi.resizeResults(det, dims);
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          ctx.strokeStyle = 'rgba(212,175,55,0.8)';
          ctx.lineWidth   = 2;
          const { x, y, width, height } = resized.detection.box;
          ctx.strokeRect(x, y, width, height);
        }
      }

      // Match against descriptors using FaceMatcher (more accurate with multi-descriptor)
      const matcher = faceMatcherRef.current;
      if (!matcher) return;

      const bestMatch = matcher.findBestMatch(det.descriptor);
      if (bestMatch.label !== 'unknown') {
        const matchedStaff = descriptors.find(s => s.id === bestMatch.label);
        if (!matchedStaff) return;

        const now = Date.now();
        if ((cooldownRef.current[matchedStaff.id] || 0) > now) return; // cooldown active

        // Determine check-in or check-out
        const todayRec = todayStatus.find(r => r.staffId === matchedStaff.id);
        const isCheckin = !todayRec || todayRec.status === 'out';
        triggerMatch(matchedStaff, isCheckin);
      }
    }, 500);

    return () => { if (detectRef.current) clearInterval(detectRef.current); };
  }, [kioskState, descriptors, todayStatus, triggerMatch]);

  // ── Countdown timer ─────────────────────────────────────────────────────────

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

      const action = actionType === 'checkin' ? 'Checked in' : 'Checked out';
      setSuccessMsg(`${action} — ${result.isLate ? `${result.lateMinutes} mins late` : 'On time'}`);

      // Set cooldown
      cooldownRef.current[matched.id] = Date.now() + COOLDOWN_MS;

      setKioskState('success');
      refreshToday();

      // Return to idle after 4s
      setTimeout(() => {
        setKioskState('idle');
        setMatched(null);
        setSuccessMsg('');
      }, 4000);
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
      if (c <= 0) {
        clearInterval(countdownRef.current!);
        confirmAction();
      }
    }, 1000);

    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [kioskState, confirmAction]);

  const cancelMatch = () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    confirmedRef.current = false;
    setMatched(null);
    setKioskState('idle');
  };

  // ── Idle timeout → re-lock (30 min) ────────────────────────────────────────

  useEffect(() => {
    if (kioskState === 'pin') return;
    const t = setTimeout(() => {
      sessionStorage.removeItem('kiosk_pin');
      setKioskState('pin');
    }, 30 * 60 * 1000);
    return () => clearTimeout(t);
  }, [kioskState]);

  // ── Render: PIN ─────────────────────────────────────────────────────────────

  if (kioskState === 'pin') {
    return (
      <div className={pinError ? 'animate-wiggle' : ''}>
        <PinScreen onUnlock={unlock} />
        {pinError && (
          <div className="fixed top-8 left-1/2 -translate-x-1/2 bg-red-500/20 border border-red-500/30 text-red-400 px-5 py-2.5 rounded-xl text-sm font-semibold">
            Incorrect PIN — try again
          </div>
        )}
      </div>
    );
  }

  // ── Render: Loading models ──────────────────────────────────────────────────

  if (kioskState === 'loading') {
    return (
      <div className="fixed inset-0 bg-dark-500 flex flex-col items-center justify-center gap-4">
        <div className="w-10 h-10 border-2 border-gold border-t-transparent rounded-full animate-spin" />
        <p className="text-white/50 text-sm">{modelStatus}</p>
      </div>
    );
  }

  // ── Today status bar (dots) ─────────────────────────────────────────────────

  const inCount  = todayStatus.filter(r => r.status === 'in').length;
  const allCount = todayStatus.length;

  // ── Render: Main kiosk ──────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-dark-500 overflow-hidden select-none" style={{ fontFamily: 'inherit' }}>

      {/* Header bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-6 py-3 bg-dark-400/80 backdrop-blur-sm border-b border-white/5 z-20">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-gold/15 border border-gold/25 flex items-center justify-center">
            <span className="text-gold font-black text-sm">K</span>
          </div>
          <span className="text-white/60 text-sm font-semibold">Attendance</span>
        </div>
        <div className="text-center">
          <p className="text-white font-bold text-lg">{time}</p>
          <p className="text-white/30 text-xs">{todayLong()}</p>
        </div>
        <div className="flex items-center gap-2 text-white/40 text-xs">
          <span>{inCount}/{allCount} in</span>
          <button
            onClick={() => { sessionStorage.removeItem('kiosk_pin'); setKioskState('pin'); }}
            className="p-1.5 rounded-lg hover:bg-dark-200 hover:text-white transition-colors text-[10px] ml-2"
          >
            🔒
          </button>
        </div>
      </div>

      {/* Camera + overlay */}
      <div className="absolute inset-0 flex">

        {/* LEFT: Camera panel */}
        <div className="relative flex-1 bg-black flex items-center justify-center">
          <video
            ref={videoRef}
            muted
            playsInline
            className="w-full h-full object-cover"
            style={{ transform: 'scaleX(-1)' }}
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
            style={{ transform: 'scaleX(-1)', pointerEvents: 'none' }}
          />

          {/* Idle overlay text */}
          {(kioskState === 'idle') && (
            <div className="absolute bottom-8 left-0 right-0 text-center pointer-events-none">
              <p className="text-white/40 text-sm font-medium">
                Look at the camera to check in / check out
              </p>
            </div>
          )}

          {/* Scan line animation for idle */}
          {kioskState === 'idle' && (
            <div
              className="absolute left-0 right-0 h-px bg-gold/30 pointer-events-none"
              style={{
                animation: 'scanLine 3s ease-in-out infinite',
              }}
            />
          )}
        </div>

        {/* RIGHT: Status panel */}
        <div className="w-80 flex-shrink-0 bg-dark-400 border-l border-white/5 flex flex-col pt-14">

          {/* Match / Success card */}
          <div className="flex-1 flex flex-col items-center justify-center p-6">

            {(kioskState === 'idle' || kioskState === 'error') && (
              <div className="text-center space-y-4">
                <div className="w-20 h-20 rounded-2xl bg-dark-300 border border-dark-50 flex items-center justify-center mx-auto">
                  <span className="text-4xl">👤</span>
                </div>
                <p className="text-white/20 text-sm">Waiting for face…</p>
                {errorMsg && <p className="text-red-400 text-xs">{errorMsg}</p>}
              </div>
            )}

            {(kioskState === 'matched' || kioskState === 'processing') && matched && (
              <div className="w-full space-y-4 text-center">
                {/* Avatar */}
                <div className="w-20 h-20 rounded-2xl bg-dark-300 border border-dark-100 flex items-center justify-center mx-auto">
                  <span className="text-white/60 font-black text-2xl">
                    {matched.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                  </span>
                </div>

                <div>
                  <p className="text-white font-bold text-xl">{matched.name}</p>
                  <p className="text-white/40 text-sm mt-1">
                    {actionType === 'checkin' ? '→ Checking In' : '← Checking Out'}
                  </p>
                  <p className="text-white/30 text-xs mt-0.5">{now12h()}</p>
                </div>

                {/* Countdown ring */}
                {kioskState === 'matched' && (
                  <div className="relative w-16 h-16 mx-auto">
                    <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
                      <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="4" />
                      <circle
                        cx="32" cy="32" r="28" fill="none"
                        stroke={actionType === 'checkin' ? '#4ade80' : '#60a5fa'}
                        strokeWidth="4"
                        strokeLinecap="round"
                        strokeDasharray={`${175.9}`}
                        strokeDashoffset={`${175.9 * (1 - countdown / CONFIRM_SECS)}`}
                        style={{ transition: 'stroke-dashoffset 1s linear' }}
                      />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-white font-black text-2xl">
                      {countdown}
                    </span>
                  </div>
                )}

                {kioskState === 'processing' && (
                  <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin mx-auto" />
                )}

                {kioskState === 'matched' && (
                  <button
                    onClick={cancelMatch}
                    className="text-white/25 text-xs hover:text-white/50 transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
            )}

            {kioskState === 'success' && matched && (
              <div className="w-full space-y-4 text-center animate-scale-in">
                <div className="w-20 h-20 rounded-2xl bg-green-500/15 border border-green-500/30 flex items-center justify-center mx-auto">
                  <span className="text-4xl">{actionType === 'checkin' ? '✓' : '👋'}</span>
                </div>
                <div>
                  <p className="text-white font-bold text-xl">{matched.name}</p>
                  <p className="text-green-400 font-semibold text-sm mt-1">{successMsg}</p>
                  {isLate && lateMinutes > 0 && (
                    <p className="text-amber-400 text-xs mt-1">⚠ {lateMinutes} mins late today</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Today's status dots */}
          <div className="border-t border-white/5 p-4">
            <p className="text-white/25 text-[10px] uppercase tracking-wider mb-2">Today</p>
            <div className="flex flex-wrap gap-2">
              {todayStatus.map(r => (
                <div
                  key={r.staffId}
                  className="flex flex-col items-center gap-1"
                  title={`${r.staffName} — ${r.status}`}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold"
                    style={{
                      background: r.status === 'in' ? 'rgba(74,222,128,0.15)' : r.status === 'out' ? 'rgba(96,165,250,0.10)' : 'rgba(255,255,255,0.05)',
                      border: r.status === 'in' ? '1px solid rgba(74,222,128,0.3)' : r.status === 'out' ? '1px solid rgba(96,165,250,0.2)' : '1px solid rgba(255,255,255,0.08)',
                      color: r.status === 'in' ? '#4ade80' : r.status === 'out' ? '#60a5fa' : 'rgba(255,255,255,0.2)',
                    }}
                  >
                    {r.staffName.split(' ').map(w => w[0]).join('').slice(0, 2)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

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
