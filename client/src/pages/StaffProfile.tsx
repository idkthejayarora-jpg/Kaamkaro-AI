import { useEffect, useState, useRef, useCallback } from 'react';
import * as faceapi from '@vladmandic/face-api';
import { TabBar, AnimatedTabPanel } from '../components/TabBar';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Phone, Mail, Calendar, Flame, TrendingUp, Users, Clock, X } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import { staffAPI, customersAPI, interactionsAPI, badgesAPI, attendanceAPI } from '../lib/api';
import type { Staff, Customer, Performance, Interaction, Badge } from '../types';
import { BADGE_META } from '../types';
import { useAuth } from '../contexts/AuthContext';

const GOLD = '#D4AF37';
const DIM  = '#2A2A2A';

const TYPE_LABELS: Record<string, string> = { call: '📞', message: '💬', email: '✉️', meeting: '🤝', diary: '📓' };

function fmt(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// ── SelfScanModal — face-verified check-in/out for touring staff ───────────────

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';

function SelfScanModal({
  faceDescriptors,
  currentStatus,
  onClose,
  onDone,
}: {
  faceDescriptors: number[][];
  currentStatus: 'in' | 'out' | 'absent';
  onClose: () => void;
  onDone: () => void;
}) {
  const isCheckin = currentStatus !== 'in';
  const [phase, setPhase]     = useState<'loading' | 'scanning' | 'matched' | 'processing' | 'success' | 'error'>('loading');
  const [status, setStatus]   = useState('Starting camera…');
  const [errorMsg, setError]  = useState('');
  const [countdown, setCountdown] = useState(2);

  const videoRef    = useRef<HTMLVideoElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const matcherRef  = useRef<faceapi.FaceMatcher | null>(null);
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
      // Camera first
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      } catch {
        if (!cancelled) { setStatus('Camera denied — allow access and try again'); }
        return;
      }
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      const vid = videoRef.current;
      if (vid) { vid.srcObject = stream; try { await vid.play(); } catch {} }

      // Models
      setStatus('Loading face recognition…');
      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        ]);
      } catch { if (!cancelled) setStatus('Failed to load models — check connection'); return; }
      if (cancelled) return;

      // Build matcher from own descriptors
      try {
        const labeled = new faceapi.LabeledFaceDescriptors('self', faceDescriptors.map(d => new Float32Array(d)));
        matcherRef.current = new faceapi.FaceMatcher([labeled], 0.5);
      } catch { setStatus('Face data error'); return; }

      if (!cancelled) { setPhase('scanning'); setStatus('Look at the camera…'); }

      // Detection loop
      intervalRef.current = setInterval(async () => {
        const video = videoRef.current;
        if (!video || video.readyState < 3) return;

        const det = await faceapi
          .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 }))
          .withFaceLandmarks(true)
          .withFaceDescriptor();

        // Draw box
        const canvas = canvasRef.current;
        if (canvas && video.videoWidth > 0) {
          if (canvas.width !== video.videoWidth)  canvas.width  = video.videoWidth;
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

        {/* Camera */}
        <div className="relative bg-black aspect-[4/3]">
          <video ref={videoRef} muted playsInline autoPlay
            className="absolute inset-0 w-full h-full object-cover"
            style={{ transform: 'scaleX(-1)' }} />
          <canvas ref={canvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ transform: 'scaleX(-1)' }} />

          {/* Overlay for non-scanning states */}
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

export default function StaffProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [staff, setStaff]             = useState<Staff | null>(null);
  const [customers, setCustomers]     = useState<Customer[]>([]);
  const [performance, setPerformance] = useState<Performance[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [loading, setLoading]         = useState(true);
  const [activeTab, setActiveTab]     = useState<'activity' | 'customers' | 'attendance'>('activity');
  const [attMonth,  setAttMonth]      = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [attData,   setAttData]       = useState<Record<string, string>>({});
  const [attSummary, setAttSummary]   = useState<{ presentDays: number; lateDays: number; totalHours: number; overtimeHours: number; undertimeHours: number } | null>(null);
  const [attRecords, setAttRecords]   = useState<{ date: string; loginAt: string | null; logoutAt: string | null; hoursWorked: number; isLate: boolean }[]>([]);
  const [badges, setBadges]           = useState<Badge[]>([]);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      staffAPI.get(id).catch(() => null),
      customersAPI.list().catch(() => [] as Customer[]),
      staffAPI.getPerformance(id).catch(() => [] as Performance[]),
      interactionsAPI.list({ staffId: id }).catch(() => [] as Interaction[]),
      badgesAPI.list(id).catch(() => [] as Badge[]),
    ]).then(([s, c, p, i, b]) => {
      setStaff(s as Staff | null);
      setCustomers((c as Customer[]).filter(cu =>
        cu.assignedTo === id || (cu.assignedStaff || []).includes(id!)
      ));
      setPerformance((p as Performance[]).sort((a, b) => a.week.localeCompare(b.week)));
      setInteractions(i as Interaction[]);
      setBadges((b as Badge[]).sort((x, y) => y.earnedAt.localeCompare(x.earnedAt)));
    }).catch(() => { /* show "not found" below */ })
      .finally(() => setLoading(false));
  }, [id]);

  // Load attendance data for this staff when attendance tab is active or month changes
  useEffect(() => {
    if (!id || activeTab !== 'attendance') return;
    const [yr, mo] = attMonth.split('-').map(Number);
    const from = `${attMonth}-01`;
    const lastDay = new Date(yr, mo, 0).getDate();
    const to = `${attMonth}-${String(lastDay).padStart(2, '0')}`;
    Promise.all([
      attendanceAPI.staffHistory(id, from, to).catch(() => []),
      attendanceAPI.monthly(attMonth).catch(() => null),
    ]).then(([records, monthly]) => {
      setAttRecords(records as typeof attRecords);
      // Pull this staff's row from monthly summary
      if (monthly?.staff) {
        const row = monthly.staff.find((s: { staffId: string }) => s.staffId === id);
        if (row) {
          setAttData(row.dailyMap || {});
          setAttSummary({
            presentDays:   row.presentDays,
            lateDays:      row.lateDays,
            totalHours:    row.totalHours,
            overtimeHours: row.overtimeHours,
            undertimeHours: row.undertimeHours,
          });
        }
      }
    });
  }, [id, activeTab, attMonth]);

  if (loading) return (
    <div className="space-y-4">
      <div className="card h-36 shimmer" /><div className="card h-48 shimmer" />
    </div>
  );
  if (!staff) return (
    <div className="card text-center py-16">
      <p className="text-white/40">Staff not found</p>
      <button onClick={() => navigate('/staff')} className="btn-secondary mt-4">Back</button>
    </div>
  );

  const latest  = performance[performance.length - 1];

  // Weekly interaction activity — computed from actual logged interactions (never flat)
  const weeklyActivity = (() => {
    const map: Record<string, { total: number; calls: number; messages: number; meetings: number }> = {};
    for (const ix of interactions) {
      const d  = new Date(ix.createdAt);
      const yr = d.getFullYear();
      const wk = Math.ceil(((d.getTime() - new Date(yr, 0, 1).getTime()) / 86400000 + new Date(yr, 0, 1).getDay() + 1) / 7);
      const key = `${yr}-W${String(wk).padStart(2, '0')}`;
      if (!map[key]) map[key] = { total: 0, calls: 0, messages: 0, meetings: 0 };
      map[key].total++;
      if      (ix.type === 'call')    map[key].calls++;
      else if (ix.type === 'message') map[key].messages++;
      else if (ix.type === 'meeting') map[key].meetings++;
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-8)
      .map(([key, v]) => ({ week: `W${key.split('-W')[1]}`, ...v }));
  })();

  // Recent interactions (last 10)
  const recentInteractions = [...interactions]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);

  return (
    <div className="space-y-6 animate-fade-in">
      <button onClick={() => navigate('/staff')} className="flex items-center gap-2 text-white/40 hover:text-white text-sm transition-colors">
        <ArrowLeft size={16} /> Back to Staff
      </button>

      {/* Profile card */}
      <div className="card">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gold/15 border border-gold/30 flex items-center justify-center flex-shrink-0">
            <span className="text-gold text-2xl font-bold">{staff.avatar}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-white">{staff.name}</h1>
              <span className={`badge ${staff.active ? 'badge-green' : 'badge-gray'}`}>{staff.active ? 'Active' : 'Inactive'}</span>
            </div>
            <div className="flex flex-wrap items-center gap-4 mt-2">
              <span className="text-white/40 text-sm flex items-center gap-1.5"><Phone size={13} />{staff.phone}</span>
              {staff.email && <span className="text-white/40 text-sm flex items-center gap-1.5"><Mail size={13} />{staff.email}</span>}
              <span className="text-white/40 text-sm flex items-center gap-1.5">
                <Calendar size={13} />Joined {new Date(staff.joinDate).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-5 border-t border-dark-50">
          {[
            { label: 'Customers',     value: customers.length,                           icon: Users },
            { label: 'Interactions',  value: interactions.length,                        icon: TrendingUp },
            { label: 'Streak',        value: `${staff.streakData?.currentStreak || 0}d`, icon: Flame },
            { label: 'Best Streak',   value: `${staff.streakData?.longestStreak || 0}d`, icon: Flame },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="bg-dark-200 rounded-xl p-3 text-center">
              <Icon size={16} className="text-gold mx-auto mb-1" />
              <p className="text-white font-bold text-lg">{value}</p>
              <p className="text-white/30 text-xs">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Chart — Weekly Activity from actual logged interactions */}
      {weeklyActivity.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-white font-semibold text-sm">Weekly Activity</h3>
              <p className="text-white/30 text-xs mt-0.5">Interactions logged per week</p>
            </div>
            <div className="text-right">
              <p className="text-gold font-bold text-lg">{weeklyActivity[weeklyActivity.length - 1]?.total ?? 0}</p>
              <p className="text-white/25 text-[10px]">this week</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={weeklyActivity} barSize={20}>
              <CartesianGrid vertical={false} stroke={DIM} />
              <XAxis dataKey="week" tick={{ fill: '#666', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#666', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0]?.payload as { total: number; calls: number; messages: number; meetings: number };
                  return (
                    <div className="bg-dark-200 border border-dark-50 rounded-xl p-3 text-xs shadow-xl space-y-1">
                      <p className="text-white/50 mb-1 font-medium">{label}</p>
                      <p className="text-gold font-semibold">{d.total} total interactions</p>
                      {d.calls    > 0 && <p className="text-blue-400">📞 {d.calls} calls</p>}
                      {d.messages > 0 && <p className="text-purple-400">💬 {d.messages} messages</p>}
                      {d.meetings > 0 && <p className="text-emerald-400">🤝 {d.meetings} meetings</p>}
                    </div>
                  );
                }}
                cursor={{ fill: 'rgba(212,175,55,0.04)' }}
              />
              <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                {weeklyActivity.map((_, i) => (
                  <Cell key={i} fill={i === weeklyActivity.length - 1 ? GOLD : '#2A2A2A'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Badges */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold flex items-center gap-2">
            🏅 Badges
            {badges.length > 0 && (
              <span className="bg-gold/15 text-gold text-[10px] font-bold rounded-full px-2 py-0.5">{badges.length}</span>
            )}
          </h3>
        </div>
        {badges.length === 0 ? (
          <p className="text-white/25 text-sm text-center py-4">No badges earned yet</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {badges.map(b => {
              const meta = BADGE_META[b.badgeKey];
              const tierColour = b.tier === 'gold' ? 'border-gold/40 bg-gold/8' : b.tier === 'silver' ? 'border-slate-400/30 bg-slate-400/8' : 'border-amber-600/30 bg-amber-600/8';
              return (
                <div
                  key={b.id}
                  title={`${b.label} — ${meta?.description || ''}\nEarned: ${new Date(b.earnedAt).toLocaleDateString('en-IN')}`}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-medium cursor-default ${tierColour}`}
                >
                  <span className="text-base">{b.icon}</span>
                  <span className="text-white/80">{b.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Weekly streak history */}
      <div className="card">
        <h3 className="text-white font-semibold mb-4">Weekly Streak History</h3>
        <div className="space-y-2">
          {performance.slice(-6).reverse().map(p => (
            <div key={p.id} className="flex items-center justify-between gap-2 py-2 border-b border-dark-50/50 last:border-0">
              <span className="text-white/40 text-xs font-mono flex-shrink-0">{p.week}</span>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <div className="flex gap-0.5">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <div key={i} className={`w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-sm ${i < p.streak ? 'bg-gold' : 'bg-dark-200'}`} />
                  ))}
                </div>
                <span className="text-white/30 text-xs text-right">{p.customersContacted} contacts</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tab switcher ── */}
      <TabBar
        tabs={[
          { id: 'activity',   label: `Activity (${interactions.length})`  },
          { id: 'customers',  label: `Customers (${customers.length})` },
          { id: 'attendance', label: 'Attendance' },
        ]}
        active={activeTab}
        onChange={tabId => setActiveTab(tabId as 'activity' | 'customers' | 'attendance')}
        variant="pill-gold"
      />

      <AnimatedTabPanel key={activeTab} className="space-y-4">

      {/* ── Activity tab ── */}
      {activeTab === 'activity' && (
        <div className="card">
          <h3 className="text-white font-semibold mb-4">Recent Activity</h3>
          {recentInteractions.length === 0 ? (
            <p className="text-white/25 text-sm">No interactions logged yet</p>
          ) : (
            <div className="space-y-2">
              {recentInteractions.map(i => {
                const c = customers.find(cu => cu.id === i.customerId);
                const days = Math.round((Date.now() - new Date(i.createdAt).getTime()) / 86400000);
                return (
                  <div key={i.id} className="flex items-center gap-3 py-2 border-b border-dark-50/40 last:border-0">
                    <span className="text-base flex-shrink-0">{TYPE_LABELS[i.type] || '📞'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium">
                        {c?.name || 'Customer'}{' '}
                        <span className="text-white/30 font-normal text-xs capitalize">via {i.type}</span>
                      </p>
                      {i.notes && <p className="text-white/30 text-xs truncate">{i.notes}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className={`text-xs font-medium ${i.responded ? 'text-green-400' : 'text-white/30'}`}>
                        {i.responded ? '✓ Responded' : 'No response'}
                      </span>
                      <p className="text-white/20 text-[10px]">{days === 0 ? 'Today' : `${days}d ago`}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Customers tab ── */}
      {activeTab === 'customers' && (
        <div className="card">
          <h3 className="text-white font-semibold mb-4">Assigned Customers ({customers.length})</h3>
          {customers.length === 0 ? (
            <p className="text-white/25 text-sm">No customers assigned</p>
          ) : (
            <div className="space-y-2">
              {customers.map(c => {
                const days = c.lastContact ? Math.round((Date.now() - new Date(c.lastContact).getTime()) / 86400000) : null;
                return (
                  <div key={c.id} className="flex items-center justify-between py-2 border-b border-dark-50/50 last:border-0">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-dark-200 border border-dark-50 flex items-center justify-center">
                        <span className="text-white/50 text-xs font-bold">{c.name[0]}</span>
                      </div>
                      <div>
                        <p className="text-white text-sm font-medium">{c.name}</p>
                        <p className="text-white/25 text-xs">{c.phone}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="badge badge-gold text-[10px] capitalize">{c.status}</span>
                      {days !== null && <p className="text-white/20 text-[10px] mt-1">{days === 0 ? 'Today' : `${days}d ago`}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Attendance tab ── */}
      {activeTab === 'attendance' && (
        <div className="space-y-4">
          {/* Month selector */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                const [y, m] = attMonth.split('-').map(Number);
                const d = new Date(y, m - 2, 1);
                setAttMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
              }}
              className="p-2 rounded-xl hover:bg-dark-200 text-white/40 hover:text-white transition-colors"
            >‹</button>
            <p className="text-white font-semibold flex-1 text-center text-sm">
              {new Date(attMonth + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
            </p>
            <button
              onClick={() => {
                const [y, m] = attMonth.split('-').map(Number);
                const d = new Date(y, m, 1);
                setAttMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
              }}
              className="p-2 rounded-xl hover:bg-dark-200 text-white/40 hover:text-white transition-colors"
            >›</button>
          </div>

          {/* Summary tiles */}
          {attSummary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Present',   val: attSummary.presentDays, color: 'text-green-400' },
                { label: 'Late',      val: attSummary.lateDays,    color: 'text-amber-400' },
                { label: 'Hrs',       val: `${attSummary.totalHours.toFixed(1)}h`, color: 'text-white' },
                { label: 'OT / UT',  val: attSummary.overtimeHours > 0 ? `+${attSummary.overtimeHours.toFixed(1)}h` : `-${attSummary.undertimeHours.toFixed(1)}h`,
                  color: attSummary.overtimeHours > 0 ? 'text-green-400' : 'text-red-400' },
              ].map(t => (
                <div key={t.label} className="card text-center py-3">
                  <p className={`text-xl font-black ${t.color}`}>{t.val}</p>
                  <p className="text-white/30 text-xs mt-0.5">{t.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Mini calendar heatmap */}
          {Object.keys(attData).length > 0 && (() => {
            const lastDay = new Date(parseInt(attMonth.split('-')[0]), parseInt(attMonth.split('-')[1]), 0).getDate();
            const days = Array.from({ length: lastDay }, (_, i) => String(i + 1).padStart(2, '0'));
            const cellColor = (v?: string) => {
              if (!v || v === 'absent')   return 'bg-red-500/15';
              if (v === 'late')           return 'bg-amber-400/30';
              if (v === 'present')        return 'bg-green-500/20';
              if (v === 'leave')          return 'bg-blue-500/20';
              if (v === 'sick')           return 'bg-amber-600/25';
              if (v === 'half_day')       return 'bg-purple-500/20';
              return 'bg-dark-200';
            };
            return (
              <div className="card">
                <p className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-3">Calendar</p>
                <div className="flex flex-wrap gap-1">
                  {days.map(d => (
                    <div
                      key={d}
                      className={`w-7 h-7 rounded-md flex items-center justify-center text-[9px] font-bold text-white/50 ${cellColor(attData[d])}`}
                      title={attData[d] || 'no data'}
                    >
                      {parseInt(d)}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Recent records table */}
          {attRecords.length > 0 && (
            <div className="card overflow-hidden">
              <p className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-3">Recent Records</p>
              <div className="space-y-0 divide-y divide-dark-50/30">
                {attRecords.slice(0, 10).map(r => (
                  <div key={r.date} className="flex items-center gap-3 py-2 text-sm">
                    <Clock size={12} className="text-white/20 flex-shrink-0" />
                    <span className="text-white/60 w-24 flex-shrink-0">
                      {new Date(r.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </span>
                    <span className="text-white/40 text-xs flex-1">
                      {r.loginAt ? fmt(r.loginAt) : '—'} → {r.logoutAt ? fmt(r.logoutAt) : '—'}
                    </span>
                    <span className="text-white/50 text-xs w-12 text-right">{r.hoursWorked > 0 ? `${r.hoursWorked.toFixed(1)}h` : '—'}</span>
                    {r.isLate && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">Late</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {attRecords.length === 0 && !attSummary && (
            <div className="card text-center py-10">
              <p className="text-white/20 text-sm">No attendance data for this month</p>
            </div>
          )}
        </div>
      )}

      </AnimatedTabPanel>
    </div>
  );
}
