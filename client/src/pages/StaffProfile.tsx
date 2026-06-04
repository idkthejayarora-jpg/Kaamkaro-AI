import { useEffect, useState, useRef, lazy, Suspense } from 'react';
import { TabBar, AnimatedTabPanel } from '../components/TabBar';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Phone, Mail, Calendar, Flame, TrendingUp,
  Users, Clock, Award, Activity,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell, PieChart, Pie,
} from 'recharts';
import { staffAPI, customersAPI, interactionsAPI, badgesAPI, attendanceAPI } from '../lib/api';
import type { Staff, Customer, Performance, Interaction, Badge } from '../types';
import { BADGE_META } from '../types';
import { useAuth } from '../contexts/AuthContext';
import AttendanceDayEditor, { type DayRecord } from '../components/AttendanceDayEditor';
// Lazy — pulls in heavy face-api; kept out of the main bundle.
const SelfScanModal = lazy(() => import('../components/SelfScanModal').then(m => ({ default: m.SelfScanModal })));

const GOLD = '#C9A84C';
const DIM  = '#2A2A2A';
const TYPE_LABELS: Record<string, string> = {
  call: '📞', message: '💬', email: '✉️', meeting: '🤝', diary: '📓',
};

function fmt(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

/* ── Animated number counter ─────────────────────────────────────────────── */
function AnimatedCounter({
  target, suffix = '', decimals = 0, delay = 0,
}: { target: number; suffix?: string; decimals?: number; delay?: number }) {
  const [val, setVal] = useState(0);
  const frame = useRef<number>(0);
  useEffect(() => {
    setVal(0);
    const timer = setTimeout(() => {
      const start = performance.now();
      const dur = 1100;
      const run = (now: number) => {
        const t = Math.min((now - start) / dur, 1);
        const ease = 1 - Math.pow(1 - t, 3); // cubic ease-out
        setVal(ease * target);
        if (t < 1) frame.current = requestAnimationFrame(run);
      };
      frame.current = requestAnimationFrame(run);
    }, delay);
    return () => { clearTimeout(timer); cancelAnimationFrame(frame.current); };
  }, [target, delay]);
  return <>{decimals > 0 ? val.toFixed(decimals) : Math.round(val)}{suffix}</>;
}

/* ── SVG radial progress ring ────────────────────────────────────────────── */
function RadialRing({
  value, max = 100, size = 80, strokeWidth = 6,
  color = GOLD, trackColor = 'rgba(255,255,255,0.06)',
  delay = 120, children,
}: {
  value: number; max?: number; size?: number; strokeWidth?: number;
  color?: string; trackColor?: string; delay?: number;
  children?: React.ReactNode;
}) {
  const r    = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const [dash, setDash] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setDash(circ * Math.min(value / max, 1)), delay);
    return () => clearTimeout(t);
  }, [circ, value, max, delay]);

  return (
    <div className="relative flex items-center justify-center flex-shrink-0"
         style={{ width: size, height: size }}>
      <svg width={size} height={size}
           style={{ transform: 'rotate(-90deg)', position: 'absolute' }}
           aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r}
                fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={r}
                fill="none" stroke={color} strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeDasharray={circ}
                strokeDashoffset={circ - dash}
                style={{ transition: `stroke-dashoffset 1.3s cubic-bezier(0.34,1.4,0.64,1) ${delay}ms` }} />
      </svg>
      <div className="relative z-10 flex items-center justify-center">{children}</div>
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────────────── */
export default function StaffProfile() {
  const { id }      = useParams<{ id: string }>();
  const navigate    = useNavigate();
  const { user }    = useAuth();
  const [showSelfScan, setShowSelfScan] = useState(false);

  const [staff,        setStaff]        = useState<Staff | null>(null);
  const [customers,    setCustomers]    = useState<Customer[]>([]);
  const [performance,  setPerformance]  = useState<Performance[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [badges,       setBadges]       = useState<Badge[]>([]);
  const [loading,      setLoading]      = useState(true);

  const [activeTab, setActiveTab] = useState<'activity' | 'customers' | 'attendance'>('activity');

  const [attMonth, setAttMonth] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  });
  const [attData,    setAttData]    = useState<Record<string, string>>({});
  const [attReload,  setAttReload]  = useState(0); // bump to refetch attendance after an edit
  const [dayDetail,  setDayDetail]  = useState<{ date: string; record: DayRecord | null } | null>(null);
  const [attSummary, setAttSummary] = useState<{
    presentDays: number; lateDays: number; absentDays: number;
    totalHours: number; overtimeHours: number; undertimeHours: number;
  } | null>(null);
  const [attRecords, setAttRecords] = useState<{
    date: string; loginAt: string | null; logoutAt: string | null;
    hoursWorked: number; isLate: boolean;
  }[]>([]);

  /* ── Load staff / customers / perf / interactions / badges ── */
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
      setCustomers((c as Customer[]).filter(
        cu => cu.assignedTo === id || (cu.assignedStaff || []).includes(id!),
      ));
      setPerformance((p as Performance[]).sort((a, b) => a.week.localeCompare(b.week)));
      setInteractions(i as Interaction[]);
      setBadges((b as Badge[]).sort((x, y) => y.earnedAt.localeCompare(x.earnedAt)));
    }).catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  /* ── Load attendance (on mount + whenever month changes) ── */
  useEffect(() => {
    if (!id) return;
    const [yr, mo] = attMonth.split('-').map(Number);
    const from    = `${attMonth}-01`;
    const lastDay = new Date(yr, mo, 0).getDate();
    const to      = `${attMonth}-${String(lastDay).padStart(2, '0')}`;
    Promise.all([
      attendanceAPI.staffHistory(id, from, to).catch(() => []),
      attendanceAPI.monthly(attMonth).catch(() => null),
    ]).then(([records, monthly]) => {
      setAttRecords(records as typeof attRecords);
      if (monthly?.staff) {
        const row = monthly.staff.find((s: { staffId: string }) => s.staffId === id);
        if (row) {
          setAttData(row.dailyMap || {});
          setAttSummary({
            presentDays:    row.presentDays,
            lateDays:       row.lateDays,
            absentDays:     row.absentDays ?? 0,
            totalHours:     row.totalHours,
            overtimeHours:  row.overtimeHours,
            undertimeHours: row.undertimeHours,
          });
        } else {
          setAttData({});
          setAttSummary(null);
        }
      }
    });
  }, [id, attMonth, attReload]);

  /* ── Loading / not-found states ── */
  if (loading) return (
    <div className="space-y-4">
      <div className="card h-36 shimmer" />
      <div className="card h-48 shimmer" />
      <div className="card h-36 shimmer" />
    </div>
  );
  if (!staff) return (
    <div className="card text-center py-16">
      <p className="text-white/40">Staff not found</p>
      <button onClick={() => navigate('/staff')} className="btn-secondary mt-4">Back</button>
    </div>
  );

  /* ── Derived values ── */
  const facePhotoUrl  = (staff as Staff & { facePhoto?: string; facePhotoAt?: string }).facePhoto
    ? staffAPI.facePhotoUrl(staff.id, (staff as Staff & { facePhotoAt?: string }).facePhotoAt ?? '')
    : null;
  const streak        = staff.streakData?.currentStreak  || 0;
  const longestStreak = staff.streakData?.longestStreak  || 0;

  // Count working days in the viewed month up to today (if current month)
  const today = new Date();
  const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const isCurrentMonth  = attMonth === currentMonthStr;
  const [aYr, aMo] = attMonth.split('-').map(Number);
  const lastDayOfMonth = new Date(aYr, aMo, 0).getDate();
  const capDay = isCurrentMonth ? today.getDate() : lastDayOfMonth;
  let workingDays = 0;
  for (let d = 1; d <= capDay; d++) {
    const dow = new Date(aYr, aMo - 1, d).getDay();
    if (dow !== 0 && dow !== 6) workingDays++;
  }

  const presentDays = attSummary?.presentDays   || 0;
  const lateDays    = attSummary?.lateDays       || 0;
  const absentDays  = attSummary?.absentDays     ?? Math.max(0, workingDays - presentDays);
  const onTimeDays  = Math.max(0, presentDays - lateDays);

  // Composite performance score (0-100)
  const attScore  = workingDays > 0 ? Math.min(presentDays / workingDays * 40, 40) : 0;
  const intScore  = Math.min(interactions.length / 100 * 30, 30);
  const strScore  = Math.min(streak / 30 * 30, 30);
  const perfScore = Math.round(attScore + intScore + strScore);
  const scoreColor =
    perfScore >= 70 ? '#10b981' :
    perfScore >= 40 ? '#f59e0b' : '#ef4444';

  // Attendance donut
  const donutData = [
    { name: 'On Time', value: onTimeDays, color: '#10b981' },
    { name: 'Late',    value: lateDays,   color: '#f59e0b' },
    { name: 'Absent',  value: absentDays, color: '#ef4444' },
  ].filter(d => d.value > 0);

  // Attendance % for rate ring
  const attPct    = workingDays > 0 ? Math.round(presentDays / workingDays * 100) : 0;
  const onTimePct = presentDays > 0 ? Math.round(onTimeDays  / presentDays * 100) : 100;

  // Weekly interaction activity
  const weeklyActivity = (() => {
    const map: Record<string, { total: number; calls: number; messages: number; meetings: number }> = {};
    for (const ix of interactions) {
      const d  = new Date(ix.createdAt);
      const yr = d.getFullYear();
      const wk = Math.ceil(
        ((d.getTime() - new Date(yr, 0, 1).getTime()) / 86400000 +
          new Date(yr, 0, 1).getDay() + 1) / 7,
      );
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

  const recentInteractions = [...interactions]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 15);

  // Daily hours chart (last 10 records)
  const hoursChart = attRecords.slice(0, 10).reverse().map(r => ({
    date:    new Date(r.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    hours:   r.hoursWorked,
    isLate:  r.isLate,
  }));

  // Calendar helpers
  const firstDow = new Date(aYr, aMo - 1, 1).getDay();
  const calDays  = Array.from({ length: lastDayOfMonth }, (_, i) => String(i + 1).padStart(2, '0'));
  const cellBg = (v?: string) => {
    if (!v || v === 'absent')  return 'bg-red-500/20 text-red-400/70';
    if (v === 'late')          return 'bg-amber-400/35 text-amber-300/90';
    if (v === 'present')       return 'bg-green-500/25 text-green-300/90';
    if (v === 'leave')         return 'bg-blue-500/25 text-blue-300/90';
    if (v === 'sick')          return 'bg-purple-500/25 text-purple-300/90';
    if (v === 'half_day')      return 'bg-cyan-500/25 text-cyan-300/90';
    return 'bg-dark-200 text-white/20';
  };

  /* ── Helper to navigate months ── */
  const shiftMonth = (delta: number) => {
    const [y, m] = attMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setAttMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  /* ── Self-scan state derived ── */
  const faceDesc    = (staff as Staff & { faceDescriptors?: number[][] }).faceDescriptors || [];
  const canSelfScan = user?.id === staff.id &&
                      (staff as Staff & { canSelfCheckin?: boolean }).canSelfCheckin;
  const todayStr    = today.toISOString().split('T')[0];
  const todayRec    = attRecords.find(r => r.date === todayStr);
  const clockStatus: 'in' | 'out' | 'absent' = !todayRec ? 'absent'
    : todayRec.logoutAt ? 'out' : 'in';

  /* ════════════════════════════════════════════════════════════════════════ */
  return (
    <div className="space-y-5 animate-fade-in">

      {/* Back */}
      <button
        onClick={() => navigate('/staff')}
        className="flex items-center gap-2 text-white/40 hover:text-white text-sm transition-colors"
      >
        <ArrowLeft size={16} /> Back to Staff
      </button>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          ANIMATED ID CARD
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="kk-id-card-wrap">
        {/* Spinning conic-gradient that creates the animated border */}
        <div className="kk-id-card-glow" />

        <div className="kk-id-card-inner">
          {/* Header stripe */}
          <div className="kk-id-header">
            <div className="kk-id-scanlines" />
            <div className="w-1.5 h-1.5 rounded-full bg-gold/60 relative z-10" />
            <p className="text-[9px] font-bold tracking-[3px] uppercase text-gold/60 relative z-10">
              Staff ID · Kaamkaro AI
            </p>
            <div className="flex-1" />
            <span className={`relative z-10 text-[9px] font-bold px-2 py-0.5 rounded-full border
              ${staff.active
                ? 'bg-green-500/15 border-green-500/30 text-green-400'
                : 'bg-dark-200 border-dark-50 text-white/30'}`}>
              {staff.active ? '● ACTIVE' : '○ INACTIVE'}
            </span>
          </div>

          {/* Body */}
          <div className="flex items-start gap-4 p-5">
            {/* Avatar + performance ring */}
            <div className="flex-shrink-0 relative">
              <RadialRing
                value={perfScore} size={92} strokeWidth={4}
                color={scoreColor} trackColor="rgba(255,255,255,0.05)"
                delay={500}
              >
                {facePhotoUrl ? (
                  <img
                    src={facePhotoUrl}
                    alt={staff.name}
                    className="w-[68px] h-[68px] rounded-2xl object-cover border border-gold/25"
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <div className="w-[68px] h-[68px] rounded-2xl bg-gradient-to-br from-gold/25 to-gold/5
                                  border border-gold/25 flex items-center justify-center">
                    <span className="text-gold text-3xl font-black leading-none">{staff.avatar}</span>
                  </div>
                )}
              </RadialRing>

              {/* Online pulse dot */}
              {staff.active && (
                <span className="absolute bottom-1 right-1 w-3 h-3 rounded-full bg-green-500
                                 border-2 border-dark-300 kk-pulse-dot z-20" />
              )}
            </div>

            {/* Name / info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <h1 className="text-xl font-black text-white tracking-tight leading-tight">
                  {staff.name}
                </h1>
                {/* Score chip */}
                <div className="text-right flex-shrink-0">
                  <p className="text-[9px] text-white/25 uppercase tracking-widest leading-none mb-0.5">Score</p>
                  <p className="font-black text-2xl leading-none" style={{ color: scoreColor }}>
                    <AnimatedCounter target={perfScore} delay={450} />
                    <span className="text-sm font-medium" style={{ opacity: 0.4 }}>/100</span>
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-1 mt-2.5">
                <span className="text-white/40 text-xs flex items-center gap-1.5">
                  <Phone size={10} className="flex-shrink-0" />{staff.phone}
                </span>
                {staff.email && (
                  <span className="text-white/40 text-xs flex items-center gap-1.5">
                    <Mail size={10} className="flex-shrink-0" />{staff.email}
                  </span>
                )}
                <span className="text-white/25 text-xs flex items-center gap-1.5">
                  <Calendar size={10} className="flex-shrink-0" />
                  Joined {new Date(staff.joinDate).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                </span>
              </div>
            </div>
          </div>

          {/* Bottom stat bar — 4 columns */}
          <div className="border-t border-white/[0.05] grid grid-cols-4">
            {([
              { label: 'Customers',    value: customers.length,    suffix: '',  icon: Users,      color: 'text-blue-400' },
              { label: 'Interactions', value: interactions.length, suffix: '',  icon: TrendingUp, color: 'text-purple-400' },
              { label: 'Streak',       value: streak,              suffix: 'd', icon: Flame,       color: 'text-orange-400' },
              { label: 'Badges',       value: badges.length,       suffix: '',  icon: Award,       color: 'text-gold' },
            ] as const).map(({ label, value, suffix, icon: Icon, color }, idx) => (
              <div key={label}
                   className={`flex flex-col items-center py-3.5 gap-1 ${idx < 3 ? 'border-r border-white/[0.05]' : ''}`}>
                <Icon size={12} className={color} />
                <p className={`font-black text-base leading-none ${color}`}>
                  <AnimatedCounter target={value} suffix={suffix} delay={idx * 80} />
                </p>
                <p className="text-[9px] text-white/25 uppercase tracking-wide">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          ATTENDANCE OVERVIEW CARD
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="card">
        {/* Card header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-green-500/12 border border-green-500/20 flex items-center justify-center">
              <Activity size={15} className="text-green-400" />
            </div>
            <div>
              <h3 className="text-white font-semibold text-sm leading-tight">Attendance</h3>
              <p className="text-white/25 text-[10px]">Monthly overview</p>
            </div>
          </div>

          {/* Month picker */}
          <div className="flex items-center gap-0.5 bg-dark-200 rounded-xl p-1">
            <button onClick={() => shiftMonth(-1)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg
                               hover:bg-dark-100 text-white/40 hover:text-white transition-colors text-sm font-bold">
              ‹
            </button>
            <span className="text-white/60 text-[11px] font-medium px-1 min-w-[68px] text-center">
              {new Date(attMonth + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
            </span>
            <button onClick={() => shiftMonth(+1)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg
                               hover:bg-dark-100 text-white/40 hover:text-white transition-colors text-sm font-bold">
              ›
            </button>
          </div>
        </div>

        {attSummary ? (
          <>
            {/* ── Donut + breakdown ── */}
            <div className="flex items-center gap-5 mb-5">
              <div className="flex-shrink-0 relative">
                {donutData.length > 0 ? (
                  <ResponsiveContainer width={110} height={110}>
                    <PieChart>
                      <Pie
                        data={donutData} cx={55} cy={55}
                        innerRadius={30} outerRadius={48}
                        dataKey="value" startAngle={90} endAngle={-270}
                        strokeWidth={0} paddingAngle={2}
                        isAnimationActive animationDuration={900}
                      >
                        {donutData.map((e, i) => (
                          <Cell key={i} fill={e.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0];
                          return (
                            <div className="bg-dark-200 border border-dark-50 rounded-lg px-2 py-1 text-xs shadow-xl">
                              <span style={{ color: d.payload.color }}>{d.name}: {d.value}d</span>
                            </div>
                          );
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="w-[110px] h-[110px] flex items-center justify-center">
                    <p className="text-white/20 text-xs text-center">No data</p>
                  </div>
                )}
                {/* Centre label */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <p className="text-white font-black text-lg leading-none">
                    <AnimatedCounter target={attPct} suffix="%" delay={300} />
                  </p>
                  <p className="text-white/30 text-[9px] uppercase tracking-wide">Present</p>
                </div>
              </div>

              {/* Breakdown bars */}
              <div className="flex-1 space-y-2.5">
                {([
                  { label: 'On Time', value: onTimeDays,  color: '#10b981' },
                  { label: 'Late',    value: lateDays,    color: '#f59e0b' },
                  { label: 'Absent',  value: absentDays,  color: '#ef4444' },
                ] as const).map(({ label, value, color }) => (
                  <div key={label} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
                        <span className="text-white/40 text-xs">{label}</span>
                      </div>
                      <span className="font-bold text-sm" style={{ color }}>{value}d</span>
                    </div>
                    <div className="h-1.5 bg-dark-200 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: workingDays > 0 ? `${value / workingDays * 100}%` : '0%',
                          background: color,
                          transition: 'width 1.1s cubic-bezier(0.34,1.4,0.64,1) 200ms',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Stat pills ── */}
            <div className="grid grid-cols-3 gap-2.5 mb-5">
              {([
                { label: 'Total Hours', value: attSummary.totalHours,    suffix: 'h', decimals: 1, color: 'text-white' },
                { label: 'Overtime',    value: attSummary.overtimeHours,  suffix: 'h', decimals: 1, color: 'text-green-400' },
                { label: 'Undertime',   value: attSummary.undertimeHours, suffix: 'h', decimals: 1, color: 'text-red-400' },
              ] as const).map(({ label, value, suffix, decimals, color }) => (
                <div key={label} className="bg-dark-200 rounded-xl p-3 text-center">
                  <p className={`font-black text-lg leading-none ${color}`}>
                    <AnimatedCounter target={value} suffix={suffix} decimals={decimals} delay={200} />
                  </p>
                  <p className="text-white/25 text-[9px] uppercase tracking-wide mt-1">{label}</p>
                </div>
              ))}
            </div>

            {/* ── Daily hours bar chart ── */}
            {hoursChart.length > 0 && (
              <div className="mb-5">
                <p className="text-white/30 text-[10px] uppercase tracking-wider font-semibold mb-2.5">
                  Daily Hours
                </p>
                <ResponsiveContainer width="100%" height={72}>
                  <BarChart data={hoursChart} barSize={16}
                            margin={{ top: 0, right: 0, bottom: 0, left: -30 }}>
                    <YAxis tick={{ fill: '#444', fontSize: 9 }} axisLine={false} tickLine={false} />
                    <XAxis dataKey="date" tick={{ fill: '#444', fontSize: 9 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const row = payload[0]?.payload as { hours: number; isLate: boolean };
                        return (
                          <div className="bg-dark-200 border border-dark-50 rounded-lg px-2.5 py-1.5 text-xs shadow-xl">
                            <p className="text-white/50 mb-0.5">{label}</p>
                            <p className={`font-bold ${row.isLate ? 'text-amber-400' : 'text-gold'}`}>
                              {row.hours.toFixed(1)}h {row.isLate ? '· Late' : ''}
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="hours" radius={[4, 4, 0, 0]}>
                      {hoursChart.map((d, i) => (
                        <Cell key={i}
                              fill={d.isLate ? '#f59e0b' : GOLD}
                              fillOpacity={0.75} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex gap-4 mt-1.5">
                  <span className="flex items-center gap-1 text-[9px] text-white/25">
                    <span className="w-2 h-1.5 rounded-sm inline-block" style={{ background: GOLD, opacity: 0.75 }} />
                    On time
                  </span>
                  <span className="flex items-center gap-1 text-[9px] text-white/25">
                    <span className="w-2 h-1.5 rounded-sm bg-amber-400/75 inline-block" />
                    Late
                  </span>
                </div>
              </div>
            )}

            {/* ── Calendar heatmap ── */}
            {Object.keys(attData).length > 0 && (
              <div>
                <p className="text-white/30 text-[10px] uppercase tracking-wider font-semibold mb-2.5">
                  Calendar
                </p>
                <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
                  {/* Day-of-week headers */}
                  {['S','M','T','W','T','F','S'].map((d, i) => (
                    <p key={i} className="text-[9px] text-white/20 text-center font-medium pb-0.5">{d}</p>
                  ))}
                  {/* Leading empty cells */}
                  {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
                  {/* Day cells — tap to see (admins: edit) that day's check-in/out */}
                  {calDays.map(d => {
                    const fullDate = `${attMonth}-${String(parseInt(d)).padStart(2, '0')}`;
                    return (
                      <button
                        key={d}
                        title={attData[d] || 'no data'}
                        onClick={() => setDayDetail({ date: fullDate, record: attRecords.find(r => r.date === fullDate) || null })}
                        className={`aspect-square rounded-md flex items-center justify-center
                                    text-[9px] font-bold transition-all hover:ring-1 hover:ring-gold/40 active:scale-95 ${cellBg(attData[d])}`}
                      >
                        {parseInt(d)}
                      </button>
                    );
                  })}
                </div>
                {/* Legend */}
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2.5">
                  {([
                    { label: 'Present', cls: 'bg-green-500/25' },
                    { label: 'Late',    cls: 'bg-amber-400/35' },
                    { label: 'Absent',  cls: 'bg-red-500/20'   },
                    { label: 'Leave',   cls: 'bg-blue-500/25'  },
                    { label: 'Sick',    cls: 'bg-purple-500/25'},
                  ] as const).map(({ label, cls }) => (
                    <span key={label} className="flex items-center gap-1 text-[9px] text-white/25">
                      <span className={`w-2 h-2 rounded-sm inline-block ${cls}`} />
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-10">
            <p className="text-white/20 text-sm">No attendance data for this month</p>
          </div>
        )}
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          PERFORMANCE SECTOR RINGS
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="grid grid-cols-3 gap-3">
        {([
          {
            label: 'Attendance', sub: 'rate',
            value: attPct, max: 100, suffix: '%',
            color: '#10b981', icon: '📅',
          },
          {
            label: 'On-Time', sub: 'of present',
            value: onTimePct, max: 100, suffix: '%',
            color: '#f59e0b', icon: '⏰',
          },
          {
            label: 'Streak', sub: `best ${longestStreak}d`,
            value: streak, max: Math.max(streak, longestStreak, 30), suffix: 'd',
            color: '#f97316', icon: '🔥',
          },
        ] as const).map(({ label, sub, value, max, suffix, color, icon }, idx) => (
          <div key={label} className="card flex flex-col items-center gap-2.5 py-4 px-2">
            <RadialRing value={value} max={max} size={68} strokeWidth={5}
                        color={color} delay={300 + idx * 80}>
              <span className="text-lg leading-none">{icon}</span>
            </RadialRing>
            <div className="text-center">
              <p className="font-black text-base leading-none" style={{ color }}>
                <AnimatedCounter target={value} suffix={suffix} delay={350 + idx * 80} />
              </p>
              <p className="text-white/40 text-[10px] font-medium mt-0.5">{label}</p>
              <p className="text-white/20 text-[9px]">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          WEEKLY ACTIVITY (area chart)
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {weeklyActivity.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-white font-semibold text-sm">Weekly Activity</h3>
              <p className="text-white/30 text-xs mt-0.5">Interactions per week</p>
            </div>
            <div className="text-right">
              <p className="text-gold font-black text-xl leading-none">
                {weeklyActivity[weeklyActivity.length - 1]?.total ?? 0}
              </p>
              <p className="text-white/25 text-[10px]">this week</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={weeklyActivity} margin={{ top: 5, right: 4, bottom: 0, left: -30 }}>
              <defs>
                <linearGradient id="actGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={GOLD} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={GOLD} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={DIM} />
              <XAxis dataKey="week" tick={{ fill: '#555', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#555', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0]?.payload as typeof weeklyActivity[0];
                  return (
                    <div className="bg-dark-200 border border-dark-50 rounded-xl p-3 text-xs shadow-xl space-y-1">
                      <p className="text-white/50 font-medium mb-1">{label}</p>
                      <p className="text-gold font-bold">{d.total} total</p>
                      {d.calls    > 0 && <p className="text-blue-400">📞 {d.calls} calls</p>}
                      {d.messages > 0 && <p className="text-purple-400">💬 {d.messages} messages</p>}
                      {d.meetings > 0 && <p className="text-emerald-400">🤝 {d.meetings} meetings</p>}
                    </div>
                  );
                }}
                cursor={{ stroke: GOLD, strokeWidth: 1, strokeOpacity: 0.2 }}
              />
              <Area
                dataKey="total" stroke={GOLD} strokeWidth={2}
                fill="url(#actGrad)" dot={false}
                activeDot={{ r: 4, fill: GOLD, strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          BADGES
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {badges.length > 0 && (
        <div className="card">
          <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
            🏅 Badges
            <span className="bg-gold/15 text-gold text-[10px] font-bold rounded-full px-2 py-0.5">
              {badges.length}
            </span>
          </h3>
          <div className="flex flex-wrap gap-2">
            {badges.map(b => {
              const meta = BADGE_META[b.badgeKey];
              const tierCls = b.tier === 'gold'
                ? 'border-gold/40 bg-gold/8'
                : b.tier === 'silver'
                  ? 'border-slate-400/30 bg-slate-400/8'
                  : 'border-amber-600/30 bg-amber-600/8';
              return (
                <div
                  key={b.id}
                  title={`${b.label}${meta?.description ? ' — ' + meta.description : ''}\nEarned: ${new Date(b.earnedAt).toLocaleDateString('en-IN')}`}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-medium cursor-default transition-transform hover:scale-105 ${tierCls}`}
                >
                  <span className="text-base">{b.icon}</span>
                  <span className="text-white/80">{b.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          STREAK HISTORY
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {performance.length > 0 && (
        <div className="card">
          <h3 className="text-white font-semibold text-sm mb-4">Weekly Streak History</h3>
          <div className="space-y-0 divide-y divide-dark-50/30">
            {performance.slice(-6).reverse().map(p => (
              <div key={p.id}
                   className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-white/30 text-xs font-mono flex-shrink-0 w-16">{p.week}</span>
                <div className="flex gap-0.5 flex-1 justify-center">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <div key={i}
                         className={`w-4 h-4 rounded-sm transition-colors ${i < p.streak ? 'bg-gold/80' : 'bg-dark-200'}`} />
                  ))}
                </div>
                <span className="text-white/25 text-xs flex-shrink-0">{p.customersContacted}c</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          TABS: Activity · Customers · Records
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <TabBar
        tabs={[
          { id: 'activity',   label: `Activity (${interactions.length})` },
          { id: 'customers',  label: `Customers (${customers.length})` },
          { id: 'attendance', label: 'Records' },
        ]}
        active={activeTab}
        onChange={tabId => setActiveTab(tabId as typeof activeTab)}
        variant="pill-gold"
      />

      <AnimatedTabPanel key={activeTab} className="space-y-4">

        {/* Activity */}
        {activeTab === 'activity' && (
          <div className="card">
            <h3 className="text-white font-semibold text-sm mb-4">Recent Activity</h3>
            {recentInteractions.length === 0 ? (
              <p className="text-white/25 text-sm text-center py-6">No interactions logged yet</p>
            ) : (
              <div className="divide-y divide-dark-50/30">
                {recentInteractions.map(i => {
                  const c    = customers.find(cu => cu.id === i.customerId);
                  const days = Math.round((Date.now() - new Date(i.createdAt).getTime()) / 86400000);
                  return (
                    <div key={i.id} className="flex items-center gap-3 py-2.5">
                      <span className="text-base flex-shrink-0">{TYPE_LABELS[i.type] || '📞'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">
                          {c?.name || 'Customer'}
                          <span className="text-white/30 font-normal text-xs capitalize ml-1">via {i.type}</span>
                        </p>
                        {i.notes && <p className="text-white/30 text-xs truncate">{i.notes}</p>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <span className={`text-xs font-medium ${i.responded ? 'text-green-400' : 'text-white/25'}`}>
                          {i.responded ? '✓' : '–'}
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

        {/* Customers */}
        {activeTab === 'customers' && (
          <div className="card">
            <h3 className="text-white font-semibold text-sm mb-4">
              Assigned Customers ({customers.length})
            </h3>
            {customers.length === 0 ? (
              <p className="text-white/25 text-sm text-center py-6">No customers assigned</p>
            ) : (
              <div className="divide-y divide-dark-50/30">
                {customers.map(c => {
                  const days = c.lastContact
                    ? Math.round((Date.now() - new Date(c.lastContact).getTime()) / 86400000)
                    : null;
                  return (
                    <div key={c.id} className="flex items-center justify-between py-2.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-dark-200 border border-dark-50
                                        flex items-center justify-center flex-shrink-0">
                          <span className="text-white/50 text-xs font-bold">{c.name[0]}</span>
                        </div>
                        <div>
                          <p className="text-white text-sm font-medium">{c.name}</p>
                          <p className="text-white/25 text-xs">{c.phone}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="badge badge-gold text-[10px] capitalize">{c.status}</span>
                        {days !== null && (
                          <p className="text-white/20 text-[10px] mt-1">
                            {days === 0 ? 'Today' : `${days}d ago`}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Attendance Records */}
        {activeTab === 'attendance' && (
          <div className="space-y-4">
            {/* Self-scan widget */}
            {canSelfScan && (
              faceDesc.length > 0 ? (
                <div className="bg-dark-400 border border-dark-50 rounded-2xl p-4 flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-lg
                    ${clockStatus === 'in'
                      ? 'bg-red-500/15 border border-red-500/20'
                      : 'bg-green-500/15 border border-green-500/20'}`}>
                    {clockStatus === 'in' ? '🔴' : '🟢'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold text-sm">
                      {clockStatus === 'in' ? "You're clocked in" : "You're clocked out"}
                    </p>
                    <p className="text-white/30 text-xs mt-0.5">
                      {clockStatus === 'in' ? 'Tap to record your check-out' : 'Tap to record your check-in'}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowSelfScan(true)}
                    className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-semibold transition-colors
                      ${clockStatus === 'in'
                        ? 'bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/25'
                        : 'bg-green-500/15 border border-green-500/25 text-green-400 hover:bg-green-500/25'}`}
                  >
                    {clockStatus === 'in' ? 'Clock Out' : 'Clock In'}
                  </button>
                  {showSelfScan && (
                    <Suspense fallback={null}>
                      <SelfScanModal
                        faceDescriptors={faceDesc}
                        currentStatus={clockStatus}
                        onClose={() => setShowSelfScan(false)}
                        onDone={() => {
                          setShowSelfScan(false);
                          // Re-trigger attendance fetch for current month
                          setAttMonth(m => m); // identity update triggers the effect
                        }}
                      />
                    </Suspense>
                  )}
                </div>
              ) : (
                <div className="bg-amber-500/8 border border-amber-500/20 rounded-2xl px-4 py-3 text-sm text-amber-400/80">
                  🧳 On Tour mode — ask your manager to enroll your face at the office kiosk.
                </div>
              )
            )}

            {/* Detailed records table */}
            {attRecords.length > 0 ? (
              <div className="card overflow-hidden">
                <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">
                  Detailed Records
                </p>
                <div className="divide-y divide-dark-50/30">
                  {attRecords.map(r => (
                    <div key={r.date} className="flex items-center gap-3 py-2.5 text-sm">
                      <Clock size={12} className="text-white/20 flex-shrink-0" />
                      <span className="text-white/60 w-20 flex-shrink-0 text-xs">
                        {new Date(r.date + 'T00:00:00').toLocaleDateString('en-IN', {
                          day: 'numeric', month: 'short',
                        })}
                      </span>
                      <span className="text-white/40 text-xs flex-1 font-mono">
                        {r.loginAt ? fmt(r.loginAt) : '—'} → {r.logoutAt ? fmt(r.logoutAt) : '—'}
                      </span>
                      <span className="text-white/50 text-xs w-10 text-right">
                        {r.hoursWorked > 0 ? `${r.hoursWorked.toFixed(1)}h` : '—'}
                      </span>
                      {r.isLate && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full
                                         bg-amber-500/15 text-amber-400 border border-amber-500/20">
                          Late
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="card text-center py-10">
                <p className="text-white/20 text-sm">No records for this month</p>
              </div>
            )}
          </div>
        )}

      </AnimatedTabPanel>
    </div>
  );
}
