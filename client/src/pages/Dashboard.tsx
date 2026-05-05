import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import {
  TrendingUp, Users, UserCheck, AlertTriangle,
  CheckCircle, Clock, ChevronRight, Phone, Calendar,
  MessageSquare, Mail, Target, Zap, Trophy, AlertCircle,
  Award, Plus, X, Star, TrendingDown, Flame, Mic,
} from 'lucide-react';
import { staffAPI, customersAPI, aiAPI, tasksAPI, meritsAPI, broadcastAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useSSE } from '../hooks/useSSE';
import type { Staff, Customer, Performance, DashboardSummary, Task, MeritSummary, MeritGoal } from '../types';

// ── Notification beep (Web Audio API — no external file needed) ───────────────
function playNotifBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx  = new AudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  } catch { /* audio not available */ }
}

interface BroadcastMsg { id: string; message: string; sentBy: string; sentAt: string; }

function getBcastReadSet(userId: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(`kk_bcast_read_${userId}`) || '[]')); }
  catch { return new Set(); }
}
function markBcastRead(userId: string, ids: string[]) {
  const s = getBcastReadSet(userId);
  ids.forEach(id => s.add(id));
  localStorage.setItem(`kk_bcast_read_${userId}`, JSON.stringify([...s]));
}

const GOLD = '#D4AF37';
const DIM  = '#2A2A2A';

const PIPELINE_COLORS: Record<string, string> = {
  lead: '#666',  contacted: '#60a5fa', interested: '#D4AF37',
  negotiating: '#f97316', closed: '#4ade80', churned: '#f87171',
};

function StatCard({ label, value, sub, icon: Icon, accent = false, alert = false, onClick }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; accent?: boolean; alert?: boolean; onClick?: () => void;
}) {
  return (
    <div
      className={`stat-card ${alert ? 'border-red-500/30' : ''} ${onClick ? 'cursor-pointer hover:border-gold/30 transition-colors' : ''}`}
      onClick={onClick}
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
        alert ? 'bg-red-500/10 border border-red-500/20' :
        accent ? 'bg-gold/15 border border-gold/25' : 'bg-dark-200 border border-dark-50'
      }`}>
        <Icon size={16} className={alert ? 'text-red-400' : accent ? 'text-gold' : 'text-white/40'} />
      </div>
      <div className="mt-3">
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className="text-white/40 text-xs mt-0.5">{label}</p>
        {sub && <p className="text-white/25 text-[10px] mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

const ChartTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number; dataKey: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-dark-200 border border-dark-50 rounded-xl p-3 text-xs shadow-xl">
      <p className="text-white/50 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-white font-semibold">
          {p.dataKey === 'responseRate' ? `${p.value}%` : p.value}
        </p>
      ))}
    </div>
  );
};

// ─── Admin Dashboard ──────────────────────────────────────────────────────────
function AdminDashboard() {
  const [staff, setStaff]             = useState<Staff[]>([]);
  const [performance, setPerf]        = useState<Performance[]>([]);
  const [summary, setSummary]         = useState<DashboardSummary | null>(null);
  const [meritSummary, setMeritSum]   = useState<MeritSummary[]>([]);
  const [meritGoals, setMeritGoals]   = useState<MeritGoal[]>([]);
  const [allTasks, setAllTasks]       = useState<Task[]>([]);
  const [loading, setLoading]         = useState(true);
  const [customers, setCustomers]     = useState<Customer[]>([]);
  const [goalModal, setGoalModal]     = useState(false);
  const [gStaffId, setGStaffId]       = useState('');
  const [gTarget, setGTarget]         = useState('');
  const [gPeriod, setGPeriod]         = useState<'weekly' | 'monthly'>('monthly');
  const [gReward, setGReward]         = useState('');
  const [savingGoal, setSavingGoal]   = useState(false);
  const [awardModal, setAwardModal]   = useState(false);
  const [aStaffId, setAStaffId]       = useState('');
  const [aPoints, setAPoints]         = useState('');
  const [aReason, setAReason]         = useState('');
  const [savingAward, setSavingAward] = useState(false);
  const [expandedBanner, setExpandedBanner] = useState<'customers' | 'tasks' | null>(null);
  const navigate = useNavigate();

  const loadData = useCallback(async () => {
    try {
      const [s, sum, ms, mg, tasks] = await Promise.all([
        staffAPI.list().catch(() => [] as Staff[]),
        aiAPI.dashboardSummary().catch(() => null),
        meritsAPI.summary().then(r => Array.isArray(r) ? r : []).catch(() => [] as MeritSummary[]),
        meritsAPI.goals().then(r => Array.isArray(r) ? r : []).catch(() => [] as MeritGoal[]),
        tasksAPI.list().catch(() => [] as Task[]),
      ]);
      setStaff(s);
      setSummary(sum);
      setMeritSum(ms);
      setMeritGoals(mg);
      setAllTasks(tasks);
      if (s.length > 0) {
        const allPerf = await Promise.all(
          s.map((st: Staff) => staffAPI.getPerformance(st.id).catch(() => []))
        );
        setPerf(allPerf.flat());
      }
    } catch {
      // Non-fatal
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Computed chart data ────────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];

  const weeklyData = (() => {
    const weeks = [...new Set(performance.map(p => p.week))].sort().slice(-7);
    return weeks.map(week => {
      const wp = performance.filter(p => p.week === week);
      return {
        week: `W${week.split('-W')[1]}`,
        contacts: wp.reduce((s, p) => s + (p.customersContacted || 0), 0),
        responseRate: wp.length
          ? Math.round(wp.reduce((s, p) => s + (p.responseRate || 0), 0) / wp.length) : 0,
      };
    });
  })();

  const staffPerfData = staff.map(s => {
    const latest = performance.filter(p => p.staffId === s.id).sort((a, b) => b.week.localeCompare(a.week))[0];
    return {
      name: s.name.split(' ')[0],
      responseRate: latest?.responseRate || 0,
      contacts: latest?.customersContacted || 0,
    };
  });

  const meritChartData = meritSummary.map(m => ({
    name: m.name.split(' ')[0],
    allTime: m.total,
    thisWeek: m.weekPts,
  }));

  const taskRateData = staff.map(s => {
    const staffTasks = allTasks.filter(t => t.staffId === s.id);
    const completed = staffTasks.filter(t => t.completed).length;
    const total = staffTasks.length;
    const ms = meritSummary.find(m => m.staffId === s.id);
    return {
      name: s.name.split(' ')[0],
      taskRate: total > 0 ? Math.round((completed / total) * 100) : 0,
      conversions: Math.max(0, Math.floor((ms?.breakdown.conversion || 0) / 5)),
    };
  });

  const overdueTasks = allTasks
    .filter(t => !t.completed && t.dueDate < today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  // Red alert groups
  const inactiveStaff = staff.filter(s => {
    const last = s.streakData?.lastActivityDate;
    if (!last) return true;
    const daysSince = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
    return daysSince >= 7;
  });

  const negativeStaff = meritSummary.filter(m => m.total < 0);

  const overdueHeavy = staff
    .map(s => ({
      ...s,
      overdueCount: allTasks.filter(t => t.staffId === s.id && !t.completed && t.dueDate < today).length,
    }))
    .filter(s => s.overdueCount >= 3);

  // ── Goal handlers ──────────────────────────────────────────────────────────
  const handleSaveGoal = async () => {
    if (!gStaffId || !gTarget) return;
    setSavingGoal(true);
    try {
      await meritsAPI.createGoal({ staffId: gStaffId, targetPoints: parseInt(gTarget), period: gPeriod, reward: gReward });
      const goals = await meritsAPI.goals();
      setMeritGoals(goals);
      setGoalModal(false);
      setGStaffId(''); setGTarget(''); setGPeriod('monthly'); setGReward('');
    } finally {
      setSavingGoal(false);
    }
  };

  const handleDeleteGoal = async (id: string) => {
    await meritsAPI.deleteGoal(id);
    setMeritGoals(prev => prev.filter(g => g.id !== id));
  };

  const handleAward = async () => {
    if (!aStaffId || !aPoints || !aReason) return;
    setSavingAward(true);
    try {
      await meritsAPI.award({ staffId: aStaffId, points: parseInt(aPoints), reason: aReason });
      const ms = await meritsAPI.summary();
      setMeritSum(ms);
      setAwardModal(false);
      setAStaffId(''); setAPoints(''); setAReason('');
    } finally {
      setSavingAward(false);
    }
  };

  if (loading) return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array(4).fill(0).map((_, i) => <div key={i} className="card h-28 shimmer" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card h-52 shimmer" /><div className="card h-52 shimmer" />
      </div>
    </div>
  );

  const totalRedAlerts = inactiveStaff.length + negativeStaff.length + overdueHeavy.length;

  return (
    <div className="space-y-6">
      {/* ── Alert banners ─────────────────────────────────────────────────── */}
      {(summary?.overdueCount ?? 0) > 0 && (
        <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 animate-fade-in">
          <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />
          <p className="text-red-300 text-sm">
            <span className="font-semibold">{summary!.overdueCount} customers</span> haven't been contacted in 7+ days.
          </p>
          <button onClick={() => navigate('/customers')} className="ml-auto text-red-400 text-xs hover:text-red-300 flex items-center gap-1 flex-shrink-0">
            View <ChevronRight size={12} />
          </button>
        </div>
      )}
      {(summary?.dueTasksCount ?? 0) > 0 && (
        <div className="flex items-center gap-3 bg-gold/10 border border-gold/20 rounded-xl px-4 py-3 animate-fade-in">
          <Clock size={16} className="text-gold flex-shrink-0" />
          <p className="text-gold/80 text-sm">
            <span className="font-semibold">{summary!.dueTasksCount} tasks</span> are due today or overdue.
          </p>
          <button onClick={() => navigate('/tasks')} className="ml-auto text-gold text-xs hover:text-gold-400 flex items-center gap-1 flex-shrink-0">
            View <ChevronRight size={12} />
          </button>
        </div>
      )}

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Total Staff"      value={summary?.totalStaff ?? 0}     icon={Users}       accent onClick={() => navigate('/staff')} />
        <StatCard label="Active Customers" value={summary?.activeCustomers ?? 0} icon={UserCheck}   accent onClick={() => navigate('/customers')} />
        <StatCard
          label="Red Alerts"
          value={totalRedAlerts}
          sub={totalRedAlerts > 0 ? 'Needs attention' : 'All clear'}
          icon={AlertCircle}
          alert={totalRedAlerts > 0}
          onClick={() => navigate('/followup')}
        />
      </div>

      {/* ── Merit Points chart ─────────────────────────────────────────────── */}
      {meritChartData.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-1">
            <div>
              <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                <Trophy size={14} className="text-gold" /> Merit Points
              </h3>
              <p className="text-white/30 text-xs mt-0.5">All-time vs this week per staff member</p>
            </div>
            <button
              onClick={() => setAwardModal(true)}
              className="flex items-center gap-1.5 text-xs bg-gold/10 border border-gold/20 text-gold px-3 py-1.5 rounded-lg hover:bg-gold/20 transition-colors"
            >
              <Award size={12} /> Award Points
            </button>
          </div>
          <div className="mt-4">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={meritChartData} barGap={4} barCategoryGap="30%">
                <CartesianGrid vertical={false} stroke={DIM} />
                <XAxis dataKey="name" tick={{ fill: '#555', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#555', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="bg-dark-200 border border-dark-50 rounded-xl p-3 text-xs shadow-xl">
                        <p className="text-white/50 mb-1">{label}</p>
                        {payload.map((p, i) => (
                          <p key={i} style={{ color: p.fill as string }} className="font-semibold">
                            {p.dataKey === 'allTime' ? 'All-time' : 'This week'}: {p.value} pts
                          </p>
                        ))}
                      </div>
                    );
                  }}
                  cursor={{ fill: 'rgba(212,175,55,0.04)' }}
                />
                <Bar dataKey="allTime" radius={[4, 4, 0, 0]}>
                  {meritChartData.map((entry, i) => (
                    <Cell key={i} fill={entry.allTime >= 0 ? GOLD : '#f87171'} fillOpacity={0.85} />
                  ))}
                </Bar>
                <Bar dataKey="thisWeek" radius={[4, 4, 0, 0]}>
                  {meritChartData.map((entry, i) => (
                    <Cell key={i} fill={entry.thisWeek >= 0 ? '#a78bfa' : '#fb923c'} fillOpacity={0.7} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-4 mt-2 justify-end">
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-gold/85" /><span className="text-white/30 text-[10px]">All-time</span></div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-purple-400/70" /><span className="text-white/30 text-[10px]">This week</span></div>
            </div>
          </div>
        </div>
      )}

      {/* ── Task Rate & Conversions chart ─────────────────────────────────── */}
      <div className="card">
        <h3 className="text-white font-semibold text-sm mb-1 flex items-center gap-2">
          <TrendingUp size={14} className="text-gold" /> Task Rate & Conversions
        </h3>
        <p className="text-white/30 text-xs mb-4">% tasks completed · closures per staff</p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={taskRateData} barGap={4} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke={DIM} />
            <XAxis dataKey="name" tick={{ fill: '#555', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#555', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="bg-dark-200 border border-dark-50 rounded-xl p-3 text-xs shadow-xl">
                    <p className="text-white/50 mb-1">{label}</p>
                    {payload.map((p, i) => (
                      <p key={i} style={{ color: p.fill as string }} className="font-semibold">
                        {p.dataKey === 'taskRate' ? `Task completion: ${p.value}%` : `Conversions: ${p.value}`}
                      </p>
                    ))}
                  </div>
                );
              }}
              cursor={{ fill: 'rgba(212,175,55,0.04)' }}
            />
            <Bar dataKey="taskRate" fill="#60a5fa" fillOpacity={0.8} radius={[4, 4, 0, 0]} />
            <Bar dataKey="conversions" fill={GOLD} fillOpacity={0.85} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-4 mt-2 justify-end">
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-blue-400/80" /><span className="text-white/30 text-[10px]">Task Rate %</span></div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-gold/85" /><span className="text-white/30 text-[10px]">Conversions</span></div>
        </div>
      </div>

      {/* ── Red Alert section ─────────────────────────────────────────────── */}
      {totalRedAlerts > 0 && (
        <div className="card border-red-500/20">
          <h3 className="text-red-400 font-semibold text-sm mb-4 flex items-center gap-2">
            <AlertTriangle size={14} /> Red Alert Zone
            <span className="ml-1 text-[10px] bg-red-500/20 text-red-300 rounded-full px-2 py-0.5">{totalRedAlerts} issue{totalRedAlerts !== 1 ? 's' : ''}</span>
          </h3>
          <div className="space-y-4">
            {inactiveStaff.length > 0 && (
              <div>
                <p className="text-white/40 text-xs font-medium mb-2 flex items-center gap-1.5">
                  <Clock size={11} className="text-red-400" /> Inactive 7+ days
                </p>
                <div className="flex flex-wrap gap-2">
                  {inactiveStaff.map(s => (
                    <span key={s.id} className="inline-flex items-center gap-1.5 bg-red-500/10 border border-red-500/20 text-red-300 text-xs px-3 py-1.5 rounded-lg cursor-pointer hover:bg-red-500/20 transition-colors"
                      onClick={() => navigate(`/staff/${s.id}`)}>
                      <span className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center text-[10px] font-bold">{s.avatar}</span>
                      {s.name.split(' ')[0]}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {negativeStaff.length > 0 && (
              <div>
                <p className="text-white/40 text-xs font-medium mb-2 flex items-center gap-1.5">
                  <TrendingDown size={11} className="text-red-400" /> Negative merit balance
                </p>
                <div className="flex flex-wrap gap-2">
                  {negativeStaff.map(m => (
                    <span key={m.staffId} className="inline-flex items-center gap-1.5 bg-red-500/10 border border-red-500/20 text-red-300 text-xs px-3 py-1.5 rounded-lg">
                      <span className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center text-[10px] font-bold">{m.avatar}</span>
                      {m.name.split(' ')[0]}
                      <span className="text-red-400/70 font-semibold">{m.total} pts</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {overdueHeavy.length > 0 && (
              <div>
                <p className="text-white/40 text-xs font-medium mb-2 flex items-center gap-1.5">
                  <AlertCircle size={11} className="text-red-400" /> 3+ overdue tasks
                </p>
                <div className="flex flex-wrap gap-2">
                  {overdueHeavy.map(s => (
                    <span key={s.id} className="inline-flex items-center gap-1.5 bg-red-500/10 border border-red-500/20 text-red-300 text-xs px-3 py-1.5 rounded-lg cursor-pointer hover:bg-red-500/20 transition-colors"
                      onClick={() => navigate('/tasks')}>
                      <span className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center text-[10px] font-bold">{s.avatar}</span>
                      {s.name.split(' ')[0]}
                      <span className="text-red-400/70 font-semibold">{s.overdueCount} overdue</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Overdue Tasks list ────────────────────────────────────────────── */}
      {overdueTasks.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold text-sm flex items-center gap-2">
              <Clock size={14} className="text-red-400" /> Overdue Tasks
              <span className="text-[10px] bg-red-500/20 text-red-300 rounded-full px-2 py-0.5">{overdueTasks.length}</span>
            </h3>
            <button onClick={() => navigate('/tasks')} className="text-gold/60 text-xs hover:text-gold flex items-center gap-1 transition-colors">
              All tasks <ChevronRight size={12} />
            </button>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {overdueTasks.slice(0, 20).map(t => {
              const daysOverdue = Math.ceil((Date.now() - new Date(t.dueDate).getTime()) / 86400000);
              const staffMember = staff.find(s => s.id === t.staffId);
              return (
                <div key={t.id} className="flex items-center gap-3 p-3 rounded-xl bg-red-500/5 border border-red-500/15">
                  <div className="w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-red-300 text-[10px] font-bold">{staffMember?.avatar ?? '?'}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-medium truncate">{t.title}</p>
                    <p className="text-white/30 text-[10px]">
                      {staffMember?.name?.split(' ')[0] ?? 'Unknown'}
                      {t.customerName ? ` · ${t.customerName}` : ''}
                    </p>
                  </div>
                  <span className="badge badge-red text-[10px] flex-shrink-0 whitespace-nowrap">
                    {daysOverdue}d overdue
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Weekly Contacts + Response Rate ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-white font-semibold text-sm mb-1">Weekly Contacts</h3>
          <p className="text-white/30 text-xs mb-4">Total customer contacts across team</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={weeklyData} barSize={24}>
              <CartesianGrid vertical={false} stroke={DIM} />
              <XAxis dataKey="week" tick={{ fill: '#555', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#555', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(212,175,55,0.05)' }} />
              <Bar dataKey="contacts" radius={[4, 4, 0, 0]}>
                {weeklyData.map((_, i) => (
                  <Cell key={i} fill={i === weeklyData.length - 1 ? GOLD : '#2A2A2A'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <h3 className="text-white font-semibold text-sm mb-1">Response Rate Trend</h3>
          <p className="text-white/30 text-xs mb-4">% of customers who responded</p>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={weeklyData}>
              <defs>
                <linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={GOLD} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={GOLD} stopOpacity={0}   />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={DIM} />
              <XAxis dataKey="week" tick={{ fill: '#555', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: '#555', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="responseRate" stroke={GOLD} strokeWidth={2}
                fill="url(#goldGrad)" dot={{ fill: GOLD, r: 3, strokeWidth: 0 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Team Performance table ─────────────────────────────────────────── */}
      {staffPerfData.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold text-sm">Team Performance</h3>
            <button onClick={() => navigate('/staff')} className="text-gold/60 text-xs hover:text-gold flex items-center gap-1 transition-colors">
              Manage staff <ChevronRight size={12} />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-50">
                  {['Staff', 'Merit Pts', 'Response Rate', 'Contacts'].map(h => (
                    <th key={h} className="text-left text-white/25 font-medium text-xs py-2 pr-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {staffPerfData.map((s, i) => {
                  const ms = meritSummary.find(m => m.staffId === staff[i]?.id);
                  return (
                    <tr key={i} className="border-b border-dark-50/40 hover:bg-dark-200/40 transition-colors cursor-pointer"
                      onClick={() => navigate(`/staff/${staff[i]?.id}`)}>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-gold/15 border border-gold/25 flex items-center justify-center flex-shrink-0">
                            <span className="text-gold text-[10px] font-bold">{staff[i]?.avatar}</span>
                          </div>
                          <span className="text-white font-medium">{s.name}</span>
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <span className={`text-xs font-semibold ${(ms?.total ?? 0) >= 0 ? 'text-gold' : 'text-red-400'}`}>
                          {(ms?.total ?? 0) >= 0 ? '+' : ''}{ms?.total ?? 0}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 bg-dark-200 rounded-full">
                            <div className="h-full bg-gold rounded-full" style={{ width: `${s.responseRate}%` }} />
                          </div>
                          <span className="text-white/50 text-xs">{s.responseRate}%</span>
                        </div>
                      </td>
                      <td className="py-3 text-white/50 text-xs">{s.contacts}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Merit Goals ───────────────────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2">
            <Star size={14} className="text-gold" /> Merit Goals
          </h3>
          <button
            onClick={() => setGoalModal(true)}
            className="flex items-center gap-1.5 text-xs bg-gold/10 border border-gold/20 text-gold px-3 py-1.5 rounded-lg hover:bg-gold/20 transition-colors"
          >
            <Plus size={12} /> Set Goal
          </button>
        </div>
        {meritGoals.length === 0 ? (
          <p className="text-white/25 text-sm text-center py-6">No goals set yet. Set a point target for your team.</p>
        ) : (
          <div className="space-y-2">
            {meritGoals.map(g => {
              const ms = meritSummary.find(m => m.staffId === g.staffId);
              const current = g.period === 'weekly' ? (ms?.weekPts ?? 0) : (ms?.monthPts ?? 0);
              const progress = Math.min(Math.max(Math.round((current / g.targetPoints) * 100), 0), 100);
              return (
                <div key={g.id} className="flex items-center gap-3 p-3 rounded-xl bg-dark-200 border border-dark-50">
                  <div className="w-7 h-7 rounded-full bg-gold/15 border border-gold/25 flex items-center justify-center flex-shrink-0">
                    <span className="text-gold text-[10px] font-bold">
                      {staff.find(s => s.id === g.staffId)?.avatar ?? g.staffName[0]}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-white text-xs font-medium">{g.staffName.split(' ')[0]}</p>
                      <span className="text-[10px] text-white/30 capitalize">{g.period}</span>
                      {g.reward && <span className="text-[10px] text-gold/60 truncate">🎁 {g.reward}</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-1.5 bg-dark-100 rounded-full">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${progress}%`, background: progress >= 100 ? '#4ade80' : GOLD }}
                        />
                      </div>
                      <span className="text-white/40 text-[10px] whitespace-nowrap">
                        {current}/{g.targetPoints} pts
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteGoal(g.id)}
                    className="text-white/20 hover:text-red-400 transition-colors flex-shrink-0"
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Goal Modal ────────────────────────────────────────────────────── */}
      {goalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-dark-300 border border-dark-50 rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-fade-in">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-semibold flex items-center gap-2"><Star size={16} className="text-gold" /> Set Merit Goal</h3>
              <button onClick={() => setGoalModal(false)} className="text-white/30 hover:text-white transition-colors"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-white/40 text-xs mb-1.5 block">Staff Member</label>
                <select
                  value={gStaffId}
                  onChange={e => setGStaffId(e.target.value)}
                  className="w-full bg-dark-200 border border-dark-50 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50"
                >
                  <option value="">Select staff...</option>
                  {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-white/40 text-xs mb-1.5 block">Target Points</label>
                <input
                  type="number"
                  value={gTarget}
                  onChange={e => setGTarget(e.target.value)}
                  placeholder="e.g. 50"
                  className="w-full bg-dark-200 border border-dark-50 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50 placeholder:text-white/20"
                />
              </div>
              <div>
                <label className="text-white/40 text-xs mb-1.5 block">Period</label>
                <div className="flex gap-2">
                  {(['weekly', 'monthly'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => setGPeriod(p)}
                      className={`flex-1 py-2 rounded-xl text-sm capitalize transition-colors ${
                        gPeriod === p
                          ? 'bg-gold text-black font-semibold'
                          : 'bg-dark-200 border border-dark-50 text-white/40 hover:text-white'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-white/40 text-xs mb-1.5 block">Reward (optional)</label>
                <input
                  type="text"
                  value={gReward}
                  onChange={e => setGReward(e.target.value)}
                  placeholder="e.g. Bonus ₹500, day off..."
                  className="w-full bg-dark-200 border border-dark-50 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50 placeholder:text-white/20"
                />
              </div>
              <button
                onClick={handleSaveGoal}
                disabled={!gStaffId || !gTarget || savingGoal}
                className="w-full bg-gold text-black font-semibold py-2.5 rounded-xl text-sm disabled:opacity-40 hover:bg-gold/90 transition-colors"
              >
                {savingGoal ? 'Saving...' : 'Save Goal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Award Points Modal ────────────────────────────────────────────── */}
      {awardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-dark-300 border border-dark-50 rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-fade-in">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-semibold flex items-center gap-2"><Award size={16} className="text-gold" /> Award / Deduct Points</h3>
              <button onClick={() => setAwardModal(false)} className="text-white/30 hover:text-white transition-colors"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-white/40 text-xs mb-1.5 block">Staff Member</label>
                <select
                  value={aStaffId}
                  onChange={e => setAStaffId(e.target.value)}
                  className="w-full bg-dark-200 border border-dark-50 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50"
                >
                  <option value="">Select staff...</option>
                  {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-white/40 text-xs mb-1.5 block">Points (use negative to deduct)</label>
                <input
                  type="number"
                  value={aPoints}
                  onChange={e => setAPoints(e.target.value)}
                  placeholder="e.g. 10 or -5"
                  className="w-full bg-dark-200 border border-dark-50 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50 placeholder:text-white/20"
                />
              </div>
              <div>
                <label className="text-white/40 text-xs mb-1.5 block">Reason</label>
                <input
                  type="text"
                  value={aReason}
                  onChange={e => setAReason(e.target.value)}
                  placeholder="e.g. Excellent client handling"
                  className="w-full bg-dark-200 border border-dark-50 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50 placeholder:text-white/20"
                />
              </div>
              <button
                onClick={handleAward}
                disabled={!aStaffId || !aPoints || !aReason || savingAward}
                className="w-full bg-gold text-black font-semibold py-2.5 rounded-xl text-sm disabled:opacity-40 hover:bg-gold/90 transition-colors"
              >
                {savingAward ? 'Saving...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Staff Dashboard ──────────────────────────────────────────────────────────
function StaffDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [customers,   setCustomers]   = useState<Customer[]>([]);
  const [tasks,       setTasks]       = useState<Task[]>([]);
  const [performance, setPerf]        = useState<Performance[]>([]);
  const [broadcasts,    setBroadcasts]    = useState<BroadcastMsg[]>([]);
  const [unreadQueue,   setUnreadQueue]   = useState<BroadcastMsg[]>([]); // only unseen ones for modal
  const [bcastModal,    setBcastModal]    = useState(false);
  const [bcastModalIdx, setBcastModalIdx] = useState(0);
  const [loading,       setLoading]       = useState(true);

  // Mark broadcasts as read in localStorage and remove from unread queue
  const dismissBcastModal = () => {
    const ids = unreadQueue.map(b => b.id);
    markBcastRead(user!.id, ids);
    setBcastModal(false);
    setUnreadQueue([]);
  };

  const load = useCallback(async () => {
    const [c, t, p, b] = await Promise.all([
      customersAPI.list(),
      tasksAPI.list({ completed: false }),
      staffAPI.getPerformance(user!.id),
      broadcastAPI.list().catch(() => []),
    ]);
    setCustomers(c);
    setTasks(t);
    setPerf(p.sort((a: Performance, b: Performance) => a.week.localeCompare(b.week)));
    const bList = b as BroadcastMsg[];
    setBroadcasts(bList);
    // Only pop up broadcasts the staff hasn't read yet
    const readSet = getBcastReadSet(user!.id);
    const unread  = bList.filter(br => !readSet.has(br.id));
    if (unread.length > 0) {
      setUnreadQueue(unread);
      setBcastModalIdx(0);
      setBcastModal(true);
      playNotifBeep();
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // ── Live broadcast via SSE — always show new ones immediately ────────────────
  useSSE({
    'admin:broadcast': (msg: unknown) => {
      const newMsg = msg as BroadcastMsg;
      setBroadcasts(prev => [newMsg, ...prev]);
      setUnreadQueue(prev => {
        const updated = [newMsg, ...prev];
        setBcastModalIdx(0);
        setBcastModal(true);
        return updated;
      });
      playNotifBeep();
    },
  });

  const streak      = (user as Staff | null)?.streakData?.currentStreak || 0;
  const longestStreak = (user as Staff | null)?.streakData?.longestStreak || 0;
  const today       = new Date().toISOString().split('T')[0];
  const todayTasks  = tasks.filter(t => t.dueDate === today);
  const overdueTasks = tasks.filter(t => t.dueDate < today);
  const latestPerf  = performance[performance.length - 1];
  const weekTarget  = latestPerf?.targets || 20;
  const weekContacts = latestPerf?.customersContacted || 0;
  const weekProgress = Math.min((weekContacts / weekTarget) * 100, 100);

  // Sort customers: overdue first, then by last contact
  const sortedCustomers = [...customers].sort((a, b) => {
    const da = a.lastContact ? Date.now() - new Date(a.lastContact).getTime() : Infinity;
    const db = b.lastContact ? Date.now() - new Date(b.lastContact).getTime() : Infinity;
    return db - da;
  });

  const TYPE_ICONS: Record<string, React.ElementType> = {
    call: Phone, message: MessageSquare, email: Mail, meeting: Calendar,
  };

  const handleCompleteTask = async (id: string) => {
    await tasksAPI.complete(id);
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  if (loading) return (
    <div className="space-y-4">
      <div className="card h-32 shimmer" />
      <div className="grid grid-cols-2 gap-4">
        <div className="card h-24 shimmer" /><div className="card h-24 shimmer" />
      </div>
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in">

      {/* ── Broadcast modal — only shows unread, marks read on dismiss ──────── */}
      {bcastModal && unreadQueue.length > 0 && (() => {
        const b = unreadQueue[bcastModalIdx];
        if (!b) return null;
        const hasNext = bcastModalIdx < unreadQueue.length - 1;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
            <div className="bg-dark-300 border border-amber-500/40 rounded-2xl shadow-2xl w-full max-w-sm animate-slide-up">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-dark-50">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-amber-500/15 flex items-center justify-center">
                    <MessageSquare size={13} className="text-amber-400" />
                  </div>
                  <p className="text-amber-400 font-semibold text-sm">Announcement</p>
                  {unreadQueue.length > 1 && (
                    <span className="text-white/30 text-xs">({bcastModalIdx + 1}/{unreadQueue.length})</span>
                  )}
                </div>
                <button onClick={dismissBcastModal} className="text-white/30 hover:text-white transition-colors">
                  <X size={16} />
                </button>
              </div>
              <div className="px-5 py-4">
                <p className="text-white text-sm leading-relaxed">{b.message}</p>
                <p className="text-white/30 text-[10px] mt-2.5">
                  {b.sentBy} · {new Date(b.sentAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}
                </p>
              </div>
              <div className="flex items-center gap-2 px-5 py-3.5 border-t border-dark-50">
                {hasNext ? (
                  <>
                    <button onClick={() => setBcastModalIdx(i => i + 1)} className="flex-1 btn-primary text-sm py-2">
                      Next →
                    </button>
                    <button onClick={dismissBcastModal} className="flex-1 text-white/40 hover:text-white text-sm transition-colors">
                      Done
                    </button>
                  </>
                ) : (
                  <button onClick={dismissBcastModal} className="w-full btn-primary text-sm py-2">
                    Got it
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Streak hero */}
      <div className="card bg-gradient-to-br from-dark-300 to-dark-400 border-gold/20 relative overflow-hidden">
        <div className="absolute -right-8 -top-8 w-32 h-32 bg-gold/5 rounded-full" />
        <div className="absolute -right-4 -bottom-4 w-20 h-20 bg-gold/5 rounded-full" />
        <div className="flex items-center justify-between relative z-10">
          <div>
            <p className="text-white/40 text-xs uppercase tracking-widest mb-1">Current Streak</p>
            <div className="flex items-end gap-2">
              <span className="text-5xl font-black text-white">{streak}</span>
              <span className="text-gold text-lg font-bold mb-1">days</span>
              <Flame size={28} className={`mb-1 ${streak > 0 ? 'text-gold' : 'text-white/20'}`} />
            </div>
            <p className="text-white/30 text-xs mt-1">Longest: {longestStreak}d · Log a contact to keep it going</p>
          </div>
          <div className="text-right">
            <div className="bg-dark-200 rounded-2xl p-4 border border-dark-50">
              <p className="text-white/30 text-xs mb-1">Week Progress</p>
              <p className="text-white font-bold text-lg">{weekContacts}<span className="text-white/30 text-sm font-normal">/{weekTarget}</span></p>
              <div className="w-24 h-1.5 bg-dark-100 rounded-full mt-2">
                <div className="h-full bg-gold rounded-full transition-all" style={{ width: `${weekProgress}%` }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Diary mic CTA ───────────────────────────────────────────────────── */}
      <button
        onClick={() => navigate('/diary')}
        className="w-full flex items-center gap-4 p-4 rounded-2xl border border-gold/30 bg-gold/5 hover:bg-gold/10 hover:border-gold/50 transition-all group active:scale-[0.98]"
      >
        <div className="w-12 h-12 rounded-full bg-gold/15 border border-gold/30 flex items-center justify-center flex-shrink-0 group-hover:bg-gold/25 transition-colors">
          <Mic size={22} className="text-gold" />
        </div>
        <div className="text-left flex-1">
          <p className="text-white font-semibold text-sm">Log Today's Work</p>
          <p className="text-white/40 text-xs mt-0.5">Tap to open diary & record voice entries</p>
        </div>
        <ChevronRight size={16} className="text-gold/50 group-hover:text-gold transition-colors flex-shrink-0" />
      </button>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card text-center py-4">
          <p className="text-2xl font-bold text-white">{customers.length}</p>
          <p className="text-white/30 text-xs mt-0.5">Customers</p>
        </div>
        <div className={`card text-center py-4 ${overdueTasks.length > 0 ? 'border-red-500/30' : ''}`}>
          <p className={`text-2xl font-bold ${overdueTasks.length > 0 ? 'text-red-400' : 'text-white'}`}>
            {overdueTasks.length}
          </p>
          <p className="text-white/30 text-xs mt-0.5">Overdue Tasks</p>
        </div>
        <div className="card text-center py-4">
          <p className="text-2xl font-bold text-white">{latestPerf?.responseRate || 0}%</p>
          <p className="text-white/30 text-xs mt-0.5">Response Rate</p>
        </div>
      </div>

      {/* Today's tasks */}
      {(todayTasks.length > 0 || overdueTasks.length > 0) && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-semibold text-sm flex items-center gap-2">
              <Target size={14} className="text-gold" /> Today's Tasks
            </h3>
            <button onClick={() => navigate('/tasks')} className="text-white/30 text-xs hover:text-gold transition-colors flex items-center gap-1">
              All tasks <ChevronRight size={12} />
            </button>
          </div>
          <div className="space-y-2">
            {[...overdueTasks.slice(0, 2), ...todayTasks.slice(0, 3)].map(t => (
              <div key={t.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                t.dueDate < today ? 'bg-red-500/5 border-red-500/15' : 'bg-dark-200 border-dark-50'
              }`}>
                <button
                  onClick={() => handleCompleteTask(t.id)}
                  className="w-5 h-5 rounded-full border-2 border-gold/40 hover:border-gold hover:bg-gold/20 flex items-center justify-center flex-shrink-0 transition-all"
                >
                  <CheckCircle size={10} className="text-gold opacity-0 hover:opacity-100" />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{t.title}</p>
                  {t.customerName && <p className="text-white/30 text-xs">{t.customerName}</p>}
                </div>
                {t.dueDate < today && <span className="badge badge-red text-[10px] flex-shrink-0">Overdue</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Customer queue */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2">
            <Zap size={14} className="text-gold" /> Customer Queue
            <span className="text-white/30 text-xs font-normal">(sorted by urgency)</span>
          </h3>
          <button onClick={() => navigate('/customers')} className="text-white/30 text-xs hover:text-gold transition-colors flex items-center gap-1">
            All <ChevronRight size={12} />
          </button>
        </div>
        {sortedCustomers.length === 0 ? (
          <p className="text-white/25 text-sm py-4 text-center">No customers assigned yet</p>
        ) : (
          <div className="space-y-2">
            {sortedCustomers.slice(0, 6).map(c => {
              const days = c.lastContact
                ? Math.round((Date.now() - new Date(c.lastContact).getTime()) / 86400000)
                : null;
              const isOverdue = days !== null && days > 7;
              return (
                <div
                  key={c.id}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer hover:border-gold/30 transition-all ${
                    isOverdue ? 'border-red-500/20 bg-red-500/5' : 'border-dark-50 bg-dark-200'
                  }`}
                  onClick={() => navigate('/customers')}
                >
                  <div className="w-8 h-8 rounded-full bg-dark-100 flex items-center justify-center flex-shrink-0 border border-dark-50">
                    <span className="text-white/50 text-xs font-bold">{c.name[0]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{c.name}</p>
                    <p className="text-white/30 text-xs">{c.phone}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: PIPELINE_COLORS[c.status] || '#666' }}
                      />
                      <span className="text-white/30 text-[10px] capitalize">{c.status}</span>
                    </div>
                    <p className={`text-[10px] mt-0.5 ${isOverdue ? 'text-red-400' : days === 0 ? 'text-green-400' : 'text-white/25'}`}>
                      {days === null ? 'Never' : days === 0 ? 'Today' : `${days}d ago`}
                    </p>
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

// ─── Main export ──────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user, isAdmin } = useAuth();
  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">
          {isAdmin ? 'Dashboard' : 'My Dashboard'}
          {' — '}
          <span className="text-gold">{user?.name?.split(' ')[0]}</span>
        </h1>
        <p className="text-white/30 text-sm mt-1">
          {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>
      {isAdmin ? <AdminDashboard /> : <StaffDashboard />}
    </div>
  );
}
