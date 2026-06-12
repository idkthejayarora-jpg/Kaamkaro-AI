import { useRef, useCallback, useEffect, useState } from 'react';
import * as faceapi from '@vladmandic/face-api';
import { loadFaceModels } from '../lib/faceModels';
import { X } from 'lucide-react';
import { attendanceAPI } from '../lib/api';


export function SelfScanModal({
  faceDescriptors,
  currentStatus,
  withinCheckinWindow = true,
  onClose,
  onDone,
}: {
  faceDescriptors: number[][];
  currentStatus: 'in' | 'out' | 'absent';
  // Server flag: is "now" still within the staff's check-in window (≤ shiftStart + 4h)?
  withinCheckinWindow?: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  // Check-in vs check-out (mirrors the kiosk):
  //  • open session ('in')      → check-out
  //  • no record yet ('absent') → check-in ONLY within the morning window; a first
  //    scan past it is a missed check-in, so treat it as a check-out (not an evening
  //    "in-time").  ('out' = stepped out earlier → re-entry check-in.)
  const isCheckin = currentStatus === 'in' ? false
                  : currentStatus === 'absent' ? withinCheckinWindow
                  : true;
  const [phase, setPhase]         = useState<'loading' | 'scanning' | 'matched' | 'processing' | 'success' | 'error'>('loading');
  const [status, setStatus]       = useState('Starting camera…');
  const [errorMsg, setError]      = useState('');
  const [countdown, setCountdown] = useState(2);

  const videoRef     = useRef<HTMLVideoElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const streamRef    = useRef<MediaStream | null>(null);
  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const matcherRef   = useRef<faceapi.FaceMatcher | null>(null);
  const confirmedRef = useRef(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const confirm = useCallback(async () => {
    if (confirmedRef.current) return;
    confirmedRef.current = true;
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (intervalRef.current)  clearInterval(intervalRef.current);
    setPhase('processing');
    try {
      if (isCheckin) await attendanceAPI.selfCheckin();
      else           await attendanceAPI.selfCheckout();
      setPhase('success');
      setTimeout(() => { onDone(); onClose(); }, 2000);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Failed — please try again');
      setPhase('error');
    }
  }, [isCheckin, onDone, onClose]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Camera first — instant feedback before heavy model load
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      } catch {
        if (!cancelled) setStatus('Camera denied — allow access and try again');
        return;
      }
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      const vid = videoRef.current;
      if (vid) { vid.srcObject = stream; try { await vid.play(); } catch {} }

      setStatus('Loading face recognition…');
      try {
        await loadFaceModels();
      } catch { if (!cancelled) setStatus('Failed to load models — check connection'); return; }
      if (cancelled) return;

      try {
        const labeled = new faceapi.LabeledFaceDescriptors('self', faceDescriptors.map(d => new Float32Array(d)));
        matcherRef.current = new faceapi.FaceMatcher([labeled], 0.45); // stricter — reduces impostor matches
      } catch { setStatus('Face data error'); return; }

      if (!cancelled) { setPhase('scanning'); setStatus('Look at the camera…'); }

      intervalRef.current = setInterval(async () => {
        const video = videoRef.current;
        if (!video || video.readyState < 3) return;

        const det = await faceapi
          .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
          .withFaceLandmarks(true)
          .withFaceDescriptor();

        const canvas = canvasRef.current;
        if (canvas && video.videoWidth > 0) {
          if (canvas.width  !== video.videoWidth)  canvas.width  = video.videoWidth;
          if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (det) {
              const r = faceapi.resizeResults(det, { width: video.videoWidth, height: video.videoHeight });
              ctx.strokeStyle = 'rgba(212,175,55,0.9)';
              ctx.lineWidth = 2;
              const { x, y, width, height } = r.detection.box;
              ctx.beginPath(); ctx.roundRect(x, y, width, height, 6); ctx.stroke();
            }
          }
        }

        if (!det || !matcherRef.current) return;
        const best = matcherRef.current.findBestMatch(det.descriptor);
        if (best.label === 'self') {
          if (intervalRef.current) clearInterval(intervalRef.current);
          if (!cancelled) {
            setPhase('matched');
            let c = 2;
            setCountdown(c);
            countdownRef.current = setInterval(() => {
              c--;
              setCountdown(c);
              if (c <= 0) { clearInterval(countdownRef.current!); confirm(); }
            }, 1000);
          }
        }
      }, 250);
    }

    init();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      if (intervalRef.current)  clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-dark-300 border border-dark-50 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-dark-50">
          <p className="text-white font-semibold text-sm">
            {isCheckin ? '🟢 Clock In' : '🔴 Clock Out'}
          </p>
          <button onClick={onClose} className="text-white/30 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Camera viewport */}
        <div className="relative bg-black aspect-[4/3]">
          <video ref={videoRef} muted playsInline autoPlay
            className="absolute inset-0 w-full h-full object-cover"
            style={{ transform: 'scaleX(-1)' }} />
          <canvas ref={canvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ transform: 'scaleX(-1)' }} />

          {phase === 'loading' && (
            <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-3">
              <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
              <p className="text-white/60 text-xs text-center px-4">{status}</p>
            </div>
          )}
          {phase === 'matched' && (
            <div className="absolute inset-0 bg-green-900/40 flex flex-col items-center justify-center gap-2">
              <p className="text-green-400 font-bold text-lg drop-shadow">✓ Face Verified</p>
              <div className="relative w-12 h-12">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 48 48">
                  <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="4" />
                  <circle cx="24" cy="24" r="20" fill="none" stroke="#4ade80" strokeWidth="4"
                    strokeDasharray="125.6"
                    strokeDashoffset={`${125.6 * (1 - countdown / 2)}`}
                    style={{ transition: 'stroke-dashoffset 1s linear' }} />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-white font-black text-xl">{countdown}</span>
              </div>
            </div>
          )}
          {phase === 'processing' && (
            <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {phase === 'success' && (
            <div className="absolute inset-0 bg-green-900/60 flex flex-col items-center justify-center gap-2">
              <p className="text-white font-black text-3xl">✓</p>
              <p className="text-green-400 font-semibold">{isCheckin ? 'Checked In!' : 'Checked Out!'}</p>
            </div>
          )}
          {phase === 'error' && (
            <div className="absolute inset-0 bg-red-900/50 flex flex-col items-center justify-center gap-2 p-4">
              <p className="text-red-400 font-semibold text-center text-sm">{errorMsg}</p>
              <button onClick={onClose} className="mt-2 px-4 py-1.5 rounded-xl bg-white/10 text-white text-xs">Close</button>
            </div>
          )}
        </div>

        {/* Footer hint */}
        {phase === 'scanning' && (
          <div className="px-4 py-3 text-center">
            <p className="text-white/40 text-xs">Look straight at the camera — it will auto-confirm</p>
          </div>
        )}
      </div>
    </div>
  );
}
