/**
 * FaceEnrollModal — admin/manager-side guided face enrollment (10 poses).
 * Lives in its own file so the 1.3 MB face-api dependency is only downloaded
 * when the modal is actually opened (lazy import in AttendancePortal).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { XCircle } from 'lucide-react';
import * as faceapi from '@vladmandic/face-api';
import { loadFaceModels } from '../lib/faceModels';
import { staffAPI } from '../lib/api';

interface StaffMember { id: string; name: string; }



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

export default function FaceEnrollModal({ staff, onClose, onEnrolled }: {
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
        await loadFaceModels();
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
