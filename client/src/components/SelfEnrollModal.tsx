import { useState, useEffect, useRef, useCallback } from 'react';
import * as faceapi from '@vladmandic/face-api';
import { X, Camera } from 'lucide-react';
import { staffAPI } from '../lib/api';

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';
const TOTAL = 10; // more samples = better descriptor cluster = fewer false matches at kiosk

const PROMPTS = [
  'Look straight at the camera',
  'Tilt your head slightly left',
  'Tilt your head slightly right',
  'Chin up slightly',
  'Chin down slightly',
  'Look straight again',
  'Move a little closer',
  'Move a little further back',
  'Slight smile',
  'Neutral expression — final shot',
];

export function SelfEnrollModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [phase, setPhase]           = useState<'init' | 'ready' | 'capturing' | 'saving' | 'done' | 'error'>('init');
  const [status, setStatus]         = useState('Starting camera…');
  const [faceDetected, setFaceDet]  = useState(false);
  const [captures, setCaptures]     = useState<Float32Array[]>([]);
  const [promptIdx, setPromptIdx]   = useState(0);
  const [errorMsg, setError]        = useState('');

  const videoRef    = useRef<HTMLVideoElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const detIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const capturesRef = useRef<Float32Array[]>([]);

  // Sync captures ref
  useEffect(() => { capturesRef.current = captures; }, [captures]);

  const stopCamera = useCallback(() => {
    if (detIntervalRef.current) { clearInterval(detIntervalRef.current); detIntervalRef.current = null; }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Open camera immediately for fast feedback
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      } catch {
        if (!cancelled) { setStatus('Camera denied — allow access and try again'); setPhase('error'); setError('Camera access denied'); }
        return;
      }
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      const vid = videoRef.current;
      if (vid) { vid.srcObject = stream; try { await vid.play(); } catch {} }

      setStatus('Loading face recognition models…');
      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        ]);
      } catch {
        // Stop the camera — we won't be needing it
        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        if (!cancelled) { setStatus('Failed to load models — check connection'); setPhase('error'); setError('Model load failed'); }
        return;
      }
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); streamRef.current = null; return; }

      if (!cancelled) { setPhase('ready'); setStatus('Position your face in the frame'); }

      // Live detection loop for bounding box + face detected indicator
      detIntervalRef.current = setInterval(async () => {
        const video = videoRef.current;
        if (!video || video.readyState < 3) return;

        const det = await faceapi
          .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
          .withFaceLandmarks(true);

        if (!cancelled) setFaceDet(!!det);

        // Draw bounding box
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
      }, 300);
    }

    init();
    return () => { cancelled = true; stopCamera(); };
  }, [stopCamera]);

  const startCapture = useCallback(async () => {
    if (phase !== 'ready') return;
    setPhase('capturing');
    setCaptures([]);
    capturesRef.current = [];

    const video = videoRef.current;
    if (!video) return;

    for (let i = 0; i < TOTAL; i++) {
      setPromptIdx(i);
      setStatus(PROMPTS[i]);
      // 1200ms gap — ensures each capture is a genuinely different frame
      await new Promise(r => setTimeout(r, 1200));

      // inputSize: 320 matches kiosk inference → same descriptor space.
      let desc: Float32Array | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const det = await faceapi
          .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.6 }))
          .withFaceLandmarks(true)
          .withFaceDescriptor();
        if (det) { desc = det.descriptor; break; }
        await new Promise(r => setTimeout(r, 400));
      }
      if (!desc) {
        setStatus('No face detected — please re-position and try again');
        setPhase('ready');
        setCaptures([]);
        capturesRef.current = [];
        return;
      }
      const updated = [...capturesRef.current, desc];
      capturesRef.current = updated;
      setCaptures([...updated]);
    }

    // All 5 captured — save
    setPhase('saving');
    setStatus('Saving your face data…');
    try {
      await staffAPI.enrollSelfFace(capturesRef.current.map(d => Array.from(d)));
      setPhase('done');
      setTimeout(() => { onDone(); onClose(); }, 2000);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Save failed — please try again');
      setPhase('error');
    }
  }, [phase, onDone, onClose]);

  const captureCount = captures.length;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-dark-300 border border-dark-50 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-dark-50">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-xl bg-gold/15 border border-gold/25 flex items-center justify-center">
              <Camera size={13} className="text-gold" />
            </div>
            <p className="text-white font-semibold text-sm">Enroll Your Face</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-white/30 hover:text-white transition-colors">
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

          {/* Loading overlay */}
          {phase === 'init' && (
            <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-3">
              <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
              <p className="text-white/60 text-xs text-center px-4">{status}</p>
            </div>
          )}

          {/* Success overlay */}
          {phase === 'done' && (
            <div className="absolute inset-0 bg-green-900/60 flex flex-col items-center justify-center gap-2">
              <p className="text-white font-black text-3xl">✓</p>
              <p className="text-green-400 font-semibold">Face Enrolled!</p>
            </div>
          )}

          {/* Error overlay */}
          {phase === 'error' && (
            <div className="absolute inset-0 bg-red-900/50 flex flex-col items-center justify-center gap-2 p-4">
              <p className="text-red-400 font-semibold text-center text-sm">{errorMsg}</p>
              <button onClick={onClose} className="mt-2 px-4 py-1.5 rounded-xl bg-white/10 text-white text-xs">Close</button>
            </div>
          )}

          {/* Saving overlay */}
          {phase === 'saving' && (
            <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {/* Face detected indicator — show when ready/capturing */}
          {(phase === 'ready' || phase === 'capturing') && (
            <div className={`absolute top-3 right-3 px-2.5 py-1 rounded-full text-[10px] font-bold border backdrop-blur-sm transition-all ${
              faceDetected
                ? 'bg-green-500/20 border-green-500/30 text-green-400'
                : 'bg-amber-500/20 border-amber-500/30 text-amber-400'
            }`}>
              {faceDetected ? '✓ Face detected' : 'No face in frame'}
            </div>
          )}
        </div>

        {/* Bottom panel */}
        <div className="px-4 py-4 space-y-3">
          {/* Capture progress dots */}
          <div className="flex items-center justify-center gap-2">
            {Array.from({ length: TOTAL }).map((_, i) => (
              <div key={i} className="w-3 h-3 rounded-full transition-all"
                style={{ background: i < captureCount ? '#D4AF37' : 'rgba(255,255,255,0.12)' }} />
            ))}
          </div>

          {/* Status / prompt */}
          <p className="text-white/50 text-xs text-center min-h-[1.25rem]">
            {phase === 'capturing' ? `${captureCount + 1}/${TOTAL} — ${PROMPTS[promptIdx]}` : status}
          </p>

          {/* CTA button */}
          {phase === 'ready' && (
            <button
              onClick={startCapture}
              disabled={!faceDetected}
              className="w-full py-2.5 rounded-xl bg-gold/15 border border-gold/30 text-gold font-semibold text-sm hover:bg-gold/22 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Start 5-Photo Capture
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
