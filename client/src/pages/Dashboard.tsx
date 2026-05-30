import Select from '../components/Select';
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
  PieChart, Pie,
} from 'recharts';
import {
  TrendingUp, Users, UserCheck, AlertTriangle,
  CheckCircle, Clock, ChevronRight,
  MessageSquare, Target, Zap, Trophy, AlertCircle,
  Award, Plus, X, Star, TrendingDown, Flame, Mic,
  ShieldAlert, ScanFace, Link2, Sparkles, Package,
} from 'lucide-react';
import { staffAPI, customersAPI, aiAPI, tasksAPI, meritsAPI, broadcastAPI, interactionsAPI, fraudAPI, attendanceAPI, adminAPI, insightsAPI } from '../lib/api';
import Portal from '../components/Portal';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useSSE } from '../hooks/useSSE';
import type { Staff, Customer, Performance, DashboardSummary, Task, MeritSummary, MeritGoal, Interaction } from '../types';
import { SelfScanModal } from '../components/SelfScanModal';
import { SelfEnrollModal } from '../components/SelfEnrollModal';

function playNotifBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx(); const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination); osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime); osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.35, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.5);
  } catch { /**/ }
}

interface BroadcastMsg { id: string; message: string; sentBy: string; sentAt: string; }
interface FraudAlert {
  id: string; staffId: string; staffName: string;
  type: string; severity: 'high' | 'medium' | 'low';
  title: string; detail: string; evidence: string; detectedAt: string;
}
interface SalesData {
  summary: string;
  overallStats: {
    convRate: number; wonLeads: number; activeLeads: number;
    topProduct: string; topFinish: string; totalEntries: number;
  };
  trends: { item: string; count: number; direction?: string }[];
  restockAlerts: { item: string }[];
}
interface QueueItem {
  customerId: string; customerName: string; status: string;
  assignedStaffName: string; assignedStaffAvatar: string;
  lastContactDays: number; priorityScore: number;
  priority: 'urgent' | 'high' | 'medium' | 'low';
}

function getBcastReadSet(userId: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(`kk_bcast_read_${userId}`) || '[]')); } catch { return new Set(); }
}
function markBcastRead(userId: string, ids: string[]) {
  const s = getBcastReadSet(userId); ids.forEach(id => s.add(id));
  localStorage.setItem(`kk_bcast_read_${userId}`, JSON.stringify([...s]));
}

const GOLD = '#D4AF37';

const PIPELINE_COLORS: Record<string, string> = {
  lead: '#888', contacted: '#60a5fa', interested: '#D4AF37',
  negotiating: '#f97316', closed: '#4ade80', churned: '#f87171',
};

// ── Inline chart tooltip — adapts to dark/light ──────────────────────────────
const ChartTip = ({ active, payload, label }: { active?: boolean; payload?: { value: number; fill?: string; name?: string; dataKey?: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-dark-200 border border-dark-50 rounded-2xl px-3.5 py-2.5 text-xs shadow-2xl">
      <p className="text-white/50 mb-1.5 font-semibold">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="font-bold" style={{ color: p.fill || GOLD }}>
          {p.name || p.dataKey}: {p.value}{p.dataKey === 'taskRate' ? '%' : ''}
        </p>
      ))}
    </div>
  );
};

// ── ─────────────────────────────────────────────────────────────────────────
// ADMIN DASHBOARD
// ── ─────────────────────────────────────────────────────────────────────────
function AdminDashboard() {
  const [staff, setStaff]           = useState<Staff[]>([]);
  const [summary, setSummary]       = useState<DashboardSummary | null>(null);
  const [meritSummary, setMeritSum] = useState<MeritSummary[]>([]);
  const [allTasks, setAllTasks]     = useState<Task[]>([]);
  const [loading, setLoading]       = useState(true);
  const [customers, setCustomers]   = useState<Customer[]>([]);
  const [fraudAlerts, setFraudAlerts]     = useState<FraudAlert[]>([]);
  const [fraudExpanded, setFraudExpanded] = useState(false);
  const [expandedBanner, setExpandedBanner] = useState<'customers' | 'tasks' | null>(null);
  const [attExpanded, setAttExpanded] = useState(false);
  const [todayAtt, setTodayAtt]     = useState<{ inCount: number; total: number; late: number; absent: number } | null>(null);
  const [todayAttFull, setTodayAttFull] = useState<{ staffId: string; staffName: string; avatar: string; status: 'in'|'out'|'absent'; isLate: boolean; hoursWorked: number; leaveToday: { type: string } | null }[]>([]);
  const [sales, setSales] = useState<SalesData | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const navigate = useNavigate();
  const { isLight } = useTheme();
  // Adaptive chart palette — flips with theme
  const CHART_GRID = isLight ? '#d1d1d6' : '#1f1f22';
  const CHART_TICK = isLight ? '#8e8e93' : '#52525a';

  const loadData = useCallback(async () => {
    try {
      const [s, sum, ms, tasks, cust, fraud] = await Promise.all([
        staffAPI.list().catch(() => [] as Staff[]),
        aiAPI.dashboardSummary().catch(() => null),
        meritsAPI.summary().then(r => Array.isArray(r) ? r : []).catch(() => [] as MeritSummary[]),
        tasksAPI.list().catch(() => [] as Task[]),
        customersAPI.list().catch(() => [] as Customer[]),
        fraudAPI.detect().catch(() => ({ alerts: [] })),
      ]);
      setStaff(s); setSummary(sum); setMeritSum(ms);
      setAllTasks(tasks); setCustomers(cust as Customer[]);
      setFraudAlerts((fraud as { alerts: FraudAlert[] }).alerts || []);
      attendanceAPI.today().then((recs: typeof todayAttFull) => {
        setTodayAttFull(recs);
        setTodayAtt({
          inCount: recs.filter(r => r.status === 'in').length,
          total:   recs.length,
          late:    recs.filter(r => r.isLate).length,
          absent:  recs.filter(r => r.status === 'absent').length,
        });
      }).catch(() => {});
      aiAPI.salesInsights().then((d: SalesData) => setSales(d)).catch(() => {});
      insightsAPI.queue().then((q: QueueItem[]) => setQueue(Array.isArray(q) ? q : [])).catch(() => {});
    } catch { /**/ } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── derived data ────────────────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];

  const overdueTasks = allTasks.filter(t => !t.completed && t.dueDate < today).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const cutoff7 = new Date(Date.now() - 7 * 86400000).toISOString();
  const staleCustomers = customers.filter(c => !c.lastContact || c.lastContact < cutoff7).map(c => {
    const assigneeId = (c as Customer & { assignedTo?: string; staffId?: string }).assignedTo || (c as Customer & { assignedTo?: string; staffId?: string }).staffId || '';
    return { ...c, daysSilent: c.lastContact ? Math.floor((Date.now() - new Date(c.lastContact).getTime()) / 86400000) : 9999, assignedStaffName: staff.find(s => s.id === assigneeId)?.name || 'Unassigned' };
  }).sort((a, b) => b.daysSilent - a.daysSilent);

  const inactiveStaff = staff.filter(s => { const last = s.streakData?.lastActivityDate; if (!last) return true; return Math.floor((Date.now() - new Date(last).getTime()) / 86400000) >= 7; });
  const negativeStaff = meritSummary.filter(m => m.total < 0);
  const overdueHeavy = staff.map(s => ({ ...s, overdueCount: allTasks.filter(t => t.staffId === s.id && !t.completed && t.dueDate < today).length })).filter(s => s.overdueCount >= 3);
  const totalRedAlerts = inactiveStaff.length + negativeStaff.length + overdueHeavy.length;

  // ── Task rate & conversion (pie) ────────────────────────────────────────────
  const totalTasks     = allTasks.length;
  const completedTasks = allTasks.filter(t => t.completed).length;
  const taskCompletionRate = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const taskPie = [
    { name: 'Completed', value: completedTasks,                           color: '#10b981' },
    { name: 'Pending',   value: Math.max(totalTasks - completedTasks, 0), color: isLight ? '#e5e5ea' : '#2a2a2e' },
  ];
  const STAGE_ORDER = ['lead', 'contacted', 'interested', 'negotiating', 'closed', 'churned'] as const;
  const convPie = STAGE_ORDER
    .map(st => ({ name: st, value: customers.filter(c => c.status === st).length, color: PIPELINE_COLORS[st] }))
    .filter(d => d.value > 0);
  const closedCount = customers.filter(c => c.status === 'closed').length;
  const convRate = customers.length ? Math.round((closedCount / customers.length) * 100) : 0;

  // ── Follow-up queue summary ──────────────────────────────────────────────────
  const urgentCount = queue.filter(q => q.priority === 'urgent').length;
  const highCount   = queue.filter(q => q.priority === 'high').length;
  const mediumCount = queue.filter(q => q.priority === 'medium').length;
  const lowCount    = queue.filter(q => q.priority === 'low').length;
  const topQueue    = queue.slice(0, 6);
  const queueDist = [
    { key: 'urgent', label: 'Urgent', value: urgentCount, color: '#ef4444' },
    { key: 'high',   label: 'High',   value: highCount,   color: '#f97316' },
    { key: 'medium', label: 'Medium', value: mediumCount, color: '#f59e0b' },
    { key: 'low',    label: 'Low',    value: lowCount,    color: '#52525a' },
  ].filter(d => d.value > 0);
  const PRIORITY: Record<string, { text: string; chip: string; dot: string }> = {
    urgent: { text: 'text-red-300',    chip: 'bg-red-500/15 text-red-300',       dot: '#ef4444' },
    high:   { text: 'text-orange-300', chip: 'bg-orange-500/15 text-orange-300', dot: '#f97316' },
    medium: { text: 'text-amber-300',  chip: 'bg-amber-500/12 text-amber-300',   dot: '#f59e0b' },
    low:    { text: 'text-white/40',   chip: 'bg-white/8 text-white/50',         dot: '#888' },
  };

  if (loading) return (
    <div className="space-y-5 animate-pulse">
      <div className="h-28 rounded-3xl bg-dark-300" />
      <div className="grid grid-cols-3 gap-4"><div className="col-span-2 h-64 rounded-3xl bg-dark-300" /><div className="col-span-1 h-64 rounded-2xl bg-dark-300" /></div>
      <div className="grid grid-cols-2 gap-4"><div className="h-52 rounded-2xl bg-dark-300" /><div className="h-52 rounded-2xl bg-dark-300" /></div>
    </div>
  );

  return (
    <div className="space-y-4">

      {/* ── METRIC STRIP — Total Staff · Active Customers · Alerts ─────────── */}
      <div className="rounded-3xl bg-dark-300 border border-dark-100 overflow-hidden animate-fade-in-up">
        <div className="grid grid-cols-3 divide-x divide-dark-100">
          {[
            { label: 'Total Staff',      value: summary?.totalStaff ?? staff.length,           sub: 'Active members', accent: false, alert: false, path: '/staff' },
            { label: 'Active Customers', value: summary?.activeCustomers ?? customers.length,  sub: 'In pipeline',    accent: true,  alert: false, path: '/customers' },
            { label: 'Alerts',           value: totalRedAlerts + fraudAlerts.length,           sub: (totalRedAlerts + fraudAlerts.length) > 0 ? 'Need attention' : 'All clear', accent: false, alert: (totalRedAlerts + fraudAlerts.length) > 0, path: '/followup' },
          ].map(({ label, value, sub, accent, alert, path }) => (
            <button key={label} onClick={() => navigate(path)}
              className="p-3 sm:p-6 text-left hover:bg-white/[0.04] transition-colors group relative overflow-hidden">
              <div className={`absolute top-0 left-0 right-0 h-[2px] ${alert ? 'bg-red-500' : accent ? 'bg-gold' : 'bg-white/10'}`} />
              <p className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold mb-1.5 sm:mb-3">{label}</p>
              <p className={`text-3xl sm:text-5xl font-black leading-none transition-colors ${alert ? 'text-red-300' : 'text-white group-hover:text-gold'}`}>{value}</p>
              <p className={`text-[10px] sm:text-xs mt-1.5 sm:mt-2 flex items-center gap-1 ${alert ? 'text-red-400/60' : 'text-white/35'}`}>
                {sub} <ChevronRight size={10} className="opacity-60 group-hover:translate-x-0.5 transition-transform" />
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* ── TODAY'S ATTENDANCE (compact pill, expandable) ─────────────────── */}
      {todayAttFull.length > 0 && (
        <div className="rounded-2xl bg-dark-300 border border-dark-100 overflow-hidden animate-fade-in-up">
          <button onClick={() => setAttExpanded(e => !e)}
            className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-white/[0.04] transition-colors">
            <div className="w-8 h-8 rounded-xl bg-green-500/12 border border-green-500/20 flex items-center justify-center flex-shrink-0">
              <UserCheck size={15} className="text-green-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-bold leading-tight">Today's Attendance</p>
              <p className="text-white/30 text-[10px]">{new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</p>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/12 text-green-300">{todayAtt?.inCount ?? 0} in</span>
              {(todayAtt?.late ?? 0) > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/12 text-amber-300">{todayAtt?.late} late</span>}
              {(todayAtt?.absent ?? 0) > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/12 text-red-300">{todayAtt?.absent} absent</span>}
            </div>
            <ChevronRight size={14} className={`text-white/40 transition-transform duration-200 flex-shrink-0 ${attExpanded ? 'rotate-90' : ''}`} />
          </button>
          {attExpanded && (
          <div className="border-t border-dark-100 p-5">
            <div className="flex items-center justify-end mb-4">
              <button onClick={() => navigate('/attendance-portal')}
                className="text-xs text-white/30 hover:text-gold transition-colors flex items-center gap-1">
                Full view <ChevronRight size={12} />
              </button>
            </div>

            <div className="grid grid-cols-4 gap-2 mb-5">
              {([
                { label: 'In',     value: todayAtt?.inCount ?? 0,                               color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/20' },
                { label: 'Late',   value: todayAtt?.late ?? 0,                                  color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/20' },
                { label: 'Out',    value: todayAttFull.filter(r => r.status === 'out').length,  color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/20' },
                { label: 'Absent', value: todayAtt?.absent ?? 0,                                color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/20' },
              ] as const).map(({ label, value, color, bg }) => (
                <div key={label} className={`rounded-xl border p-2.5 text-center ${bg}`}>
                  <p className={`text-xl font-black leading-none ${color}`}>{value}</p>
                  <p className="text-white/30 text-[9px] uppercase tracking-wide mt-1">{label}</p>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              {todayAttFull.map(r => {
                const maxHrs = 10;
                const pct    = Math.min((r.hoursWorked / maxHrs) * 100, 100);
                const barCol = r.leaveToday     ? '#6366f1'
                             : r.status === 'absent' ? '#ef4444'
                             : r.isLate          ? '#f59e0b'
                             : r.hoursWorked > 0 ? '#10b981'
                             : '#6366f1';
                const statusLabel = r.leaveToday
                  ? `Leave (${r.leaveToday.type})`
                  : r.status === 'absent' ? 'Absent'
                  : r.isLate ? `Late`
                  : r.status === 'in' ? 'In'
                  : `${r.hoursWorked.toFixed(1)}h`;
                return (
                  <div key={r.staffId}
                       className="flex items-center gap-2 group cursor-pointer"
                       onClick={() => navigate(`/staff/${r.staffId}`)}>
                    <div className="w-6 h-6 rounded-full bg-dark-200 border border-dark-100 flex-shrink-0
                                    flex items-center justify-center text-[9px] font-black text-white/60
                                    group-hover:border-gold/30 transition-colors">
                      {r.avatar}
                    </div>
                    <span className="text-white/50 text-[11px] w-16 flex-shrink-0 truncate
                                     group-hover:text-white/80 transition-colors">
                      {r.staffName.split(' ')[0]}
                    </span>
                    <div className="flex-1 h-4 bg-dark-200 rounded-full overflow-hidden relative">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: r.status === 'absent' && !r.leaveToday ? '4px' : `${Math.max(pct, 2)}%`,
                          background: barCol,
                          opacity: 0.8,
                          minWidth: r.status === 'absent' ? 0 : 4,
                        }}
                      />
                    </div>
                    <span className="text-[10px] font-semibold w-14 text-right flex-shrink-0"
                          style={{ color: barCol }}>
                      {statusLabel}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 pt-3 border-t border-dark-100">
              {([
                { label: 'On Time', color: '#10b981' },
                { label: 'Late',    color: '#f59e0b' },
                { label: 'Absent',  color: '#ef4444' },
                { label: 'Leave',   color: '#6366f1' },
              ] as const).map(({ label, color }) => (
                <span key={label} className="flex items-center gap-1.5 text-[10px] text-white/30">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: color, opacity: 0.8 }} />
                  {label}
                </span>
              ))}
              <span className="text-[10px] text-white/20 ml-auto">Bar = hours worked (max 10h)</span>
            </div>
          </div>
          )}
        </div>
      )}

      {/* ── TASK RATE & CONVERSION (pie) ──────────────────────────────────── */}
      <div className="rounded-2xl bg-dark-300 border border-dark-100 overflow-hidden animate-fade-in-up">
        <div className="h-[2px] bg-gradient-to-r from-blue-500/70 via-blue-500/30 to-transparent" />
        <div className="p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-white/40 text-[10px] uppercase tracking-[0.18em] font-bold">Performance</p>
              <p className="text-xl font-black text-white mt-0.5">Task Rate & Conversion</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {/* Task completion donut */}
            <div className="flex items-center gap-4">
              <div className="relative w-[120px] h-[120px] flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={taskPie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={38} outerRadius={56} paddingAngle={2} stroke="none">
                      {taskPie.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip content={<ChartTip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-2xl font-black text-white leading-none">{taskCompletionRate}%</span>
                  <span className="text-white/35 text-[9px] uppercase tracking-wide mt-0.5">Done</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-white/45 text-[10px] uppercase tracking-wider font-bold">Task Completion</p>
                <p className="text-xs text-white/60 flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#10b981' }} />{completedTasks} completed</p>
                <p className="text-xs text-white/60 flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: isLight ? '#e5e5ea' : '#3a3a3e' }} />{Math.max(totalTasks - completedTasks, 0)} pending</p>
              </div>
            </div>
            {/* Conversion donut */}
            <div className="flex items-center gap-4 sm:border-l sm:border-dark-100 sm:pl-4">
              <div className="relative w-[120px] h-[120px] flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={convPie.length ? convPie : [{ name: 'none', value: 1, color: isLight ? '#e5e5ea' : '#2a2a2e' }]} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={38} outerRadius={56} paddingAngle={2} stroke="none">
                      {(convPie.length ? convPie : [{ color: isLight ? '#e5e5ea' : '#2a2a2e' }]).map((d, i) => <Cell key={i} fill={(d as { color: string }).color} />)}
                    </Pie>
                    <Tooltip content={<ChartTip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-2xl font-black text-white leading-none">{convRate}%</span>
                  <span className="text-white/35 text-[9px] uppercase tracking-wide mt-0.5">Closed</span>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-white/45 text-[10px] uppercase tracking-wider font-bold mb-0.5">Pipeline</p>
                {convPie.length ? convPie.map(d => (
                  <p key={d.name} className="text-[11px] text-white/60 flex items-center gap-1.5 capitalize"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: d.color }} />{d.value} {d.name}</p>
                )) : <p className="text-white/30 text-xs">No customers yet</p>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── SALES INSIGHTS ────────────────────────────────────────────────── */}
      {sales && (
        <div className="rounded-2xl bg-dark-300 border border-dark-100 overflow-hidden animate-fade-in-up">
          <div className="h-[2px] bg-gradient-to-r from-gold/70 via-gold/25 to-transparent" />
          <div className="p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-white/40 text-[10px] uppercase tracking-[0.18em] font-bold">Intelligence</p>
                <p className="text-xl font-black text-white mt-0.5 flex items-center gap-2">Sales Insights <Sparkles size={15} className="text-gold" /></p>
              </div>
              <button onClick={() => navigate('/sales-insights')} className="text-xs text-white/30 hover:text-gold transition-colors flex items-center gap-1">
                Open <ChevronRight size={12} />
              </button>
            </div>
            {sales.summary && <p className="text-white/55 text-xs leading-relaxed mb-4">{sales.summary}</p>}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {([
                { label: 'Conv. Rate', value: `${sales.overallStats?.convRate ?? 0}%`, color: 'text-green-400' },
                { label: 'Won Leads',  value: sales.overallStats?.wonLeads ?? 0,        color: 'text-gold' },
                { label: 'Diary Logs', value: sales.overallStats?.totalEntries ?? 0,    color: 'text-blue-400' },
              ] as const).map(({ label, value, color }) => (
                <div key={label} className="rounded-xl border border-dark-100 bg-dark-200 p-2.5 text-center">
                  <p className={`text-xl font-black leading-none ${color}`}>{value}</p>
                  <p className="text-white/30 text-[9px] uppercase tracking-wide mt-1">{label}</p>
                </div>
              ))}
            </div>
            {(sales.trends?.length ?? 0) > 0 && (() => {
              const maxC = Math.max(...sales.trends.map(t => t.count), 1);
              return (
                <div className="space-y-1.5">
                  <p className="text-white/40 text-[10px] uppercase tracking-wider font-bold mb-1">Most Discussed Products</p>
                  {sales.trends.slice(0, 5).map(t => (
                    <div key={t.item} className="flex items-center gap-2">
                      <span className="text-white/55 text-[11px] w-24 flex-shrink-0 truncate capitalize">{t.item}</span>
                      <div className="flex-1 h-3.5 bg-dark-200 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max((t.count / maxC) * 100, 4)}%`, background: GOLD, opacity: 0.85 }} />
                      </div>
                      <span className="text-gold text-[10px] font-bold w-6 text-right flex-shrink-0">{t.count}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
            {(sales.restockAlerts?.length ?? 0) > 0 && (
              <div className="mt-4 pt-3 border-t border-dark-100 flex items-center gap-2 flex-wrap">
                <Package size={12} className="text-amber-400" />
                <span className="text-amber-400/70 text-[10px] font-semibold">Restock signals:</span>
                {sales.restockAlerts.slice(0, 4).map((r, i) => (
                  <span key={i} className="text-[10px] bg-amber-500/12 text-amber-300 px-2 py-0.5 rounded-full capitalize">{r.item}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── FOLLOW-UP QUEUE SUMMARY ───────────────────────────────────────── */}
      <div className="rounded-2xl bg-dark-300 border border-dark-100 overflow-hidden animate-fade-in-up">
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-100/60">
          <div>
            <p className="text-white/40 text-[10px] uppercase tracking-[0.18em] font-bold">Priority</p>
            <p className="text-xl font-black text-white mt-0.5 flex items-center gap-2">Follow-up Queue <Target size={15} className="text-gold" /></p>
          </div>
          <button onClick={() => navigate('/followup')} className="text-white/40 text-xs hover:text-gold flex items-center gap-1 transition-colors font-semibold">
            View all <ChevronRight size={12} />
          </button>
        </div>
        {topQueue.length === 0 ? (
          <div className="flex flex-col items-center py-10 gap-2">
            <CheckCircle size={28} className="text-white/10" />
            <p className="text-white/40 text-sm">Queue is clear — nothing pending</p>
          </div>
        ) : (
          <>
            {/* Priority distribution — stacked bar + legend */}
            <div className="px-5 py-4 border-b border-dark-100/40 space-y-3">
              <div className="flex items-end justify-between">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-black text-red-300 leading-none">{urgentCount}</span>
                  <span className="text-white/35 text-[11px] font-semibold mb-0.5">urgent</span>
                </div>
                <span className="text-white/30 text-[10px]">{queue.length} customers tracked</span>
              </div>
              <div className="flex h-3 w-full rounded-full overflow-hidden bg-dark-200">
                {queueDist.map(d => (
                  <div key={d.key}
                    className="h-full transition-all duration-700 first:rounded-l-full last:rounded-r-full"
                    style={{ width: `${(d.value / queue.length) * 100}%`, background: d.color, opacity: 0.9 }}
                    title={`${d.label}: ${d.value}`} />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                {([
                  { label: 'Urgent', value: urgentCount, color: '#ef4444' },
                  { label: 'High',   value: highCount,   color: '#f97316' },
                  { label: 'Medium', value: mediumCount, color: '#f59e0b' },
                  { label: 'Low',    value: lowCount,    color: '#52525a' },
                ]).map(d => (
                  <span key={d.label} className="flex items-center gap-1.5 text-[11px]">
                    <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: d.color, opacity: 0.9 }} />
                    <span className="text-white/45">{d.label}</span>
                    <span className="text-white/70 font-bold">{d.value}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="divide-y divide-dark-100/40">
              {topQueue.map(q => {
                const pr = PRIORITY[q.priority] || PRIORITY.low;
                return (
                  <div key={q.customerId} onClick={() => navigate('/followup')}
                    className="flex items-center gap-3 px-5 py-3.5 cursor-pointer transition-colors hover:bg-white/[0.04]">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: pr.dot }} />
                    <div className="w-9 h-9 rounded-xl bg-dark-200 border border-dark-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-white/45 text-xs font-black">{q.customerName[0]}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-semibold truncate">{q.customerName}</p>
                      <p className="text-white/30 text-[10px] truncate">{q.assignedStaffName} · <span className="capitalize">{q.status}</span></p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${pr.chip}`}>{q.priority}</span>
                      <p className="text-white/30 text-[10px] mt-1">{q.lastContactDays >= 9999 ? 'Never' : `${q.lastContactDays}d ago`}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ── ALERTS & FLAGS (moved to bottom) ───────────────────────────── */}
      {(summary?.overdueCount ?? 0) > 0 && (
        <div className="rounded-2xl overflow-hidden border border-red-500/20 bg-red-500/6 animate-fade-in-up">
          <button className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-red-500/5 transition-colors" onClick={() => setExpandedBanner(expandedBanner === 'customers' ? null : 'customers')}>
            <div className="w-1.5 h-6 rounded-full bg-red-500 flex-shrink-0 animate-glow-breathe" />
            <AlertTriangle size={14} className="text-red-400 flex-shrink-0" />
            <p className="text-red-300 text-sm text-left flex-1 font-medium">
              <span className="font-bold">{summary!.overdueCount} customers</span> haven't been contacted in 7+ days
            </p>
            <span className="text-[10px] font-bold bg-red-500/20 text-red-300 px-2.5 py-1 rounded-full">{summary!.overdueCount}</span>
            <ChevronRight size={13} className={`text-red-400 transition-transform duration-200 ${expandedBanner === 'customers' ? 'rotate-90' : ''}`} />
          </button>
          {expandedBanner === 'customers' && (
            <div className="border-t border-red-500/10">
              <div className="max-h-60 overflow-y-auto">
                {staleCustomers.slice(0, 20).map(c => (
                  <div key={c.id} className="px-5 py-3 border-b border-red-500/8 last:border-0 hover:bg-red-500/5 cursor-pointer" onClick={() => navigate('/customers')}>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-red-500/15 flex items-center justify-center flex-shrink-0">
                        <span className="text-red-300 text-xs font-black">{c.name[0]}</span>
                      </div>
                      <div className="flex-1 min-w-0"><p className="text-white text-xs font-semibold truncate">{c.name}</p><p className="text-red-400/55 text-[10px]">{c.assignedStaffName}</p></div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${c.daysSilent >= 30 ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/15 text-amber-300'}`}>{c.daysSilent >= 9999 ? 'Never' : `${c.daysSilent}d`}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between px-5 py-2.5 border-t border-red-500/10">
                <span className="text-red-400/40 text-[10px]">{staleCustomers.length} total</span>
                <button className="text-red-300 text-xs font-semibold flex items-center gap-1 hover:text-red-200 transition-colors" onClick={() => navigate('/customers')}>View all <ChevronRight size={11} /></button>
              </div>
            </div>
          )}
        </div>
      )}

      {(summary?.dueTasksCount ?? 0) > 0 && (
        <div className="rounded-2xl overflow-hidden border border-amber-500/20 bg-amber-500/5 animate-fade-in-up">
          <button className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-amber-500/5 transition-colors" onClick={() => setExpandedBanner(expandedBanner === 'tasks' ? null : 'tasks')}>
            <div className="w-1.5 h-6 rounded-full bg-amber-500 flex-shrink-0 animate-glow-breathe" />
            <Clock size={14} className="text-amber-400 flex-shrink-0" />
            <p className="text-amber-300 text-sm text-left flex-1 font-medium"><span className="font-bold">{summary!.dueTasksCount} tasks</span> are due today or overdue</p>
            <span className="text-[10px] font-bold bg-amber-500/20 text-amber-300 px-2.5 py-1 rounded-full">{summary!.dueTasksCount}</span>
            <ChevronRight size={13} className={`text-amber-400 transition-transform duration-200 ${expandedBanner === 'tasks' ? 'rotate-90' : ''}`} />
          </button>
          {expandedBanner === 'tasks' && (
            <div className="border-t border-amber-500/10">
              <div className="max-h-60 overflow-y-auto">
                {overdueTasks.slice(0, 20).map(t => {
                  const daysOverdue = Math.ceil((Date.now() - new Date(t.dueDate).getTime()) / 86400000);
                  const sm = staff.find(s => s.id === t.staffId);
                  return (
                    <div key={t.id} className="flex items-center gap-3 px-5 py-2.5 border-b border-amber-500/8 last:border-0 hover:bg-amber-500/5 cursor-pointer" onClick={() => navigate('/tasks')}>
                      <div className="w-7 h-7 rounded-xl bg-amber-500/12 flex items-center justify-center flex-shrink-0"><span className="text-amber-400 text-[10px] font-black">{sm?.avatar ?? '?'}</span></div>
                      <div className="flex-1 min-w-0"><p className="text-white text-xs font-medium truncate">{t.title}</p><p className="text-amber-400/55 text-[10px]">{sm?.name?.split(' ')[0] ?? 'Unknown'}{t.customerName ? ` · ${t.customerName}` : ''}</p></div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 flex-shrink-0">{daysOverdue}d</span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between px-5 py-2.5 border-t border-amber-500/10">
                <span className="text-amber-400/40 text-[10px]">{overdueTasks.length} total</span>
                <button className="text-amber-300 text-xs font-semibold flex items-center gap-1 hover:text-amber-200 transition-colors" onClick={() => navigate('/tasks')}>View all <ChevronRight size={11} /></button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Red-alert + Fraud compact row */}
      {(totalRedAlerts > 0 || fraudAlerts.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div onClick={() => navigate('/followup')}
            className={`rounded-2xl border p-4 sm:p-5 cursor-pointer transition-all hover:scale-[1.01] animate-fade-in-up ${
              totalRedAlerts > 0 ? 'bg-gradient-to-br from-red-500/8 to-dark-300 border-red-500/25 hover:border-red-500/40' : 'bg-dark-300 border-dark-100'
            }`}>
            <div className="flex items-center justify-between mb-3">
              <div className={`w-9 h-9 rounded-2xl flex items-center justify-center ${totalRedAlerts > 0 ? 'bg-red-500/20 border border-red-500/30' : 'bg-dark-200 border border-dark-100'}`}>
                <AlertTriangle size={15} className={totalRedAlerts > 0 ? 'text-red-400' : 'text-white/30'} />
              </div>
              <span className={`text-4xl font-black leading-none ${totalRedAlerts > 0 ? 'text-red-300' : 'text-white/20'}`}>{totalRedAlerts}</span>
            </div>
            <p className={`text-sm font-bold ${totalRedAlerts > 0 ? 'text-red-300' : 'text-white/30'}`}>Red Alerts</p>
            {totalRedAlerts > 0 ? (
              <div className="mt-3 space-y-1.5">
                {inactiveStaff.length > 0 && <p className="text-red-400/55 text-[10px] flex items-center gap-1.5"><Clock size={9} /> {inactiveStaff.length} inactive 7+ days</p>}
                {negativeStaff.length > 0 && <p className="text-red-400/55 text-[10px] flex items-center gap-1.5"><TrendingDown size={9} /> {negativeStaff.length} negative merit</p>}
                {overdueHeavy.length > 0 && <p className="text-red-400/55 text-[10px] flex items-center gap-1.5"><AlertCircle size={9} /> {overdueHeavy.length} with 3+ overdue tasks</p>}
                <p className="text-red-400/40 text-[10px] mt-2 flex items-center gap-1">Tap to review <ChevronRight size={9} /></p>
              </div>
            ) : (
              <p className="text-white/35 text-xs mt-1">Everything looks good</p>
            )}
          </div>

          {fraudAlerts.length > 0 && (
            <button onClick={() => setFraudExpanded(e => !e)}
              className="rounded-2xl border border-orange-500/20 bg-gradient-to-br from-orange-500/8 to-dark-300 p-4 sm:p-5 text-left hover:border-orange-500/35 transition-all animate-fade-in-up">
              <div className="flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded-2xl bg-orange-500/15 border border-orange-500/25 flex items-center justify-center">
                  <ShieldAlert size={15} className="text-orange-400" />
                </div>
                <span className="text-4xl font-black text-orange-300 leading-none">{fraudAlerts.length}</span>
              </div>
              <p className="text-sm font-bold text-orange-300">Fraud Flags</p>
              <p className="text-orange-400/40 text-[10px] mt-1.5">
                {fraudAlerts.filter(a => a.severity === 'high').length} high · {fraudAlerts.filter(a => a.severity === 'medium').length} medium
              </p>
              <p className="text-orange-400/35 text-[10px] mt-2 flex items-center gap-1">Tap to expand <ChevronRight size={9} /></p>
            </button>
          )}
        </div>
      )}

      {/* ── FRAUD EXPANDED ────────────────────────────────────────────────── */}
      {fraudExpanded && fraudAlerts.length > 0 && (
        <div className="rounded-2xl border border-orange-500/20 bg-dark-300 overflow-hidden animate-fade-in-up">
          <div className="flex items-center justify-between px-5 py-4 border-b border-dark-100">
            <div className="flex items-center gap-2.5">
              <ShieldAlert size={16} className="text-orange-400" />
              <p className="text-orange-300 font-bold text-sm">Anti-Fraud Alerts</p>
              {fraudAlerts.some(a => a.severity === 'high') && <span className="text-[10px] font-bold bg-red-500/20 text-red-300 rounded-full px-2 py-0.5">{fraudAlerts.filter(a => a.severity === 'high').length} HIGH</span>}
            </div>
            <button onClick={() => setFraudExpanded(false)} className="text-white/40 hover:text-white transition-colors"><X size={16} /></button>
          </div>
          <div className="p-4 space-y-2.5">
            {fraudAlerts.map(alert => {
              const sevLeft = alert.severity === 'high' ? 'bg-red-500' : alert.severity === 'medium' ? 'bg-orange-500' : 'bg-yellow-500';
              const sevBadge = alert.severity === 'high' ? 'bg-red-500/20 text-red-300' : alert.severity === 'medium' ? 'bg-orange-500/20 text-orange-300' : 'bg-yellow-500/15 text-yellow-300';
              return (
                <div key={alert.id} className="flex gap-3 p-3.5 rounded-xl bg-dark-200 border border-dark-100 relative overflow-hidden">
                  <div className={`absolute left-0 top-0 bottom-0 w-1 ${sevLeft} rounded-l-xl`} />
                  <div className="pl-2 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-white text-xs font-semibold">{alert.title}</p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${sevBadge}`}>{alert.severity}</span>
                    </div>
                    <p className="text-white/55 text-[11px] mt-1">{alert.detail}</p>
                    <p className="text-white/40 text-[10px] mt-1.5">Staff: {alert.staffName}</p>
                  </div>
                  <button onClick={() => navigate(`/staff/${alert.staffId}`)} className="flex-shrink-0 w-8 h-8 rounded-xl bg-gold/10 border border-gold/20 flex items-center justify-center hover:bg-gold/20 transition-colors">
                    <span className="text-gold text-[10px] font-black">{staff.find(s => s.id === alert.staffId)?.avatar || alert.staffName[0]}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── ─────────────────────────────────────────────────────────────────────────
// STAFF DASHBOARD
// ── ─────────────────────────────────────────────────────────────────────────
function StaffDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { isLight } = useTheme();
  const [customers, setCustomers]   = useState<Customer[]>([]);
  const [tasks, setTasks]           = useState<Task[]>([]);
  const [performance, setPerf]      = useState<Performance[]>([]);
  const [unreadQueue, setUnreadQueue]   = useState<BroadcastMsg[]>([]);
  const [bcastModal, setBcastModal]     = useState(false);
  const [bcastModalIdx, setBcastModalIdx] = useState(0);
  const [loading, setLoading]       = useState(true);
  // New insight state
  const [monthAtt, setMonthAtt]     = useState<{ dailyMap: Record<string, string>; presentDays: number; lateDays: number; absentDays: number; leaveDays: number; totalHours: number } | null>(null);
  const [meritFeed, setMeritFeed]   = useState<{ points: number; reason: string; category: string; createdAt: string }[]>([]);
  const [weekMeritPts, setWeekMeritPts] = useState(0);
  const [topCustomer, setTopCustomer]   = useState<{ customerId: string; customerName: string; status: string; lastContactDays: number | null; contextSnippet: string; patterns: { responsiveness: string } } | null>(null);
  // Self-checkin (on-tour) state
  const [selfStaff, setSelfStaff]   = useState<(Staff & { canSelfCheckin?: boolean; faceDescriptors?: number[][]; gender?: string; shiftOverride?: { shiftStart: string; shiftEnd: string } | null }) | null>(null);
  const [selfStatus, setSelfStatus] = useState<'in' | 'out' | 'absent'>('absent');
  const [showSelfScan, setShowSelfScan]     = useState(false);
  const [showSelfEnroll, setShowSelfEnroll] = useState(false);

  const dismissBcastModal = () => {
    markBcastRead(user!.id, unreadQueue.map(b => b.id));
    setBcastModal(false); setUnreadQueue([]);
  };

  // loadSelfCheckin is used by onDone callbacks from modals (re-fetch after action)
  const loadSelfCheckin = useCallback(async () => {
    if (!user?.id) return;
    try {
      const [staffRec, todayRecs] = await Promise.all([
        staffAPI.get(user.id),
        attendanceAPI.today().catch(() => [] as { staffId: string; status: string }[]),
      ]);
      setSelfStaff(staffRec);
      const myRec = (todayRecs as { staffId: string; status: string }[]).find(r => r.staffId === user.id);
      setSelfStatus((myRec?.status as 'in' | 'out' | 'absent') || 'absent');
    } catch { /**/ }
  }, [user]);

  const load = useCallback(async () => {
    // Fetch all data — including staff record + today's attendance — in one go
    // so the face-enroll / mark-attendance card appears at the same time as the rest of the page
    const [c, t, p, b, staffRec, todayRecs] = await Promise.all([
      customersAPI.list(),
      tasksAPI.list({ completed: false }),
      staffAPI.getPerformance(user!.id),
      broadcastAPI.list().catch(() => []),
      staffAPI.get(user!.id).catch(() => null),
      attendanceAPI.today().catch(() => [] as { staffId: string; status: string }[]),
    ]);
    setCustomers(c); setTasks(t);
    setPerf(p.sort((a: Performance, b: Performance) => a.week.localeCompare(b.week)));
    // New insight fetches (non-blocking, errors are soft-suppressed)
    const currentMonth = new Date().toISOString().slice(0, 7);
    attendanceAPI.monthly(currentMonth).then((att: typeof monthAtt) => setMonthAtt(att)).catch(() => {});
    meritsAPI.list({ limit: 8 }).then((feed: typeof meritFeed) => setMeritFeed(Array.isArray(feed) ? feed : [])).catch(() => {});
    meritsAPI.summary().then((sArr: { id?: string; weekPts?: number }[]) => {
      const me = Array.isArray(sArr) ? sArr.find(s => s.id === user!.id) : null;
      setWeekMeritPts(me?.weekPts || 0);
    }).catch(() => {});
    insightsAPI.queue().then((q: typeof topCustomer[]) => setTopCustomer(Array.isArray(q) && q.length > 0 ? q[0] : null)).catch(() => {});
    const bList = b as BroadcastMsg[];
    const readSet = getBcastReadSet(user!.id);
    const unread = bList.filter(br => !readSet.has(br.id));
    if (unread.length > 0) { setUnreadQueue(unread); setBcastModalIdx(0); setBcastModal(true); playNotifBeep(); }
    // Set self-checkin state — no layout shift
    setSelfStaff(staffRec as (Staff & { canSelfCheckin?: boolean; faceDescriptors?: number[][]; gender?: string; shiftOverride?: { shiftStart: string; shiftEnd: string } | null }) | null);
    const myRec = (todayRecs as { staffId: string; status: string }[]).find(r => r.staffId === user!.id);
    setSelfStatus((myRec?.status as 'in' | 'out' | 'absent') || 'absent');
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  useSSE({
    'admin:broadcast': (msg: unknown) => {
      const newMsg = msg as BroadcastMsg;
      setUnreadQueue(prev => { const updated = [newMsg, ...prev]; setBcastModalIdx(0); setBcastModal(true); return updated; });
      playNotifBeep();
    },
  });

  const streak = (user as Staff | null)?.streakData?.currentStreak || 0;
  const longestStreak = (user as Staff | null)?.streakData?.longestStreak || 0;
  const today = new Date().toISOString().split('T')[0];
  const todayTasks = tasks.filter(t => t.dueDate === today);
  const overdueTasks = tasks.filter(t => t.dueDate < today);
  const latestPerf = performance[performance.length - 1];
  const weekTarget = latestPerf?.targets || 20;
  const weekContacts = latestPerf?.customersContacted || 0;
  const weekProgress = Math.min((weekContacts / weekTarget) * 100, 100);
  const ringCirc = 87.96; // 2 * π * 14

  // Week-over-week deltas from performance history
  const prevPerf = performance.length >= 2 ? performance[performance.length - 2] : null;
  const wowContacts  = (latestPerf?.customersContacted || 0) - (prevPerf?.customersContacted || 0);
  const wowResponse  = (latestPerf?.responseRate || 0) - (prevPerf?.responseRate || 0);
  // Tasks completed this week vs last (from completedAt field on completed tasks - we don't fetch completed tasks here,
  // so fall back to performance.entriesLogged if available, otherwise omit)
  const wowEntries   = (latestPerf?.entriesLogged || 0) - (prevPerf?.entriesLogged || 0);

  // Heatmap helpers
  const currentMonthStr = new Date().toISOString().slice(0, 7);
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const todayDay = new Date().getDate();
  const ATT_COLOR: Record<string, string> = { present: '#10b981', late: '#f59e0b', absent: '#ef4444', leave: '#6366f1', sick: '#6366f1', half_day: '#f59e0b' };

  // Merit feed helpers
  const MERIT_COLOR: Record<string, string> = { task: '#60a5fa', streak: GOLD, conversion: '#4ade80', overdue: '#f87171', manual: '#94a3b8' };
  function relTime(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return d === 1 ? 'Yesterday' : `${d}d ago`;
  }

  // Pipeline status colours reuse PIPELINE_COLORS from top scope
  const RESP_BADGE: Record<string, string> = { ghosting: 'bg-red-500/15 text-red-300', ignoring: 'bg-orange-500/15 text-orange-300', slow: 'bg-amber-500/12 text-amber-300', responsive: 'bg-green-500/12 text-green-300' };

  const sortedCustomers = [...customers].sort((a, b) => {
    const da = a.lastContact ? Date.now() - new Date(a.lastContact).getTime() : Infinity;
    const db = b.lastContact ? Date.now() - new Date(b.lastContact).getTime() : Infinity;
    return db - da;
  });

  const handleCompleteTask = async (id: string) => {
    await tasksAPI.complete(id); setTasks(prev => prev.filter(t => t.id !== id));
  };

  if (loading) return (
    <div className="space-y-4 animate-pulse">
      <div className="h-40 rounded-3xl bg-dark-300" />
      <div className="h-16 rounded-2xl bg-dark-300" />
      <div className="grid grid-cols-3 gap-3">{Array(3).fill(0).map((_, i) => <div key={i} className="h-20 rounded-2xl bg-dark-300" />)}</div>
    </div>
  );

  return (
    <div className="space-y-3 animate-fade-in">

      {/* ── BROADCAST MODAL ───────────────────────────────────────────────── */}
      {bcastModal && unreadQueue.length > 0 && (() => {
        const b = unreadQueue[bcastModalIdx]; if (!b) return null;
        const hasNext = bcastModalIdx < unreadQueue.length - 1;
        return (
          <Portal>
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/80 backdrop-blur-sm">
            <div className="bg-dark-300 border border-amber-500/30 rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-sm animate-slide-up sm:animate-bounce-in">
              <div className="flex items-center justify-between px-5 py-4 border-b border-dark-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/12 border border-amber-500/20 flex items-center justify-center"><MessageSquare size={14} className="text-amber-400" /></div>
                  <div><p className="text-amber-300 font-bold text-sm">Announcement</p>{unreadQueue.length > 1 && <p className="text-white/40 text-[10px]">{bcastModalIdx + 1} of {unreadQueue.length}</p>}</div>
                </div>
                <button onClick={dismissBcastModal} className="text-white/40 hover:text-white transition-colors"><X size={16} /></button>
              </div>
              <div className="px-5 py-4"><p className="text-white text-sm leading-relaxed">{b.message}</p><p className="text-white/40 text-[10px] mt-3">{b.sentBy} · {new Date(b.sentAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}</p></div>
              <div className="flex gap-2 px-5 py-4 border-t border-dark-100">
                {hasNext ? (<><button onClick={() => setBcastModalIdx(i => i + 1)} className="flex-1 btn-primary text-sm py-2">Next →</button><button onClick={dismissBcastModal} className="flex-1 text-white/35 hover:text-white text-sm transition-colors">Done</button></>) : (<button onClick={dismissBcastModal} className="w-full btn-primary text-sm py-2">Got it</button>)}
              </div>
            </div>
          </div>
          </Portal>
        );
      })()}

      {/* ── MODALS (face enroll / self-scan) ─────────────────────────────── */}
      {showSelfEnroll && selfStaff && !selfStaff.faceDescriptors?.length && (
        <Portal>
          <SelfEnrollModal onClose={() => setShowSelfEnroll(false)} onDone={() => { loadSelfCheckin(); setShowSelfEnroll(false); }} />
        </Portal>
      )}
      {showSelfScan && selfStaff?.canSelfCheckin && (selfStaff.faceDescriptors || []).length > 0 && (
        <Portal>
          <SelfScanModal faceDescriptors={selfStaff.faceDescriptors!} currentStatus={selfStatus} onClose={() => setShowSelfScan(false)} onDone={() => { loadSelfCheckin(); setShowSelfScan(false); }} />
        </Portal>
      )}

      {/* ── COMPACT ALERT STRIP (face enroll / attendance) ───────────────── */}
      {(selfStaff && !selfStaff.faceDescriptors?.length) || selfStaff?.canSelfCheckin ? (
        <div className="flex gap-2">
          {selfStaff && !selfStaff.faceDescriptors?.length && (
            <button onClick={() => setShowSelfEnroll(true)}
              className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl border border-amber-500/25 bg-amber-500/5 hover:bg-amber-500/10 transition-colors text-left">
              <ScanFace size={14} className="text-amber-400 flex-shrink-0" />
              <span className="text-amber-300 text-xs font-semibold">Enroll face</span>
            </button>
          )}
          {selfStaff?.canSelfCheckin && (() => {
            const isIn = selfStatus === 'in';
            const hasFace = (selfStaff.faceDescriptors || []).length > 0;
            return (
              <button onClick={() => hasFace ? setShowSelfScan(true) : undefined}
                className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-colors text-left ${isIn ? 'border-green-500/25 bg-green-500/5 hover:bg-green-500/10' : 'border-amber-500/25 bg-amber-500/5 hover:bg-amber-500/10'}`}>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isIn ? 'bg-green-400' : 'bg-amber-400'}`} />
                <span className={`text-xs font-semibold ${isIn ? 'text-green-300' : 'text-amber-300'}`}>
                  {isIn ? 'Checked in · Clock out?' : 'Clock in'}
                </span>
              </button>
            );
          })()}
        </div>
      ) : null}

      {/* ── MIC HERO — biggest, first real thing ─────────────────────────── */}
      <button onClick={() => navigate('/diary')}
        className="w-full relative overflow-hidden rounded-3xl border border-gold/25 bg-gradient-to-br from-gold/10 via-gold/5 to-dark-300 p-7 flex flex-col items-center gap-4 hover:border-gold/40 hover:from-gold/16 transition-all group active:scale-[0.99]"
        style={{ boxShadow: '0 0 60px rgba(212,175,55,0.07)' }}>
        <div className="absolute -right-12 -top-12 w-48 h-48 rounded-full bg-gold/5 blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="w-20 h-20 rounded-3xl bg-gold/15 border border-gold/30 flex items-center justify-center group-hover:bg-gold/22 transition-colors">
            <Mic size={36} className="text-gold" />
          </div>
          <span className="absolute inset-0 rounded-3xl border border-gold/40 animate-ping opacity-20 group-hover:opacity-40" />
        </div>
        <div className="text-center relative z-10">
          <p className="text-white font-black text-xl">Log Today's Work</p>
          <p className="text-white/35 text-sm mt-1">Tap to open voice diary</p>
        </div>
      </button>

      {/* ── STATS BAR — streak · week · merit · overdue ───────────────────── */}
      <div className="rounded-2xl bg-dark-300 border border-dark-100 overflow-hidden">
        <div className="grid grid-cols-4 divide-x divide-dark-100">
          {[
            { label: 'Streak',  value: streak,                          suffix: 'd', color: streak > 0 ? 'text-gold' : 'text-white/40' },
            { label: 'Week',    value: weekContacts,                    suffix: `/${weekTarget}`, color: 'text-white' },
            { label: 'Points',  value: weekMeritPts >= 0 ? `+${weekMeritPts}` : weekMeritPts, suffix: '', color: weekMeritPts > 0 ? 'text-green-300' : weekMeritPts < 0 ? 'text-red-300' : 'text-white/40' },
            { label: 'Overdue', value: overdueTasks.length,             suffix: '', color: overdueTasks.length > 0 ? 'text-red-300' : 'text-white/40' },
          ].map(({ label, value, suffix, color }) => (
            <div key={label} className="p-3 text-center">
              <p className={`text-xl font-black leading-none ${color}`}>{value}<span className="text-[11px] font-semibold opacity-60">{suffix}</span></p>
              <p className="text-white/30 text-[9px] uppercase tracking-wider mt-1">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── INSIGHT STRIP — attendance · merit · top customer (compact) ───── */}
      <div className="space-y-2">

        {/* Attendance this month — just pills */}
        {monthAtt && (
          <button onClick={() => navigate('/attendance-portal')}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-dark-300 border border-dark-100 hover:border-dark-50 transition-colors text-left group">
            <UserCheck size={13} className="text-green-400 flex-shrink-0" />
            <div className="flex items-center gap-1.5 flex-1 flex-wrap">
              {[
                { label: 'Present', value: monthAtt.presentDays, color: 'text-green-300' },
                { label: 'Late',    value: monthAtt.lateDays,    color: 'text-amber-300' },
                { label: 'Absent',  value: monthAtt.absentDays,  color: 'text-red-300' },
              ].map(p => p.value > 0 ? (
                <span key={p.label} className={`text-[11px] font-bold ${p.color}`}>{p.value} {p.label}</span>
              ) : null).filter(Boolean).reduce((acc: React.ReactNode[], el, i, arr) => {
                acc.push(el);
                if (i < arr.length - 1) acc.push(<span key={`sep-${i}`} className="text-white/15 text-[10px]">·</span>);
                return acc;
              }, [])}
              <span className="text-white/25 text-[10px] ml-auto">{monthAtt.totalHours.toFixed(0)}h this month</span>
            </div>
            <ChevronRight size={11} className="text-white/20 group-hover:text-white/40 transition-colors flex-shrink-0" />
          </button>
        )}

        {/* Week trend — 3 numbers inline */}
        {prevPerf && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-dark-300 border border-dark-100">
            <TrendingUp size={13} className="text-blue-400 flex-shrink-0" />
            <span className="text-white/35 text-[11px] flex-shrink-0">vs last week</span>
            <div className="flex items-center gap-3 ml-auto">
              {[
                { label: 'Contacts', delta: wowContacts, suffix: '' },
                { label: 'Response', delta: wowResponse, suffix: '%' },
              ].map(({ label, delta, suffix }) => (
                <span key={label} className="flex items-center gap-0.5 text-[11px] font-bold">
                  <span className="text-white/25 font-normal">{label}</span>
                  <span className={delta > 0 ? 'text-green-400' : delta < 0 ? 'text-red-400' : 'text-white/30'}>
                    {delta > 0 ? ' ↑' : delta < 0 ? ' ↓' : ' →'}{delta !== 0 ? `${Math.abs(delta)}${suffix}` : ''}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Last 3 merit events — horizontal scroll */}
        {meritFeed.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-dark-300 border border-dark-100 overflow-x-auto scrollbar-hide">
            <Award size={13} className="text-gold flex-shrink-0" />
            <div className="flex items-center gap-2 flex-nowrap">
              {meritFeed.slice(0, 3).map((m, i) => {
                const col = MERIT_COLOR[m.category] || '#94a3b8';
                return (
                  <span key={i} className="flex items-center gap-1.5 flex-shrink-0 text-[11px] bg-dark-200 border border-dark-100 rounded-full px-2.5 py-1">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: col }} />
                    <span className="text-white/50 truncate max-w-[100px]">{m.reason}</span>
                    <span className={`font-black ${m.points > 0 ? 'text-green-400' : 'text-red-400'}`}>{m.points > 0 ? '+' : ''}{m.points}</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Top priority customer — compact single row */}
        {topCustomer && (() => {
          const days = topCustomer.lastContactDays;
          const daysColor = days === null || (days !== null && days > 21) ? 'text-red-300' : days > 14 ? 'text-amber-300' : 'text-white/50';
          return (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-dark-300 border border-red-500/20 bg-red-500/3">
              <Target size={13} className="text-red-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-semibold truncate">{topCustomer.customerName}</p>
                <p className="text-white/30 text-[10px] capitalize">{topCustomer.status}</p>
              </div>
              <span className={`text-xs font-black flex-shrink-0 ${daysColor}`}>{days === null ? 'Never' : `${days}d`}</span>
              <button onClick={() => navigate('/diary')}
                className="flex-shrink-0 text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-red-500/15 text-red-300 hover:bg-red-500/25 transition-colors">
                Log
              </button>
            </div>
          );
        })()}
      </div>

      {/* ── TODAY'S TASKS — max 2, compact ───────────────────────────────── */}
      {(todayTasks.length > 0 || overdueTasks.length > 0) && (
        <div className="rounded-2xl bg-dark-300 border border-dark-100 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-dark-100/50">
            <p className="text-white/60 text-xs font-bold">Tasks</p>
            <button onClick={() => navigate('/tasks')} className="text-white/30 text-[10px] hover:text-gold transition-colors flex items-center gap-0.5">
              {tasks.length} total <ChevronRight size={10} />
            </button>
          </div>
          <div className="divide-y divide-dark-100/40">
            {[...overdueTasks.slice(0, 1), ...todayTasks.slice(0, 2)].slice(0, 2).map(t => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                <button onClick={() => handleCompleteTask(t.id)}
                  className="w-4 h-4 rounded-full border border-gold/30 hover:border-gold hover:bg-gold/12 flex-shrink-0 transition-all" />
                <p className="text-white/75 text-xs flex-1 truncate">{t.title}</p>
                {t.dueDate < today && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-300 flex-shrink-0">Late</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user, isAdmin } = useAuth();
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        {/* Eyebrow */}
        <p className="text-white/40 text-[11px] uppercase tracking-[0.22em] font-bold mb-1">{today}</p>
        {/* Title */}
        <h1 className="text-3xl font-black text-white tracking-tight leading-none">
          {isAdmin ? 'Command Center' : 'My Dashboard'}
        </h1>
        <p className="text-white/30 text-sm mt-1.5">
          Welcome back, <span className="text-gold font-bold">{user?.name?.split(' ')[0]}</span>
        </p>
      </div>
      {isAdmin ? <AdminDashboard /> : <StaffDashboard />}
    </div>
  );
}
