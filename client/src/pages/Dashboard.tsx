import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import {
  TrendingUp, Users, UserCheck, AlertTriangle,
  CheckCircle, Clock, ChevronRight,
  MessageSquare, Target, Zap, Trophy, AlertCircle,
  Award, Plus, X, Star, TrendingDown, Flame, Mic,
  ShieldAlert,
} from 'lucide-react';
import { staffAPI, customersAPI, aiAPI, tasksAPI, meritsAPI, broadcastAPI, interactionsAPI, fraudAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useSSE } from '../hooks/useSSE';
import type { Staff, Customer, Performance, DashboardSummary, Task, MeritSummary, MeritGoal, Interaction } from '../types';

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

function getBcastReadSet(userId: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(`kk_bcast_read_${userId}`) || '[]')); } catch { return new Set(); }
}
function markBcastRead(userId: string, ids: string[]) {
  const s = getBcastReadSet(userId); ids.forEach(id => s.add(id));
  localStorage.setItem(`kk_bcast_read_${userId}`, JSON.stringify([...s]));
}

const GOLD = '#D4AF37';
const DIM  = '#1a1a1a';

const PIPELINE_COLORS: Record<string, string> = {
  lead: '#555', contacted: '#60a5fa', interested: '#D4AF37',
  negotiating: '#f97316', closed: '#4ade80', churned: '#f87171',
};

// ── Inline chart tooltip ─────────────────────────────────────────────────────
const ChartTip = ({ active, payload, label }: { active?: boolean; payload?: { value: number; fill?: string; name?: string; dataKey?: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#111] border border-white/10 rounded-2xl px-3.5 py-2.5 text-xs shadow-2xl">
      <p className="text-white/40 mb-1.5 font-medium">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="font-bold" style={{ color: p.fill || 'white' }}>
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
  const [performance, setPerf]      = useState<Performance[]>([]);
  const [summary, setSummary]       = useState<DashboardSummary | null>(null);
  const [meritSummary, setMeritSum] = useState<MeritSummary[]>([]);
  const [meritGoals, setMeritGoals] = useState<MeritGoal[]>([]);
  const [allTasks, setAllTasks]     = useState<Task[]>([]);
  const [loading, setLoading]       = useState(true);
  const [customers, setCustomers]               = useState<Customer[]>([]);
  const [allInteractions, setAllInteractions]   = useState<Interaction[]>([]);
  const [fraudAlerts, setFraudAlerts]           = useState<FraudAlert[]>([]);
  const [fraudExpanded, setFraudExpanded]       = useState(false);
  const [goalModal, setGoalModal]   = useState(false);
  const [gStaffId, setGStaffId]     = useState(''); const [gTarget, setGTarget] = useState('');
  const [gPeriod, setGPeriod]       = useState<'weekly' | 'monthly'>('monthly');
  const [gReward, setGReward]       = useState(''); const [savingGoal, setSavingGoal] = useState(false);
  const [awardModal, setAwardModal] = useState(false);
  const [aStaffId, setAStaffId]     = useState(''); const [aPoints, setAPoints] = useState('');
  const [aReason, setAReason]       = useState(''); const [savingAward, setSavingAward] = useState(false);
  const [expandedBanner, setExpandedBanner] = useState<'customers' | 'tasks' | null>(null);
  const navigate = useNavigate();

  const loadData = useCallback(async () => {
    try {
      const [s, sum, ms, mg, tasks, cust, ints, fraud] = await Promise.all([
        staffAPI.list().catch(() => [] as Staff[]),
        aiAPI.dashboardSummary().catch(() => null),
        meritsAPI.summary().then(r => Array.isArray(r) ? r : []).catch(() => [] as MeritSummary[]),
        meritsAPI.goals().then(r => Array.isArray(r) ? r : []).catch(() => [] as MeritGoal[]),
        tasksAPI.list().catch(() => [] as Task[]),
        customersAPI.list().catch(() => [] as Customer[]),
        interactionsAPI.list({}).catch(() => [] as Interaction[]),
        fraudAPI.detect().catch(() => ({ alerts: [] })),
      ]);
      setStaff(s); setSummary(sum); setMeritSum(ms); setMeritGoals(mg);
      setAllTasks(tasks); setCustomers(cust as Customer[]);
      setAllInteractions(ints as Interaction[]);
      setFraudAlerts((fraud as { alerts: FraudAlert[] }).alerts || []);
      if (s.length > 0) {
        const allPerf = await Promise.all(s.map((st: Staff) => staffAPI.getPerformance(st.id).catch(() => [])));
        setPerf(allPerf.flat());
      }
    } catch { /**/ } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── derived data ────────────────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];

  const weeklyData = (() => {
    const map: Record<string, { contacts: number; calls: number; messages: number; meetings: number; emails: number }> = {};
    for (const ix of allInteractions) {
      const d = new Date(ix.createdAt); const yr = d.getFullYear();
      const wk = Math.ceil(((d.getTime() - new Date(yr, 0, 1).getTime()) / 86400000 + new Date(yr, 0, 1).getDay() + 1) / 7);
      const key = `${yr}-W${String(wk).padStart(2, '0')}`;
      if (!map[key]) map[key] = { contacts: 0, calls: 0, messages: 0, meetings: 0, emails: 0 };
      map[key].contacts++;
      if (ix.type === 'call') map[key].calls++;
      else if (ix.type === 'message') map[key].messages++;
      else if (ix.type === 'meeting') map[key].meetings++;
      else if (ix.type === 'email') map[key].emails++;
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).slice(-7)
      .map(([key, v]) => ({ week: `W${key.split('-W')[1]}`, ...v }));
  })();

  const staffInteractionCounts = allInteractions.reduce((acc, ix) => {
    if (ix.staffId) acc[ix.staffId] = (acc[ix.staffId] || 0) + 1; return acc;
  }, {} as Record<string, number>);

  const staffPerfData = staff.map(s => {
    const latest = performance.filter(p => p.staffId === s.id).sort((a, b) => b.week.localeCompare(a.week))[0];
    return { id: s.id, name: s.name.split(' ')[0], avatar: s.avatar, interactions: staffInteractionCounts[s.id] || 0, contacts: latest?.customersContacted || 0 };
  });

  const meritChartData = meritSummary.map(m => ({ name: m.name.split(' ')[0], allTime: m.total, thisWeek: m.weekPts }));

  const taskRateData = staff.map(s => {
    const staffTasks = allTasks.filter(t => t.staffId === s.id);
    const ms = meritSummary.find(m => m.staffId === s.id);
    return {
      name: s.name.split(' ')[0],
      taskRate: staffTasks.length > 0 ? Math.round((staffTasks.filter(t => t.completed).length / staffTasks.length) * 100) : 0,
      conversions: Math.max(0, Math.floor((ms?.breakdown.conversion || 0) / 5)),
    };
  });

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

  // ── merit goal handlers ─────────────────────────────────────────────────────
  const handleSaveGoal = async () => {
    if (!gStaffId || !gTarget) return; setSavingGoal(true);
    try { await meritsAPI.createGoal({ staffId: gStaffId, targetPoints: parseInt(gTarget), period: gPeriod, reward: gReward }); setMeritGoals(await meritsAPI.goals()); setGoalModal(false); setGStaffId(''); setGTarget(''); setGPeriod('monthly'); setGReward(''); } finally { setSavingGoal(false); }
  };
  const handleDeleteGoal = async (id: string) => { await meritsAPI.deleteGoal(id); setMeritGoals(prev => prev.filter(g => g.id !== id)); };
  const handleAward = async () => {
    if (!aStaffId || !aPoints || !aReason) return; setSavingAward(true);
    try { await meritsAPI.award({ staffId: aStaffId, points: parseInt(aPoints), reason: aReason }); setMeritSum(await meritsAPI.summary()); setAwardModal(false); setAStaffId(''); setAPoints(''); setAReason(''); } finally { setSavingAward(false); }
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

      {/* ── ALERT BANNERS ─────────────────────────────────────────────────── */}
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
                {staleCustomers.slice(0, 20).map(c => {
                  const lastTwo = allInteractions.filter(i => i.customerId === c.id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 2);
                  return (
                    <div key={c.id} className="px-5 py-3 border-b border-red-500/8 last:border-0 hover:bg-red-500/5 cursor-pointer" onClick={() => navigate('/customers')}>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-red-500/15 flex items-center justify-center flex-shrink-0">
                          <span className="text-red-300 text-xs font-black">{c.name[0]}</span>
                        </div>
                        <div className="flex-1 min-w-0"><p className="text-white text-xs font-semibold truncate">{c.name}</p><p className="text-red-400/55 text-[10px]">{c.assignedStaffName}</p></div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${c.daysSilent >= 30 ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/15 text-amber-300'}`}>{c.daysSilent >= 9999 ? 'Never' : `${c.daysSilent}d`}</span>
                      </div>
                      {lastTwo.length > 0 && <div className="mt-1.5 ml-11 space-y-0.5">{lastTwo.map(i => <p key={i.id} className="text-[10px] text-white/40 truncate">{i.notes || `${i.type} logged`}</p>)}</div>}
                    </div>
                  );
                })}
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

      {/* ── METRIC STRIP ──────────────────────────────────────────────────── */}
      <div className="rounded-3xl bg-dark-300 border border-dark-100 overflow-hidden animate-fade-in-up">
        <div className="grid grid-cols-3 divide-x divide-dark-100">
          {[
            { label: 'Total Staff',       value: summary?.totalStaff ?? 0,       sub: 'Active members',   accent: false, path: '/staff' },
            { label: 'Active Customers',  value: summary?.activeCustomers ?? 0,   sub: 'In pipeline',      accent: true,  path: '/customers' },
            { label: 'Red Alerts',        value: totalRedAlerts,                   sub: totalRedAlerts > 0 ? 'Need attention' : 'All clear', alert: totalRedAlerts > 0, path: '/followup' },
          ].map(({ label, value, sub, accent, alert, path }) => (
            <button key={label} onClick={() => navigate(path)}
              className="p-6 text-left hover:bg-white/[0.025] transition-colors group relative overflow-hidden">
              {/* Tiny top accent line */}
              <div className={`absolute top-0 left-0 right-0 h-[2px] ${alert ? 'bg-red-500' : accent ? 'bg-gold' : 'bg-white/10'}`} />
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/20 font-bold mb-3">{label}</p>
              <p className={`text-5xl font-black leading-none transition-colors ${alert ? 'text-red-300' : 'text-white group-hover:text-gold'}`}>{value}</p>
              <p className={`text-xs mt-2 flex items-center gap-1 ${alert ? 'text-red-400/50' : 'text-white/20'}`}>
                {sub} <ChevronRight size={10} className="opacity-60 group-hover:translate-x-0.5 transition-transform" />
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* ── BENTO: Merit chart (2/3) + Right panel (1/3) ─────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">

        {/* Merit chart card — 2/3 */}
        {meritChartData.length > 0 && (
          <div className="lg:col-span-2 rounded-3xl bg-dark-300 border border-dark-100 overflow-hidden animate-fade-in-up stagger-1">
            {/* Gold accent top bar */}
            <div className="h-[3px] bg-gradient-to-r from-gold via-gold/60 to-transparent" />
            <div className="p-5">
              <div className="flex items-start justify-between mb-5">
                <div>
                  <p className="text-white/25 text-[10px] uppercase tracking-[0.18em] font-bold">Leaderboard</p>
                  <p className="text-2xl font-black text-white mt-0.5 flex items-center gap-2">
                    Merit Points <Trophy size={18} className="text-gold" />
                  </p>
                </div>
                <button onClick={() => setAwardModal(true)}
                  className="flex items-center gap-1.5 text-xs bg-gold/10 border border-gold/20 text-gold px-3 py-2 rounded-xl hover:bg-gold/18 transition-colors font-semibold">
                  <Award size={12} /> Award
                </button>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={meritChartData} barGap={4} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke={DIM} />
                  <XAxis dataKey="name" tick={{ fill: '#3a3a3a', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#3a3a3a', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(212,175,55,0.04)' }} />
                  <Bar dataKey="allTime" name="All-time" radius={[6, 6, 0, 0]}>
                    {meritChartData.map((e, i) => <Cell key={i} fill={e.allTime >= 0 ? GOLD : '#f87171'} fillOpacity={0.9} />)}
                  </Bar>
                  <Bar dataKey="thisWeek" name="This week" radius={[6, 6, 0, 0]}>
                    {meritChartData.map((e, i) => <Cell key={i} fill={e.thisWeek >= 0 ? '#a78bfa' : '#fb923c'} fillOpacity={0.75} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-5 mt-3 justify-end">
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ background: GOLD }} /><span className="text-white/25 text-[10px]">All-time</span></div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-purple-400/70" /><span className="text-white/25 text-[10px]">This week</span></div>
              </div>
            </div>
          </div>
        )}

        {/* Right panel — 1/3: Red Alert mini + Overdue tasks mini */}
        <div className="flex flex-col gap-4">

          {/* Red Alert mini card */}
          <div
            onClick={() => navigate('/followup')}
            className={`rounded-2xl border p-5 cursor-pointer transition-all hover:scale-[1.02] animate-fade-in-up stagger-2 ${
              totalRedAlerts > 0
                ? 'bg-gradient-to-br from-red-950/50 to-dark-300 border-red-500/25 hover:border-red-500/40'
                : 'bg-dark-300 border-dark-100 hover:border-dark-50'
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <div className={`w-9 h-9 rounded-2xl flex items-center justify-center ${totalRedAlerts > 0 ? 'bg-red-500/20 border border-red-500/30' : 'bg-dark-200 border border-dark-100'}`}
                style={totalRedAlerts > 0 ? { boxShadow: '0 0 20px rgba(248,113,113,0.2)' } : undefined}>
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
              <p className="text-white/15 text-xs mt-1">Everything looks good</p>
            )}
          </div>

          {/* Fraud mini card */}
          {fraudAlerts.length > 0 && (
            <button onClick={() => setFraudExpanded(e => !e)}
              className="rounded-2xl border border-orange-500/20 bg-gradient-to-br from-orange-950/30 to-dark-300 p-5 text-left hover:border-orange-500/35 transition-all animate-fade-in-up stagger-3">
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

          {/* Overdue tasks mini */}
          {overdueTasks.length > 0 && (
            <button onClick={() => navigate('/tasks')}
              className="rounded-2xl border border-dark-100 bg-dark-300 p-5 text-left hover:border-gold/20 transition-all animate-fade-in-up stagger-4 group">
              <div className="flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded-2xl bg-dark-200 border border-dark-100 flex items-center justify-center">
                  <Clock size={15} className="text-amber-400" />
                </div>
                <span className="text-4xl font-black text-amber-300 leading-none">{overdueTasks.length}</span>
              </div>
              <p className="text-sm font-bold text-white">Overdue Tasks</p>
              <p className="text-white/20 text-[10px] mt-1.5 truncate">
                {overdueTasks[0]?.title}
                {overdueTasks.length > 1 ? ` + ${overdueTasks.length - 1} more` : ''}
              </p>
              <p className="text-white/15 text-[10px] mt-2 flex items-center gap-1 group-hover:text-gold/40 transition-colors">View tasks <ChevronRight size={9} /></p>
            </button>
          )}
        </div>
      </div>

      {/* ── FRAUD EXPANDED ────────────────────────────────────────────────── */}
      {fraudExpanded && fraudAlerts.length > 0 && (
        <div className="rounded-2xl border border-orange-500/20 bg-dark-300 overflow-hidden animate-fade-in-up">
          <div className="flex items-center justify-between px-5 py-4 border-b border-dark-100">
            <div className="flex items-center gap-2.5">
              <ShieldAlert size={16} className="text-orange-400" />
              <p className="text-orange-300 font-bold text-sm">Anti-Fraud Alerts</p>
              {fraudAlerts.some(a => a.severity === 'high') && <span className="text-[10px] font-bold bg-red-500/20 text-red-300 rounded-full px-2 py-0.5">{fraudAlerts.filter(a => a.severity === 'high').length} HIGH</span>}
            </div>
            <button onClick={() => setFraudExpanded(false)} className="text-white/25 hover:text-white transition-colors"><X size={16} /></button>
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
                    <p className="text-white/25 text-[10px] mt-1.5">Staff: {alert.staffName}</p>
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

      {/* ── RED ALERT ZONE DETAIL (if any) ────────────────────────────────── */}
      {totalRedAlerts > 0 && (
        <div className="rounded-2xl border border-red-500/15 bg-dark-300 overflow-hidden animate-fade-in-up">
          <div className="h-[2px] bg-gradient-to-r from-red-500 via-red-500/40 to-transparent" />
          <div className="p-5">
            <p className="text-white/20 text-[10px] uppercase tracking-[0.2em] font-bold mb-4">Alert Breakdown</p>
            <div className="space-y-4">
              {inactiveStaff.length > 0 && (
                <div>
                  <p className="text-white/30 text-[11px] font-semibold mb-2 flex items-center gap-1.5 uppercase tracking-wider">
                    <Clock size={10} className="text-red-400" /> Inactive 7+ days
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {inactiveStaff.map(s => (
                      <button key={s.id} onClick={() => navigate(`/staff/${s.id}`)}
                        className="inline-flex items-center gap-2 bg-red-500/8 border border-red-500/18 text-red-300 text-xs px-3 py-1.5 rounded-full hover:bg-red-500/15 transition-all">
                        <span className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center text-[9px] font-black">{s.avatar}</span>
                        {s.name.split(' ')[0]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {negativeStaff.length > 0 && (
                <div>
                  <p className="text-white/30 text-[11px] font-semibold mb-2 flex items-center gap-1.5 uppercase tracking-wider">
                    <TrendingDown size={10} className="text-red-400" /> Negative merit balance
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {negativeStaff.map(m => (
                      <span key={m.staffId} className="inline-flex items-center gap-2 bg-red-500/8 border border-red-500/18 text-red-300 text-xs px-3 py-1.5 rounded-full">
                        <span className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center text-[9px] font-black">{m.avatar}</span>
                        {m.name.split(' ')[0]} <span className="text-red-400/60 font-bold">{m.total}pts</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {overdueHeavy.length > 0 && (
                <div>
                  <p className="text-white/30 text-[11px] font-semibold mb-2 flex items-center gap-1.5 uppercase tracking-wider">
                    <AlertCircle size={10} className="text-red-400" /> 3+ overdue tasks
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {overdueHeavy.map(s => (
                      <button key={s.id} onClick={() => navigate('/tasks')}
                        className="inline-flex items-center gap-2 bg-red-500/8 border border-red-500/18 text-red-300 text-xs px-3 py-1.5 rounded-full hover:bg-red-500/15 transition-all">
                        <span className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center text-[9px] font-black">{s.avatar}</span>
                        {s.name.split(' ')[0]} <span className="text-red-400/60 font-bold">{s.overdueCount}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── CHARTS ROW — Task rate + Contact breakdown ─────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* Task rate — 3/5 */}
        <div className="lg:col-span-3 rounded-2xl bg-dark-300 border border-dark-100 overflow-hidden animate-fade-in-up">
          <div className="h-[2px] bg-gradient-to-r from-blue-500/70 via-blue-500/30 to-transparent" />
          <div className="p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-white/20 text-[10px] uppercase tracking-[0.18em] font-bold">Performance</p>
                <p className="text-xl font-black text-white mt-0.5">Task Rate & Conversions</p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={taskRateData} barGap={4} barCategoryGap="30%">
                <CartesianGrid vertical={false} stroke={DIM} />
                <XAxis dataKey="name" tick={{ fill: '#3a3a3a', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#3a3a3a', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(255,255,255,0.02)' }} />
                <Bar dataKey="taskRate" name="Task %" fill="#60a5fa" fillOpacity={0.85} radius={[5, 5, 0, 0]} />
                <Bar dataKey="conversions" name="Conversions" fill={GOLD} fillOpacity={0.9} radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-5 mt-2 justify-end">
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-blue-400/80" /><span className="text-white/25 text-[10px]">Task Rate %</span></div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ background: GOLD }} /><span className="text-white/25 text-[10px]">Conversions</span></div>
            </div>
          </div>
        </div>

        {/* Weekly contacts — 2/5 */}
        <div className="lg:col-span-2 rounded-2xl bg-dark-300 border border-dark-100 overflow-hidden animate-fade-in-up">
          <div className="h-[2px] bg-gradient-to-r from-gold/70 via-gold/25 to-transparent" />
          <div className="p-5">
            <p className="text-white/20 text-[10px] uppercase tracking-[0.18em] font-bold">Activity</p>
            <p className="text-xl font-black text-white mt-0.5 mb-4">Weekly Contacts</p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={weeklyData} barSize={22}>
                <CartesianGrid vertical={false} stroke={DIM} />
                <XAxis dataKey="week" tick={{ fill: '#3a3a3a', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#3a3a3a', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(212,175,55,0.05)' }} />
                <Bar dataKey="contacts" name="Contacts" radius={[6, 6, 0, 0]}>
                  {weeklyData.map((_, i) => <Cell key={i} fill={i === weeklyData.length - 1 ? GOLD : '#252525'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── CONTACT BREAKDOWN ─────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-dark-300 border border-dark-100 overflow-hidden animate-fade-in-up">
        <div className="p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-white/20 text-[10px] uppercase tracking-[0.18em] font-bold">Communication</p>
              <p className="text-xl font-black text-white mt-0.5">Contact Breakdown</p>
            </div>
            <div className="flex items-center gap-4">
              {[['Calls','#60a5fa'],['Messages','#c084fc'],['Meetings',GOLD],['Emails','#34d399']].map(([l,c]) => (
                <div key={l} className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-sm" style={{ background: c }} />
                  <span className="text-white/25 text-[10px]">{l}</span>
                </div>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={weeklyData} barSize={14} barGap={2}>
              <CartesianGrid vertical={false} stroke={DIM} />
              <XAxis dataKey="week" tick={{ fill: '#3a3a3a', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#3a3a3a', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(255,255,255,0.02)' }} />
              <Bar dataKey="calls"    stackId="a" fill="#60a5fa" name="Calls"    radius={[0,0,0,0]} />
              <Bar dataKey="messages" stackId="a" fill="#c084fc" name="Messages" radius={[0,0,0,0]} />
              <Bar dataKey="meetings" stackId="a" fill={GOLD}    name="Meetings" radius={[0,0,0,0]} />
              <Bar dataKey="emails"   stackId="a" fill="#34d399" name="Emails"   radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── TEAM PERFORMANCE TABLE ────────────────────────────────────────── */}
      {staffPerfData.length > 0 && (
        <div className="rounded-2xl bg-dark-300 border border-dark-100 overflow-hidden animate-fade-in-up">
          <div className="flex items-center justify-between px-6 py-5 border-b border-dark-100/60">
            <div>
              <p className="text-white/20 text-[10px] uppercase tracking-[0.18em] font-bold">Rankings</p>
              <p className="text-xl font-black text-white mt-0.5">Team Performance</p>
            </div>
            <button onClick={() => navigate('/staff')} className="text-gold/50 text-xs hover:text-gold flex items-center gap-1 transition-colors font-semibold">
              Manage <ChevronRight size={12} />
            </button>
          </div>
          <div className="divide-y divide-dark-100/40">
            {staffPerfData.sort((a, b) => (meritSummary.find(m => m.staffId === b.id)?.total ?? 0) - (meritSummary.find(m => m.staffId === a.id)?.total ?? 0)).map((s, i) => {
              const ms = meritSummary.find(m => m.staffId === s.id);
              const maxInt = Math.max(...staffPerfData.map(x => x.interactions), 1);
              const rankColors = ['text-gold', 'text-white/50', 'text-amber-700/80'];
              const rankBg = ['bg-gold/15 border-gold/30', 'bg-dark-100 border-dark-50', 'bg-dark-100 border-dark-50'];
              return (
                <div key={s.id} onClick={() => navigate(`/staff/${s.id}`)}
                  className="flex items-center gap-4 px-6 py-4 hover:bg-white/[0.02] cursor-pointer transition-colors group">
                  {/* Rank */}
                  <div className={`w-7 h-7 rounded-full border flex items-center justify-center flex-shrink-0 ${rankBg[i] || 'bg-dark-100 border-dark-50'}`}>
                    <span className={`text-xs font-black ${rankColors[i] || 'text-white/25'}`}>#{i + 1}</span>
                  </div>
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-xl bg-gold/10 border border-gold/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-gold text-xs font-black">{s.avatar}</span>
                  </div>
                  {/* Name */}
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-semibold group-hover:text-gold transition-colors">{s.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 max-w-[120px] h-1.5 bg-dark-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500/70 rounded-full" style={{ width: `${Math.min(100, Math.round((s.interactions / maxInt) * 100))}%` }} />
                      </div>
                      <span className="text-white/25 text-[10px]">{s.interactions} interactions</span>
                    </div>
                  </div>
                  {/* Merit */}
                  <div className="text-right flex-shrink-0">
                    <p className={`text-lg font-black leading-none ${(ms?.total ?? 0) >= 0 ? 'text-gold' : 'text-red-400'}`}>
                      {(ms?.total ?? 0) >= 0 ? '+' : ''}{ms?.total ?? 0}
                    </p>
                    <p className="text-white/20 text-[10px] mt-0.5">pts</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── MERIT GOALS ───────────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-dark-300 border border-dark-100 overflow-hidden animate-fade-in-up">
        <div className="flex items-center justify-between px-6 py-5 border-b border-dark-100/60">
          <div>
            <p className="text-white/20 text-[10px] uppercase tracking-[0.18em] font-bold">Targets</p>
            <p className="text-xl font-black text-white mt-0.5 flex items-center gap-2">Merit Goals <Star size={16} className="text-gold" /></p>
          </div>
          <button onClick={() => setGoalModal(true)}
            className="flex items-center gap-1.5 text-xs bg-gold/10 border border-gold/20 text-gold px-3 py-2 rounded-xl hover:bg-gold/18 transition-colors font-semibold">
            <Plus size={12} /> Set Goal
          </button>
        </div>
        {meritGoals.length === 0 ? (
          <div className="flex flex-col items-center py-10 gap-2">
            <div className="w-12 h-12 rounded-2xl bg-gold/6 border border-gold/12 flex items-center justify-center">
              <Target size={20} className="text-gold/30" />
            </div>
            <p className="text-white/20 text-sm mt-1">No goals set yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-dark-100/40">
            {meritGoals.map(g => {
              const ms = meritSummary.find(m => m.staffId === g.staffId);
              const current = g.period === 'weekly' ? (ms?.weekPts ?? 0) : (ms?.monthPts ?? 0);
              const progress = Math.min(Math.max(Math.round((current / g.targetPoints) * 100), 0), 100);
              const done = progress >= 100;
              return (
                <div key={g.id} className="p-5 flex items-center gap-4">
                  {/* Circular ring */}
                  <div className="relative w-14 h-14 flex-shrink-0">
                    <svg viewBox="0 0 36 36" className="w-14 h-14 -rotate-90">
                      <circle cx="18" cy="18" r="14" fill="none" stroke="#1e1e1e" strokeWidth="3" />
                      <circle cx="18" cy="18" r="14" fill="none"
                        stroke={done ? '#4ade80' : GOLD}
                        strokeWidth="3" strokeLinecap="round"
                        strokeDasharray={`${(progress / 100) * 87.96} 87.96`}
                        style={{ transition: 'stroke-dasharray 0.6s ease' }}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className={`text-[11px] font-black ${done ? 'text-green-400' : 'text-gold'}`}>{progress}%</span>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-white text-sm font-bold">{g.staffName.split(' ')[0]}</p>
                      <span className="text-[10px] text-white/20 capitalize bg-dark-100 px-2 py-0.5 rounded-full">{g.period}</span>
                    </div>
                    <p className="text-white/25 text-xs">{current} / {g.targetPoints} pts</p>
                    {g.reward && <p className="text-gold/40 text-[10px] mt-0.5 truncate">🎁 {g.reward}</p>}
                  </div>
                  <button onClick={() => handleDeleteGoal(g.id)} className="text-white/12 hover:text-red-400 transition-colors flex-shrink-0"><X size={14} /></button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── MODALS ────────────────────────────────────────────────────────── */}
      {goalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-dark-300 border border-dark-100 rounded-3xl p-6 w-full max-w-sm shadow-2xl animate-fade-in-up">
            <div className="flex items-center justify-between mb-5">
              <p className="text-white font-black text-lg">Set Merit Goal</p>
              <button onClick={() => setGoalModal(false)} className="text-white/25 hover:text-white transition-colors"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div><label className="text-white/35 text-xs mb-1.5 block font-medium">Staff Member</label>
                <select value={gStaffId} onChange={e => setGStaffId(e.target.value)} className="w-full bg-dark-200 border border-dark-100 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50">
                  <option value="">Select staff...</option>{staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select></div>
              <div><label className="text-white/35 text-xs mb-1.5 block font-medium">Target Points</label>
                <input type="number" value={gTarget} onChange={e => setGTarget(e.target.value)} placeholder="e.g. 50" className="w-full bg-dark-200 border border-dark-100 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50 placeholder:text-white/20" /></div>
              <div><label className="text-white/35 text-xs mb-1.5 block font-medium">Period</label>
                <div className="flex gap-2">{(['weekly', 'monthly'] as const).map(p => (
                  <button key={p} onClick={() => setGPeriod(p)} className={`flex-1 py-2 rounded-xl text-sm capitalize font-semibold transition-all ${gPeriod === p ? 'bg-gold text-black' : 'bg-dark-200 border border-dark-100 text-white/40 hover:text-white'}`}>{p}</button>
                ))}</div></div>
              <div><label className="text-white/35 text-xs mb-1.5 block font-medium">Reward (optional)</label>
                <input type="text" value={gReward} onChange={e => setGReward(e.target.value)} placeholder="e.g. Bonus ₹500, day off..." className="w-full bg-dark-200 border border-dark-100 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50 placeholder:text-white/20" /></div>
              <button onClick={handleSaveGoal} disabled={!gStaffId || !gTarget || savingGoal} className="w-full bg-gold text-black font-black py-3 rounded-xl text-sm disabled:opacity-40 hover:bg-gold/90 transition-all active:scale-95">
                {savingGoal ? 'Saving...' : 'Save Goal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {awardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-dark-300 border border-dark-100 rounded-3xl p-6 w-full max-w-sm shadow-2xl animate-fade-in-up">
            <div className="flex items-center justify-between mb-5">
              <p className="text-white font-black text-lg">Award / Deduct Points</p>
              <button onClick={() => setAwardModal(false)} className="text-white/25 hover:text-white transition-colors"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div><label className="text-white/35 text-xs mb-1.5 block font-medium">Staff Member</label>
                <select value={aStaffId} onChange={e => setAStaffId(e.target.value)} className="w-full bg-dark-200 border border-dark-100 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50">
                  <option value="">Select staff...</option>{staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select></div>
              <div><label className="text-white/35 text-xs mb-1.5 block font-medium">Points (negative to deduct)</label>
                <input type="number" value={aPoints} onChange={e => setAPoints(e.target.value)} placeholder="e.g. 10 or -5" className="w-full bg-dark-200 border border-dark-100 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50 placeholder:text-white/20" /></div>
              <div><label className="text-white/35 text-xs mb-1.5 block font-medium">Reason</label>
                <input type="text" value={aReason} onChange={e => setAReason(e.target.value)} placeholder="e.g. Excellent client handling" className="w-full bg-dark-200 border border-dark-100 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50 placeholder:text-white/20" /></div>
              <button onClick={handleAward} disabled={!aStaffId || !aPoints || !aReason || savingAward} className="w-full bg-gold text-black font-black py-3 rounded-xl text-sm disabled:opacity-40 hover:bg-gold/90 transition-all active:scale-95">
                {savingAward ? 'Saving...' : 'Confirm'}
              </button>
            </div>
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
  const [customers, setCustomers]   = useState<Customer[]>([]);
  const [tasks, setTasks]           = useState<Task[]>([]);
  const [performance, setPerf]      = useState<Performance[]>([]);
  const [unreadQueue, setUnreadQueue]   = useState<BroadcastMsg[]>([]);
  const [bcastModal, setBcastModal]     = useState(false);
  const [bcastModalIdx, setBcastModalIdx] = useState(0);
  const [loading, setLoading]       = useState(true);

  const dismissBcastModal = () => {
    markBcastRead(user!.id, unreadQueue.map(b => b.id));
    setBcastModal(false); setUnreadQueue([]);
  };

  const load = useCallback(async () => {
    const [c, t, p, b] = await Promise.all([
      customersAPI.list(), tasksAPI.list({ completed: false }),
      staffAPI.getPerformance(user!.id), broadcastAPI.list().catch(() => []),
    ]);
    setCustomers(c); setTasks(t);
    setPerf(p.sort((a: Performance, b: Performance) => a.week.localeCompare(b.week)));
    const bList = b as BroadcastMsg[];
    const readSet = getBcastReadSet(user!.id);
    const unread = bList.filter(br => !readSet.has(br.id));
    if (unread.length > 0) { setUnreadQueue(unread); setBcastModalIdx(0); setBcastModal(true); playNotifBeep(); }
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
    <div className="space-y-4 animate-fade-in">

      {/* ── BROADCAST MODAL ───────────────────────────────────────────────── */}
      {bcastModal && unreadQueue.length > 0 && (() => {
        const b = unreadQueue[bcastModalIdx]; if (!b) return null;
        const hasNext = bcastModalIdx < unreadQueue.length - 1;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <div className="bg-dark-300 border border-amber-500/30 rounded-3xl shadow-2xl w-full max-w-sm animate-bounce-in">
              <div className="flex items-center justify-between px-5 py-4 border-b border-dark-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/12 border border-amber-500/20 flex items-center justify-center"><MessageSquare size={14} className="text-amber-400" /></div>
                  <div><p className="text-amber-300 font-bold text-sm">Announcement</p>{unreadQueue.length > 1 && <p className="text-white/20 text-[10px]">{bcastModalIdx + 1} of {unreadQueue.length}</p>}</div>
                </div>
                <button onClick={dismissBcastModal} className="text-white/25 hover:text-white transition-colors"><X size={16} /></button>
              </div>
              <div className="px-5 py-4"><p className="text-white text-sm leading-relaxed">{b.message}</p><p className="text-white/20 text-[10px] mt-3">{b.sentBy} · {new Date(b.sentAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}</p></div>
              <div className="flex gap-2 px-5 py-4 border-t border-dark-100">
                {hasNext ? (<><button onClick={() => setBcastModalIdx(i => i + 1)} className="flex-1 btn-primary text-sm py-2">Next →</button><button onClick={dismissBcastModal} className="flex-1 text-white/35 hover:text-white text-sm transition-colors">Done</button></>) : (<button onClick={dismissBcastModal} className="w-full btn-primary text-sm py-2">Got it</button>)}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── STREAK HERO ───────────────────────────────────────────────────── */}
      <div className="rounded-3xl border border-gold/18 bg-dark-300 overflow-hidden relative"
        style={{ boxShadow: streak > 0 ? '0 0 60px rgba(212,175,55,0.06)' : undefined }}>
        {/* Top gold stripe */}
        <div className="h-[2px] bg-gradient-to-r from-gold via-gold/50 to-transparent" />
        {/* Decorative bg orb */}
        <div className="absolute -right-16 -top-16 w-52 h-52 rounded-full bg-gold/4 blur-3xl pointer-events-none" />

        <div className="relative z-10 p-6 flex items-center gap-6">
          {/* Big streak number */}
          <div className="flex-1">
            <p className="text-white/20 text-[10px] uppercase tracking-[0.22em] font-bold mb-2">Current Streak</p>
            <div className="flex items-end gap-3">
              <span className="text-7xl font-black text-white leading-none">{streak}</span>
              <div className="mb-2 flex flex-col gap-0.5">
                <span className="text-gold text-xl font-black leading-none">days</span>
                {streak > 0 && <Flame size={18} className="text-gold animate-glow-breathe" style={{ filter: 'drop-shadow(0 0 6px rgba(212,175,55,0.9))' }} />}
              </div>
            </div>
            <p className="text-white/20 text-xs mt-2">Best ever: <span className="text-white/35 font-semibold">{longestStreak}d</span></p>
          </div>

          {/* Circular week-progress ring */}
          <div className="flex flex-col items-center gap-1 flex-shrink-0">
            <div className="relative w-20 h-20">
              <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90">
                <circle cx="18" cy="18" r="14" fill="none" stroke="#1e1e1e" strokeWidth="3" />
                <circle cx="18" cy="18" r="14" fill="none"
                  stroke={weekProgress >= 100 ? '#4ade80' : GOLD}
                  strokeWidth="3" strokeLinecap="round"
                  strokeDasharray={`${(weekProgress / 100) * ringCirc} ${ringCirc}`}
                  style={{ transition: 'stroke-dasharray 0.8s ease' }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-white font-black text-base leading-none">{weekContacts}</span>
                <span className="text-white/25 text-[9px] leading-none mt-0.5">/{weekTarget}</span>
              </div>
            </div>
            <p className="text-white/25 text-[10px] font-semibold uppercase tracking-wider">Week</p>
          </div>
        </div>
      </div>

      {/* ── DIARY CTA ─────────────────────────────────────────────────────── */}
      <button onClick={() => navigate('/diary')}
        className="w-full relative overflow-hidden rounded-2xl border border-gold/20 bg-gradient-to-r from-gold/8 via-gold/4 to-transparent p-5 flex items-center gap-4 hover:border-gold/35 hover:from-gold/14 transition-all group active:scale-[0.99]">
        <div className="absolute inset-0 bg-gradient-to-r from-gold/0 to-gold/0 group-hover:from-gold/3 transition-all duration-500 pointer-events-none rounded-2xl" />
        <div className="relative">
          <div className="w-12 h-12 rounded-2xl bg-gold/15 border border-gold/25 flex items-center justify-center group-hover:bg-gold/22 transition-colors">
            <Mic size={22} className="text-gold" />
          </div>
          <span className="absolute inset-0 rounded-2xl border border-gold/30 animate-ping opacity-25 group-hover:opacity-50" />
        </div>
        <div className="flex-1 text-left relative z-10">
          <p className="text-white font-black text-base">Log Today's Work</p>
          <p className="text-white/30 text-xs mt-0.5">Voice diary — tap to record entries</p>
        </div>
        <ChevronRight size={18} className="text-gold/30 group-hover:text-gold group-hover:translate-x-1 transition-all flex-shrink-0" />
      </button>

      {/* ── QUICK STAT ROW ────────────────────────────────────────────────── */}
      <div className="rounded-3xl bg-dark-300 border border-dark-100 overflow-hidden">
        <div className="grid grid-cols-3 divide-x divide-dark-100">
          {[
            { label: 'Customers', value: customers.length, color: 'text-white', alert: false },
            { label: 'Overdue',   value: overdueTasks.length, color: overdueTasks.length > 0 ? 'text-red-300' : 'text-white', alert: overdueTasks.length > 0 },
            { label: 'Response',  value: `${latestPerf?.responseRate || 0}%`, color: 'text-white', alert: false },
          ].map(({ label, value, color, alert }) => (
            <div key={label} className={`p-5 text-center relative ${alert ? 'bg-red-500/5' : ''}`}>
              {alert && <div className="absolute top-0 left-0 right-0 h-[2px] bg-red-500" />}
              <p className={`text-3xl font-black leading-none ${color}`}>{value}</p>
              <p className="text-white/20 text-[10px] mt-2 uppercase tracking-widest font-bold">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── TODAY'S TASKS ─────────────────────────────────────────────────── */}
      {(todayTasks.length > 0 || overdueTasks.length > 0) && (
        <div className="rounded-2xl bg-dark-300 border border-dark-100 overflow-hidden">
          <div className="h-[2px] bg-gradient-to-r from-gold/60 to-transparent" />
          <div className="flex items-center justify-between px-5 py-4 border-b border-dark-100/50">
            <div>
              <p className="text-white/20 text-[10px] uppercase tracking-[0.18em] font-bold">Queue</p>
              <p className="text-lg font-black text-white mt-0.5">Today's Tasks</p>
            </div>
            <button onClick={() => navigate('/tasks')} className="text-white/20 text-xs hover:text-gold transition-colors flex items-center gap-1 font-semibold">
              All <ChevronRight size={12} />
            </button>
          </div>
          <div className="p-4 space-y-2">
            {[...overdueTasks.slice(0, 2), ...todayTasks.slice(0, 3)].map(t => (
              <div key={t.id} className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all ${t.dueDate < today ? 'bg-red-500/5 border-red-500/12' : 'bg-dark-200 border-dark-100'}`}>
                <button onClick={() => handleCompleteTask(t.id)} className="w-5 h-5 rounded-full border-2 border-gold/30 hover:border-gold hover:bg-gold/12 flex items-center justify-center flex-shrink-0 transition-all group">
                  <CheckCircle size={10} className="text-gold opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-semibold truncate">{t.title}</p>
                  {t.customerName && <p className="text-white/25 text-[10px]">{t.customerName}</p>}
                </div>
                {t.dueDate < today && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 flex-shrink-0">Overdue</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── CUSTOMER QUEUE ────────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-dark-300 border border-dark-100 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-100/50">
          <div>
            <p className="text-white/20 text-[10px] uppercase tracking-[0.18em] font-bold">Priority</p>
            <p className="text-lg font-black text-white mt-0.5">Customer Queue <Zap size={14} className="inline text-gold" /></p>
          </div>
          <button onClick={() => navigate('/customers')} className="text-white/20 text-xs hover:text-gold transition-colors flex items-center gap-1 font-semibold">
            All <ChevronRight size={12} />
          </button>
        </div>
        {sortedCustomers.length === 0 ? (
          <div className="flex flex-col items-center py-10 gap-2">
            <Users size={28} className="text-white/10" />
            <p className="text-white/20 text-sm">No customers assigned yet</p>
          </div>
        ) : (
          <div className="divide-y divide-dark-100/40">
            {sortedCustomers.slice(0, 6).map((c, i) => {
              const days = c.lastContact ? Math.round((Date.now() - new Date(c.lastContact).getTime()) / 86400000) : null;
              const isOverdue = days !== null && days > 7;
              return (
                <div key={c.id} onClick={() => navigate('/customers')}
                  className={`flex items-center gap-4 px-5 py-3.5 cursor-pointer transition-colors hover:bg-white/[0.02] ${isOverdue ? 'bg-red-500/3' : ''}`}>
                  {/* Index dot */}
                  <span className="text-white/15 text-[11px] font-black w-4 flex-shrink-0 text-right">{i + 1}</span>
                  {/* Avatar */}
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${isOverdue ? 'bg-red-500/12 border border-red-500/18' : 'bg-dark-200 border border-dark-100'}`}>
                    <span className={`text-xs font-black ${isOverdue ? 'text-red-300' : 'text-white/45'}`}>{c.name[0]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-semibold truncate">{c.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: PIPELINE_COLORS[c.status] || '#555' }} />
                      <span className="text-white/25 text-[10px] capitalize">{c.status}</span>
                    </div>
                  </div>
                  <div className={`text-right flex-shrink-0 text-xs font-bold ${isOverdue ? 'text-red-400' : days === 0 ? 'text-green-400' : 'text-white/25'}`}>
                    {days === null ? 'Never' : days === 0 ? 'Today' : `${days}d ago`}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
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
        <p className="text-white/20 text-[11px] uppercase tracking-[0.22em] font-bold mb-1">{today}</p>
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
