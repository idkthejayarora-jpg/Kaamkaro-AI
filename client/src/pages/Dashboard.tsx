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
  ShieldAlert, Sparkles,
} from 'lucide-react';
import { staffAPI, customersAPI, aiAPI, tasksAPI, meritsAPI, broadcastAPI, interactionsAPI, fraudAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useSSE } from '../hooks/useSSE';
import type { Staff, Customer, Performance, DashboardSummary, Task, MeritSummary, MeritGoal, Interaction } from '../types';

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

interface FraudAlert {
  id: string; staffId: string; staffName: string;
  type: string; severity: 'high' | 'medium' | 'low';
  title: string; detail: string; evidence: string; detectedAt: string;
}

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
const DIM  = '#1e1e1e';

const PIPELINE_COLORS: Record<string, string> = {
  lead: '#555',  contacted: '#60a5fa', interested: '#D4AF37',
  negotiating: '#f97316', closed: '#4ade80', churned: '#f87171',
};

// ── Reusable section header ───────────────────────────────────────────────────
function SectionHeader({
  icon: Icon, title, subtitle, iconColor = 'text-gold', iconBg = 'bg-gold/10 border-gold/20',
  action,
}: {
  icon: React.ElementType; title: string; subtitle?: string;
  iconColor?: string; iconBg?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-xl border flex items-center justify-center flex-shrink-0 ${iconBg}`}>
          <Icon size={14} className={iconColor} />
        </div>
        <div>
          <h3 className="text-white font-semibold text-sm leading-tight">{title}</h3>
          {subtitle && <p className="text-white/30 text-[11px] mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

// ── Modern StatCard ───────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, icon: Icon, accent = false, alert = false, onClick, className,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; accent?: boolean; alert?: boolean; onClick?: () => void; className?: string;
}) {
  const glowColor = alert ? 'rgba(248,113,113,0.2)' : accent ? 'rgba(212,175,55,0.18)' : 'transparent';
  const borderColor = alert ? 'border-red-500/25' : accent ? 'border-gold/20' : 'border-dark-50';

  return (
    <div
      className={`relative group overflow-hidden rounded-2xl border bg-dark-300 p-5 transition-all duration-300
        ${borderColor} ${onClick ? 'cursor-pointer hover:scale-[1.02] active:scale-[0.99]' : ''} ${className ?? ''}`}
      style={{ boxShadow: `0 0 0 0 ${glowColor}` }}
      onMouseEnter={e => { if (onClick) (e.currentTarget as HTMLElement).style.boxShadow = `0 8px 32px ${glowColor}`; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = `0 0 0 0 ${glowColor}`; }}
      onClick={onClick}
    >
      {/* Subtle gradient overlay */}
      <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none rounded-2xl ${
        alert ? 'bg-gradient-to-br from-red-500/5 to-transparent' :
        accent ? 'bg-gradient-to-br from-gold/5 to-transparent' : 'bg-gradient-to-br from-white/3 to-transparent'
      }`} />

      {/* Icon */}
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-transform duration-300 group-hover:scale-110 ${
        alert ? 'bg-red-500/10 border border-red-500/20' :
        accent ? 'bg-gold/12 border border-gold/25' : 'bg-dark-200 border border-dark-100'
      }`}
        style={alert ? { boxShadow: '0 0 16px rgba(248,113,113,0.25)' } : accent ? { boxShadow: '0 0 16px rgba(212,175,55,0.2)' } : undefined}
      >
        <Icon size={17} className={`${alert ? 'text-red-400' : accent ? 'text-gold' : 'text-white/35'}`} />
      </div>

      {/* Value */}
      <div className="mt-4">
        <p className={`text-3xl font-black tracking-tight ${alert && (value as number) > 0 ? 'text-red-300' : 'text-white'}`}>
          {value}
        </p>
        <p className="text-white/40 text-xs font-medium mt-0.5">{label}</p>
        {sub && (
          <p className={`text-[10px] mt-1 font-medium ${alert && (value as number) > 0 ? 'text-red-400/70' : 'text-white/25'}`}>
            {sub}
          </p>
        )}
      </div>

      {/* Arrow */}
      {onClick && (
        <ChevronRight
          size={14}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white/15 group-hover:text-white/40 group-hover:translate-x-0.5 transition-all duration-200"
        />
      )}
    </div>
  );
}

// ── Animated alert banner ─────────────────────────────────────────────────────
function AlertBanner({
  color, icon: Icon, title, children, onToggle, expanded, count,
}: {
  color: 'red' | 'amber';
  icon: React.ElementType;
  title: React.ReactNode;
  children?: React.ReactNode;
  onToggle?: () => void;
  expanded?: boolean;
  count?: number;
}) {
  const c = color === 'red'
    ? { border: 'border-red-500/20', bg: 'bg-red-500/8', stripe: 'bg-red-500', text: 'text-red-300', hover: 'hover:bg-red-500/12', iconBg: 'bg-red-500/15', iconText: 'text-red-400', badge: 'bg-red-500/20 text-red-300' }
    : { border: 'border-amber-500/20', bg: 'bg-amber-500/8', stripe: 'bg-amber-500', text: 'text-amber-300', hover: 'hover:bg-amber-500/12', iconBg: 'bg-amber-500/15', iconText: 'text-amber-400', badge: 'bg-amber-500/20 text-amber-300' };

  return (
    <div className={`rounded-2xl border overflow-hidden animate-fade-in-up ${c.border} ${c.bg}`}>
      <button
        className={`w-full flex items-center gap-3 px-4 py-3.5 ${onToggle ? c.hover : ''} transition-colors`}
        onClick={onToggle}
      >
        {/* Animated left stripe */}
        <div className={`w-1 h-8 rounded-full flex-shrink-0 ${c.stripe} animate-glow-breathe`} />
        {/* Icon */}
        <div className={`w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 ${c.iconBg}`}>
          <Icon size={13} className={`${c.iconText} ${expanded !== undefined ? '' : 'animate-pulse'}`} />
        </div>
        {/* Text */}
        <p className={`${c.text} text-sm text-left flex-1 font-medium`}>{title}</p>
        {/* Count badge */}
        {count !== undefined && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${c.badge}`}>{count}</span>
        )}
        {/* Expand arrow */}
        {onToggle && (
          <ChevronRight size={14} className={`${c.iconText} flex-shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
        )}
      </button>
      {children}
    </div>
  );
}

const ChartTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number; dataKey: string; fill?: string; name?: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-dark-200 border border-dark-100 rounded-xl p-3 text-xs shadow-2xl">
      <p className="text-white/40 mb-2 font-medium">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="font-semibold" style={{ color: p.fill || 'white' }}>
          {p.name ? `${p.name}: ${p.value}` : p.dataKey === 'responseRate' ? `${p.value}%` : p.value}
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
  const [customers, setCustomers]             = useState<Customer[]>([]);
  const [allInteractions, setAllInteractions] = useState<Interaction[]>([]);
  const [fraudAlerts, setFraudAlerts]         = useState<FraudAlert[]>([]);
  const [fraudExpanded, setFraudExpanded]     = useState(false);
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
      setStaff(s);
      setSummary(sum);
      setMeritSum(ms);
      setMeritGoals(mg);
      setAllTasks(tasks);
      setCustomers(cust as Customer[]);
      setAllInteractions(ints as Interaction[]);
      setFraudAlerts((fraud as { alerts: FraudAlert[] }).alerts || []);
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
    const map: Record<string, { contacts: number; calls: number; messages: number; meetings: number; emails: number }> = {};
    for (const ix of allInteractions) {
      const d  = new Date(ix.createdAt);
      const yr = d.getFullYear();
      const wk = Math.ceil(((d.getTime() - new Date(yr, 0, 1).getTime()) / 86400000 + new Date(yr, 0, 1).getDay() + 1) / 7);
      const key = `${yr}-W${String(wk).padStart(2, '0')}`;
      if (!map[key]) map[key] = { contacts: 0, calls: 0, messages: 0, meetings: 0, emails: 0 };
      map[key].contacts++;
      if      (ix.type === 'call')    map[key].calls++;
      else if (ix.type === 'message') map[key].messages++;
      else if (ix.type === 'meeting') map[key].meetings++;
      else if (ix.type === 'email')   map[key].emails++;
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-7)
      .map(([key, v]) => ({ week: `W${key.split('-W')[1]}`, ...v }));
  })();

  const staffInteractionCounts = allInteractions.reduce((acc, ix) => {
    if (ix.staffId) acc[ix.staffId] = (acc[ix.staffId] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const staffPerfData = staff.map(s => {
    const latest = performance.filter(p => p.staffId === s.id).sort((a, b) => b.week.localeCompare(a.week))[0];
    return {
      name: s.name.split(' ')[0],
      interactions: staffInteractionCounts[s.id] || 0,
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

  const cutoff7 = new Date(Date.now() - 7 * 86400000).toISOString();
  const staleCustomers = customers
    .filter(c => !c.lastContact || c.lastContact < cutoff7)
    .map(c => {
      const assigneeId = (c as Customer & { assignedTo?: string; staffId?: string }).assignedTo
        || (c as Customer & { assignedTo?: string; staffId?: string }).staffId || '';
      return {
        ...c,
        daysSilent: c.lastContact
          ? Math.floor((Date.now() - new Date(c.lastContact).getTime()) / 86400000)
          : 9999,
        assignedStaffName: staff.find(s => s.id === assigneeId)?.name || 'Unassigned',
      };
    })
    .sort((a, b) => b.daysSilent - a.daysSilent);

  const inactiveStaff = staff.filter(s => {
    const last = s.streakData?.lastActivityDate;
    if (!last) return true;
    return Math.floor((Date.now() - new Date(last).getTime()) / 86400000) >= 7;
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
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {Array(3).fill(0).map((_, i) => <div key={i} className="h-32 rounded-2xl shimmer" />)}
      </div>
      <div className="h-64 rounded-2xl shimmer" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-52 rounded-2xl shimmer" /><div className="h-52 rounded-2xl shimmer" />
      </div>
    </div>
  );

  const totalRedAlerts = inactiveStaff.length + negativeStaff.length + overdueHeavy.length;

  return (
    <div className="space-y-5">

      {/* ── Alert banners ─────────────────────────────────────────────────── */}
      {(summary?.overdueCount ?? 0) > 0 && (
        <AlertBanner
          color="red"
          icon={AlertTriangle}
          title={<><span className="font-bold">{summary!.overdueCount} customers</span> haven't been contacted in 7+ days</>}
          onToggle={() => setExpandedBanner(expandedBanner === 'customers' ? null : 'customers')}
          expanded={expandedBanner === 'customers'}
          count={summary!.overdueCount}
        >
          {expandedBanner === 'customers' && (
            <div className="border-t border-red-500/12">
              <div className="max-h-64 overflow-y-auto">
                {staleCustomers.length === 0 ? (
                  <p className="text-red-400 text-xs text-center py-4 opacity-60">No data available</p>
                ) : staleCustomers.slice(0, 20).map(c => {
                  const lastTwo = allInteractions
                    .filter(i => i.customerId === c.id)
                    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                    .slice(0, 2);
                  return (
                    <div
                      key={c.id}
                      className="px-4 py-3 border-b border-red-500/8 last:border-0 cursor-pointer hover:bg-red-500/5 transition-colors"
                      onClick={() => navigate('/customers')}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-red-500/15 flex items-center justify-center flex-shrink-0">
                          <span className="text-red-300 text-xs font-bold">{c.name[0]}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-xs font-semibold truncate">{c.name}</p>
                          <p className="text-red-400/60 text-[10px]">{c.assignedStaffName} · {c.phone}</p>
                        </div>
                        <span className={`text-[10px] font-bold flex-shrink-0 px-2.5 py-1 rounded-full ${
                          c.daysSilent >= 30 ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/15 text-amber-300'
                        }`}>
                          {c.daysSilent >= 9999 ? 'Never' : `${c.daysSilent}d`}
                        </span>
                      </div>
                      {lastTwo.length > 0 ? (
                        <div className="mt-2 ml-11 space-y-1">
                          {lastTwo.map(i => {
                            const daysAgo = Math.round((Date.now() - new Date(i.createdAt).getTime()) / 86400000);
                            return (
                              <div key={i.id} className="flex items-start gap-2">
                                <span className="text-[10px] text-red-400/50 flex-shrink-0 mt-0.5 whitespace-nowrap">
                                  {daysAgo === 0 ? 'Today' : `${daysAgo}d ago`}
                                </span>
                                <p className="text-[11px] text-white/60 leading-snug line-clamp-1">{i.notes || `${i.type} logged`}</p>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="mt-1 ml-11 text-[10px] text-red-400/40 italic">No entries on record</p>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between px-4 py-2.5 border-t border-red-500/10">
                <span className="text-red-400/50 text-[10px]">{staleCustomers.length} customers total</span>
                <button className="text-red-300 text-xs font-semibold hover:text-red-200 flex items-center gap-1 transition-colors" onClick={() => navigate('/customers')}>
                  View all <ChevronRight size={12} />
                </button>
              </div>
            </div>
          )}
        </AlertBanner>
      )}

      {(summary?.dueTasksCount ?? 0) > 0 && (
        <AlertBanner
          color="amber"
          icon={Clock}
          title={<><span className="font-bold">{summary!.dueTasksCount} tasks</span> are due today or overdue</>}
          onToggle={() => setExpandedBanner(expandedBanner === 'tasks' ? null : 'tasks')}
          expanded={expandedBanner === 'tasks'}
          count={summary!.dueTasksCount}
        >
          {expandedBanner === 'tasks' && (
            <div className="border-t border-amber-500/12">
              <div className="max-h-64 overflow-y-auto">
                {overdueTasks.length === 0 ? (
                  <p className="text-amber-400 text-xs text-center py-4 opacity-60">No overdue tasks</p>
                ) : overdueTasks.slice(0, 20).map(t => {
                  const daysOverdue = Math.ceil((Date.now() - new Date(t.dueDate).getTime()) / 86400000);
                  const staffMember = staff.find(s => s.id === t.staffId);
                  return (
                    <div
                      key={t.id}
                      className="flex items-center gap-3 px-4 py-2.5 border-b border-amber-500/8 last:border-0 cursor-pointer hover:bg-amber-500/5 transition-colors"
                      onClick={() => navigate('/tasks')}
                    >
                      <div className="w-7 h-7 rounded-xl bg-amber-500/12 flex items-center justify-center flex-shrink-0">
                        <span className="text-amber-400 text-[10px] font-bold">{staffMember?.avatar ?? '?'}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-xs font-medium truncate">{t.title}</p>
                        <p className="text-amber-400/60 text-[10px]">
                          {staffMember?.name?.split(' ')[0] ?? 'Unknown'}
                          {t.customerName ? ` · ${t.customerName}` : ''}
                        </p>
                      </div>
                      <span className="text-[10px] font-bold flex-shrink-0 px-2.5 py-1 rounded-full bg-red-500/20 text-red-300">
                        {daysOverdue}d over
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between px-4 py-2.5 border-t border-amber-500/10">
                <span className="text-amber-400/50 text-[10px]">{overdueTasks.length} tasks total</span>
                <button className="text-amber-300 text-xs font-semibold hover:text-amber-200 flex items-center gap-1 transition-colors" onClick={() => navigate('/tasks')}>
                  View all <ChevronRight size={12} />
                </button>
              </div>
            </div>
          )}
        </AlertBanner>
      )}

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Total Staff"      value={summary?.totalStaff ?? 0}     icon={Users}       accent onClick={() => navigate('/staff')}       className="animate-fade-in-up stagger-1" />
        <StatCard label="Active Customers" value={summary?.activeCustomers ?? 0} icon={UserCheck}   accent onClick={() => navigate('/customers')}   className="animate-fade-in-up stagger-2" />
        <StatCard
          label="Red Alerts"
          value={totalRedAlerts}
          sub={totalRedAlerts > 0 ? 'Needs attention' : 'All clear ✓'}
          icon={AlertCircle}
          alert={totalRedAlerts > 0}
          onClick={() => navigate('/followup')}
          className="animate-fade-in-up stagger-3 col-span-2 lg:col-span-1"
        />
      </div>

      {/* ── Red Alert Zone ─────────────────────────────────────────────────── */}
      {totalRedAlerts > 0 && (
        <div className="rounded-2xl border border-red-500/20 bg-gradient-to-br from-red-500/6 to-transparent overflow-hidden animate-fade-in-up">
          {/* Header bar */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-red-500/10">
            <div className="w-9 h-9 rounded-xl bg-red-500/15 border border-red-500/25 flex items-center justify-center"
              style={{ boxShadow: '0 0 20px rgba(248,113,113,0.2)' }}>
              <AlertTriangle size={16} className="text-red-400" />
            </div>
            <div className="flex-1">
              <p className="text-red-300 font-bold text-sm">Red Alert Zone</p>
              <p className="text-red-400/50 text-[10px]">Immediate attention required</p>
            </div>
            <span className="text-xs font-black bg-red-500/20 text-red-300 px-3 py-1.5 rounded-full border border-red-500/20">
              {totalRedAlerts} {totalRedAlerts === 1 ? 'issue' : 'issues'}
            </span>
          </div>

          <div className="p-5 space-y-4">
            {inactiveStaff.length > 0 && (
              <div>
                <p className="text-white/35 text-[11px] font-semibold mb-2.5 flex items-center gap-1.5 uppercase tracking-wider">
                  <Clock size={10} className="text-red-400" /> Inactive 7+ days
                </p>
                <div className="flex flex-wrap gap-2">
                  {inactiveStaff.map(s => (
                    <button key={s.id}
                      className="inline-flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-300 text-xs px-3 py-2 rounded-xl cursor-pointer hover:bg-red-500/20 hover:border-red-500/30 transition-all"
                      onClick={() => navigate(`/staff/${s.id}`)}>
                      <span className="w-5 h-5 rounded-lg bg-red-500/20 flex items-center justify-center text-[9px] font-black">{s.avatar}</span>
                      {s.name.split(' ')[0]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {negativeStaff.length > 0 && (
              <div>
                <p className="text-white/35 text-[11px] font-semibold mb-2.5 flex items-center gap-1.5 uppercase tracking-wider">
                  <TrendingDown size={10} className="text-red-400" /> Negative merit balance
                </p>
                <div className="flex flex-wrap gap-2">
                  {negativeStaff.map(m => (
                    <span key={m.staffId} className="inline-flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-300 text-xs px-3 py-2 rounded-xl">
                      <span className="w-5 h-5 rounded-lg bg-red-500/20 flex items-center justify-center text-[9px] font-black">{m.avatar}</span>
                      {m.name.split(' ')[0]}
                      <span className="text-red-400/70 font-bold">{m.total} pts</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {overdueHeavy.length > 0 && (
              <div>
                <p className="text-white/35 text-[11px] font-semibold mb-2.5 flex items-center gap-1.5 uppercase tracking-wider">
                  <AlertCircle size={10} className="text-red-400" /> 3+ overdue tasks
                </p>
                <div className="flex flex-wrap gap-2">
                  {overdueHeavy.map(s => (
                    <button key={s.id}
                      className="inline-flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-300 text-xs px-3 py-2 rounded-xl cursor-pointer hover:bg-red-500/20 hover:border-red-500/30 transition-all"
                      onClick={() => navigate('/tasks')}>
                      <span className="w-5 h-5 rounded-lg bg-red-500/20 flex items-center justify-center text-[9px] font-black">{s.avatar}</span>
                      {s.name.split(' ')[0]}
                      <span className="text-red-400/70 font-bold">{s.overdueCount}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Merit Points chart ─────────────────────────────────────────────── */}
      {meritChartData.length > 0 && (
        <div className="card animate-fade-in-up stagger-4">
          <SectionHeader
            icon={Trophy}
            title="Merit Points"
            subtitle="All-time vs this week per staff member"
            action={
              <button
                onClick={() => setAwardModal(true)}
                className="flex items-center gap-1.5 text-xs bg-gold/10 border border-gold/20 text-gold px-3 py-1.5 rounded-xl hover:bg-gold/20 transition-colors font-medium"
              >
                <Award size={12} /> Award Points
              </button>
            }
          />
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={meritChartData} barGap={4} barCategoryGap="30%">
              <CartesianGrid vertical={false} stroke={DIM} />
              <XAxis dataKey="name" tick={{ fill: '#444', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#444', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="bg-dark-200 border border-dark-100 rounded-xl p-3 text-xs shadow-xl">
                      <p className="text-white/40 mb-1.5 font-medium">{label}</p>
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
              <Bar dataKey="allTime" radius={[5, 5, 0, 0]}>
                {meritChartData.map((entry, i) => (
                  <Cell key={i} fill={entry.allTime >= 0 ? GOLD : '#f87171'} fillOpacity={0.9} />
                ))}
              </Bar>
              <Bar dataKey="thisWeek" radius={[5, 5, 0, 0]}>
                {meritChartData.map((entry, i) => (
                  <Cell key={i} fill={entry.thisWeek >= 0 ? '#a78bfa' : '#fb923c'} fillOpacity={0.75} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-2 justify-end">
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ background: GOLD }} /><span className="text-white/30 text-[10px]">All-time</span></div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-purple-400/70" /><span className="text-white/30 text-[10px]">This week</span></div>
          </div>
        </div>
      )}

      {/* ── Charts row ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Task Rate & Conversions */}
        <div className="card">
          <SectionHeader icon={TrendingUp} title="Task Rate & Conversions" subtitle="% completed · closures per staff" />
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={taskRateData} barGap={4} barCategoryGap="30%">
              <CartesianGrid vertical={false} stroke={DIM} />
              <XAxis dataKey="name" tick={{ fill: '#444', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#444', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="bg-dark-200 border border-dark-100 rounded-xl p-3 text-xs shadow-xl">
                      <p className="text-white/40 mb-1.5 font-medium">{label}</p>
                      {payload.map((p, i) => (
                        <p key={i} style={{ color: p.fill as string }} className="font-semibold">
                          {p.dataKey === 'taskRate' ? `Completion: ${p.value}%` : `Conversions: ${p.value}`}
                        </p>
                      ))}
                    </div>
                  );
                }}
                cursor={{ fill: 'rgba(212,175,55,0.04)' }}
              />
              <Bar dataKey="taskRate" fill="#60a5fa" fillOpacity={0.85} radius={[5, 5, 0, 0]} />
              <Bar dataKey="conversions" fill={GOLD} fillOpacity={0.9} radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-2 justify-end">
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-blue-400/80" /><span className="text-white/30 text-[10px]">Task Rate %</span></div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ background: GOLD }} /><span className="text-white/30 text-[10px]">Conversions</span></div>
          </div>
        </div>

        {/* Contact Breakdown */}
        <div className="card">
          <SectionHeader icon={Zap} title="Contact Breakdown" subtitle="How the team reaches customers each week" />
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={weeklyData} barSize={14} barGap={2}>
              <CartesianGrid vertical={false} stroke={DIM} />
              <XAxis dataKey="week" tick={{ fill: '#444', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#444', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="bg-dark-200 border border-dark-100 rounded-xl p-3 text-xs shadow-xl space-y-1">
                      <p className="text-white/40 mb-1 font-medium">{label}</p>
                      {payload.map((p, i) => (Number(p.value) > 0) && (
                        <p key={i} style={{ color: p.fill as string }}>{p.name}: <strong>{p.value}</strong></p>
                      ))}
                    </div>
                  );
                }}
                cursor={{ fill: 'rgba(255,255,255,0.02)' }}
              />
              <Bar dataKey="calls"    stackId="a" fill="#60a5fa" name="Calls"    radius={[0,0,0,0]} />
              <Bar dataKey="messages" stackId="a" fill="#c084fc" name="Messages" radius={[0,0,0,0]} />
              <Bar dataKey="meetings" stackId="a" fill={GOLD}    name="Meetings" radius={[0,0,0,0]} />
              <Bar dataKey="emails"   stackId="a" fill="#34d399" name="Emails"   radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-1 flex-wrap">
            {[['Calls','#60a5fa'],['Messages','#c084fc'],['Meetings',GOLD],['Emails','#34d399']].map(([l,c]) => (
              <div key={l} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ background: c }} />
                <span className="text-white/30 text-[10px]">{l}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Weekly Contacts area chart ─────────────────────────────────────── */}
      <div className="card">
        <SectionHeader
          icon={TrendingUp}
          title="Weekly Contacts"
          subtitle="Total customer contacts across team"
          action={
            <button onClick={() => navigate('/staff')} className="text-gold/50 text-xs hover:text-gold flex items-center gap-1 transition-colors font-medium">
              Staff <ChevronRight size={12} />
            </button>
          }
        />
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={weeklyData} barSize={28}>
            <CartesianGrid vertical={false} stroke={DIM} />
            <XAxis dataKey="week" tick={{ fill: '#444', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#444', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(212,175,55,0.05)' }} />
            <Bar dataKey="contacts" radius={[6, 6, 0, 0]}>
              {weeklyData.map((_, i) => (
                <Cell key={i} fill={i === weeklyData.length - 1 ? GOLD : '#2a2a2a'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Anti-Fraud Alerts ─────────────────────────────────────────────── */}
      {fraudAlerts.length > 0 && (
        <div className="card border-orange-500/20 bg-gradient-to-br from-orange-500/5 to-transparent">
          <button className="w-full flex items-center justify-between" onClick={() => setFraudExpanded(e => !e)}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-orange-500/12 border border-orange-500/25 flex items-center justify-center"
                style={{ boxShadow: '0 0 16px rgba(249,115,22,0.15)' }}>
                <ShieldAlert size={16} className="text-orange-400" />
              </div>
              <div className="text-left">
                <div className="flex items-center gap-2">
                  <p className="text-orange-300 font-bold text-sm">Anti-Fraud Alerts</p>
                  <span className="text-[10px] font-bold bg-orange-500/20 text-orange-300 rounded-full px-2 py-0.5">{fraudAlerts.length}</span>
                  {fraudAlerts.some(a => a.severity === 'high') && (
                    <span className="text-[10px] font-bold bg-red-500/20 text-red-300 rounded-full px-2 py-0.5">
                      {fraudAlerts.filter(a => a.severity === 'high').length} HIGH
                    </span>
                  )}
                </div>
                <p className="text-white/35 text-[11px] mt-0.5">Suspicious patterns — review before acting</p>
              </div>
            </div>
            <ChevronRight size={14} className={`text-orange-400 transition-transform duration-200 flex-shrink-0 ${fraudExpanded ? 'rotate-90' : ''}`} />
          </button>

          {fraudExpanded && (
            <div className="mt-4 space-y-2.5">
              {fraudAlerts.map(alert => {
                const sevLeft = alert.severity === 'high' ? 'bg-red-500' : alert.severity === 'medium' ? 'bg-orange-500' : 'bg-yellow-500';
                const sevBadge = alert.severity === 'high'
                  ? 'bg-red-500/20 text-red-300'
                  : alert.severity === 'medium'
                  ? 'bg-orange-500/20 text-orange-300'
                  : 'bg-yellow-500/15 text-yellow-300';
                return (
                  <div key={alert.id} className="flex gap-3 p-3.5 rounded-xl bg-dark-200 border border-dark-100 overflow-hidden relative">
                    <div className={`absolute left-0 top-0 bottom-0 w-1 ${sevLeft} rounded-l-xl`} />
                    <div className="pl-2 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-white text-xs font-semibold">{alert.title}</p>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${sevBadge}`}>
                          {alert.severity}
                        </span>
                      </div>
                      <p className="text-white/60 text-[11px] mt-1">{alert.detail}</p>
                      <p className="text-white/35 text-[10px] mt-0.5 font-mono">{alert.evidence}</p>
                      <p className="text-white/25 text-[10px] mt-1.5">Staff: {alert.staffName}</p>
                    </div>
                    <button
                      className="flex-shrink-0 w-8 h-8 rounded-xl bg-gold/10 border border-gold/20 flex items-center justify-center hover:bg-gold/20 transition-colors"
                      onClick={() => navigate(`/staff/${alert.staffId}`)}
                    >
                      <span className="text-gold text-[10px] font-black">
                        {staff.find(s => s.id === alert.staffId)?.avatar || alert.staffName[0]}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Overdue Tasks ────────────────────────────────────────────────── */}
      {overdueTasks.length > 0 && (
        <div className="card">
          <SectionHeader
            icon={Clock}
            title="Overdue Tasks"
            subtitle={`${overdueTasks.length} task${overdueTasks.length !== 1 ? 's' : ''} past deadline`}
            iconColor="text-red-400"
            iconBg="bg-red-500/10 border-red-500/20"
            action={
              <button onClick={() => navigate('/tasks')} className="text-gold/50 text-xs hover:text-gold flex items-center gap-1 transition-colors font-medium">
                All tasks <ChevronRight size={12} />
              </button>
            }
          />
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {overdueTasks.slice(0, 20).map(t => {
              const daysOverdue = Math.ceil((Date.now() - new Date(t.dueDate).getTime()) / 86400000);
              const staffMember = staff.find(s => s.id === t.staffId);
              return (
                <div key={t.id} className="flex items-center gap-3 p-3 rounded-xl bg-red-500/5 border border-red-500/12">
                  <div className="w-7 h-7 rounded-xl bg-red-500/15 flex items-center justify-center flex-shrink-0">
                    <span className="text-red-300 text-[10px] font-black">{staffMember?.avatar ?? '?'}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-medium truncate">{t.title}</p>
                    <p className="text-white/30 text-[10px]">
                      {staffMember?.name?.split(' ')[0] ?? 'Unknown'}
                      {t.customerName ? ` · ${t.customerName}` : ''}
                    </p>
                  </div>
                  <span className="text-[10px] font-bold flex-shrink-0 px-2.5 py-1 rounded-full bg-red-500/20 text-red-300 whitespace-nowrap">
                    {daysOverdue}d
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Team Performance table ─────────────────────────────────────────── */}
      {staffPerfData.length > 0 && (
        <div className="card">
          <SectionHeader
            icon={Users}
            title="Team Performance"
            subtitle="Interactions, contacts & merit this period"
            action={
              <button onClick={() => navigate('/staff')} className="text-gold/50 text-xs hover:text-gold flex items-center gap-1 transition-colors font-medium">
                Manage <ChevronRight size={12} />
              </button>
            }
          />
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm min-w-[320px]">
              <thead>
                <tr>
                  {['Staff', 'Merit', 'Interactions', 'Contacts'].map(h => (
                    <th key={h} className="text-left text-white/25 font-semibold text-[11px] py-2 pr-4 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {staffPerfData.map((s, i) => {
                  const ms = meritSummary.find(m => m.staffId === staff[i]?.id);
                  const maxInt = Math.max(...staffPerfData.map(x => x.interactions), 1);
                  return (
                    <tr key={i}
                      className="border-t border-dark-100/50 hover:bg-dark-200/50 transition-colors cursor-pointer group"
                      onClick={() => navigate(`/staff/${staff[i]?.id}`)}>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl bg-gold/12 border border-gold/20 flex items-center justify-center flex-shrink-0">
                            <span className="text-gold text-[10px] font-black">{staff[i]?.avatar}</span>
                          </div>
                          <span className="text-white text-xs font-semibold group-hover:text-gold transition-colors">{s.name}</span>
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <span className={`text-xs font-black ${(ms?.total ?? 0) >= 0 ? 'text-gold' : 'text-red-400'}`}>
                          {(ms?.total ?? 0) >= 0 ? '+' : ''}{ms?.total ?? 0}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-dark-100 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${Math.min(100, Math.round((s.interactions / maxInt) * 100))}%` }} />
                          </div>
                          <span className="text-white/40 text-xs">{s.interactions}</span>
                        </div>
                      </td>
                      <td className="py-3 text-white/40 text-xs">{s.contacts}</td>
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
        <SectionHeader
          icon={Star}
          title="Merit Goals"
          subtitle="Point targets and current progress"
          action={
            <button
              onClick={() => setGoalModal(true)}
              className="flex items-center gap-1.5 text-xs bg-gold/10 border border-gold/20 text-gold px-3 py-1.5 rounded-xl hover:bg-gold/20 transition-colors font-medium"
            >
              <Plus size={12} /> Set Goal
            </button>
          }
        />
        {meritGoals.length === 0 ? (
          <div className="flex flex-col items-center py-8 gap-2">
            <div className="w-10 h-10 rounded-2xl bg-gold/8 border border-gold/15 flex items-center justify-center">
              <Target size={18} className="text-gold/40" />
            </div>
            <p className="text-white/25 text-sm">No goals set yet</p>
            <p className="text-white/15 text-xs">Set a point target to motivate your team</p>
          </div>
        ) : (
          <div className="space-y-3">
            {meritGoals.map(g => {
              const ms = meritSummary.find(m => m.staffId === g.staffId);
              const current = g.period === 'weekly' ? (ms?.weekPts ?? 0) : (ms?.monthPts ?? 0);
              const progress = Math.min(Math.max(Math.round((current / g.targetPoints) * 100), 0), 100);
              const done = progress >= 100;
              return (
                <div key={g.id} className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all ${
                  done ? 'bg-green-500/5 border-green-500/20' : 'bg-dark-200 border-dark-100'
                }`}>
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    done ? 'bg-green-500/15 border border-green-500/25' : 'bg-gold/12 border border-gold/20'
                  }`}>
                    {done
                      ? <CheckCircle size={14} className="text-green-400" />
                      : <span className="text-gold text-[10px] font-black">{staff.find(s => s.id === g.staffId)?.avatar ?? g.staffName[0]}</span>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <p className="text-white text-xs font-semibold">{g.staffName.split(' ')[0]}</p>
                      <span className="text-[10px] text-white/25 capitalize bg-dark-100 px-2 py-0.5 rounded-full">{g.period}</span>
                      {g.reward && <span className="text-[10px] text-gold/50 truncate">🎁 {g.reward}</span>}
                      {done && <span className="text-[10px] font-bold text-green-400 ml-auto">Complete!</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-dark-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${progress}%`, background: done ? '#4ade80' : `linear-gradient(90deg, ${GOLD}cc, ${GOLD})` }}
                        />
                      </div>
                      <span className="text-white/35 text-[10px] whitespace-nowrap font-medium">
                        {current}/{g.targetPoints}
                      </span>
                    </div>
                  </div>
                  <button onClick={() => handleDeleteGoal(g.id)} className="text-white/15 hover:text-red-400 transition-colors flex-shrink-0">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-dark-300 border border-dark-100 rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-fade-in-up">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-bold flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-xl bg-gold/15 border border-gold/25 flex items-center justify-center">
                  <Star size={13} className="text-gold" />
                </div>
                Set Merit Goal
              </h3>
              <button onClick={() => setGoalModal(false)} className="text-white/25 hover:text-white transition-colors"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-white/40 text-xs mb-1.5 block font-medium">Staff Member</label>
                <select value={gStaffId} onChange={e => setGStaffId(e.target.value)}
                  className="w-full bg-dark-200 border border-dark-100 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50">
                  <option value="">Select staff...</option>
                  {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-white/40 text-xs mb-1.5 block font-medium">Target Points</label>
                <input type="number" value={gTarget} onChange={e => setGTarget(e.target.value)} placeholder="e.g. 50"
                  className="w-full bg-dark-200 border border-dark-100 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50 placeholder:text-white/20" />
              </div>
              <div>
                <label className="text-white/40 text-xs mb-1.5 block font-medium">Period</label>
                <div className="flex gap-2">
                  {(['weekly', 'monthly'] as const).map(p => (
                    <button key={p} onClick={() => setGPeriod(p)}
                      className={`flex-1 py-2 rounded-xl text-sm capitalize font-medium transition-all ${
                        gPeriod === p ? 'bg-gold text-black font-bold shadow-lg' : 'bg-dark-200 border border-dark-100 text-white/40 hover:text-white'
                      }`}>{p}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-white/40 text-xs mb-1.5 block font-medium">Reward (optional)</label>
                <input type="text" value={gReward} onChange={e => setGReward(e.target.value)} placeholder="e.g. Bonus ₹500, day off..."
                  className="w-full bg-dark-200 border border-dark-100 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50 placeholder:text-white/20" />
              </div>
              <button onClick={handleSaveGoal} disabled={!gStaffId || !gTarget || savingGoal}
                className="w-full bg-gold text-black font-bold py-2.5 rounded-xl text-sm disabled:opacity-40 hover:bg-gold/90 transition-all active:scale-95">
                {savingGoal ? 'Saving...' : 'Save Goal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Award Points Modal ────────────────────────────────────────────── */}
      {awardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-dark-300 border border-dark-100 rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-fade-in-up">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-bold flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-xl bg-gold/15 border border-gold/25 flex items-center justify-center">
                  <Award size={13} className="text-gold" />
                </div>
                Award / Deduct Points
              </h3>
              <button onClick={() => setAwardModal(false)} className="text-white/25 hover:text-white transition-colors"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-white/40 text-xs mb-1.5 block font-medium">Staff Member</label>
                <select value={aStaffId} onChange={e => setAStaffId(e.target.value)}
                  className="w-full bg-dark-200 border border-dark-100 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50">
                  <option value="">Select staff...</option>
                  {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-white/40 text-xs mb-1.5 block font-medium">Points (use negative to deduct)</label>
                <input type="number" value={aPoints} onChange={e => setAPoints(e.target.value)} placeholder="e.g. 10 or -5"
                  className="w-full bg-dark-200 border border-dark-100 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50 placeholder:text-white/20" />
              </div>
              <div>
                <label className="text-white/40 text-xs mb-1.5 block font-medium">Reason</label>
                <input type="text" value={aReason} onChange={e => setAReason(e.target.value)} placeholder="e.g. Excellent client handling"
                  className="w-full bg-dark-200 border border-dark-100 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50 placeholder:text-white/20" />
              </div>
              <button onClick={handleAward} disabled={!aStaffId || !aPoints || !aReason || savingAward}
                className="w-full bg-gold text-black font-bold py-2.5 rounded-xl text-sm disabled:opacity-40 hover:bg-gold/90 transition-all active:scale-95">
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
  const [unreadQueue,   setUnreadQueue]   = useState<BroadcastMsg[]>([]);
  const [bcastModal,    setBcastModal]    = useState(false);
  const [bcastModalIdx, setBcastModalIdx] = useState(0);
  const [loading,       setLoading]       = useState(true);

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

  const sortedCustomers = [...customers].sort((a, b) => {
    const da = a.lastContact ? Date.now() - new Date(a.lastContact).getTime() : Infinity;
    const db = b.lastContact ? Date.now() - new Date(b.lastContact).getTime() : Infinity;
    return db - da;
  });

  const handleCompleteTask = async (id: string) => {
    await tasksAPI.complete(id);
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  if (loading) return (
    <div className="space-y-4">
      <div className="h-36 rounded-2xl shimmer" />
      <div className="h-16 rounded-2xl shimmer" />
      <div className="grid grid-cols-3 gap-3">
        <div className="h-24 rounded-2xl shimmer" /><div className="h-24 rounded-2xl shimmer" /><div className="h-24 rounded-2xl shimmer" />
      </div>
    </div>
  );

  return (
    <div className="space-y-5 animate-fade-in">

      {/* ── Broadcast modal ──────────────────────────────────────────────── */}
      {bcastModal && unreadQueue.length > 0 && (() => {
        const b = unreadQueue[bcastModalIdx];
        if (!b) return null;
        const hasNext = bcastModalIdx < unreadQueue.length - 1;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
            <div className="bg-dark-300 border border-amber-500/35 rounded-2xl shadow-2xl w-full max-w-sm animate-bounce-in">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-dark-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/12 border border-amber-500/25 flex items-center justify-center">
                    <MessageSquare size={14} className="text-amber-400" />
                  </div>
                  <div>
                    <p className="text-amber-300 font-bold text-sm">Announcement</p>
                    {unreadQueue.length > 1 && (
                      <p className="text-white/25 text-[10px]">{bcastModalIdx + 1} of {unreadQueue.length}</p>
                    )}
                  </div>
                </div>
                <button onClick={dismissBcastModal} className="text-white/25 hover:text-white transition-colors"><X size={16} /></button>
              </div>
              <div className="px-5 py-4">
                <p className="text-white text-sm leading-relaxed">{b.message}</p>
                <p className="text-white/25 text-[10px] mt-3">
                  {b.sentBy} · {new Date(b.sentAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}
                </p>
              </div>
              <div className="flex items-center gap-2 px-5 py-3.5 border-t border-dark-100">
                {hasNext ? (
                  <>
                    <button onClick={() => setBcastModalIdx(i => i + 1)} className="flex-1 btn-primary text-sm py-2">Next →</button>
                    <button onClick={dismissBcastModal} className="flex-1 text-white/40 hover:text-white text-sm transition-colors">Done</button>
                  </>
                ) : (
                  <button onClick={dismissBcastModal} className="w-full btn-primary text-sm py-2">Got it</button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Streak hero card ─────────────────────────────────────────────── */}
      <div className="relative rounded-2xl border border-gold/20 bg-gradient-to-br from-dark-300 via-dark-300 to-dark-400 overflow-hidden p-5"
        style={{ boxShadow: streak > 0 ? '0 0 40px rgba(212,175,55,0.08)' : undefined }}>
        {/* Decorative orbs */}
        <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-gold/5 blur-2xl pointer-events-none" />
        <div className="absolute right-4 bottom-4 w-20 h-20 rounded-full bg-gold/4 blur-xl pointer-events-none" />

        <div className="relative z-10 flex items-center justify-between">
          <div>
            <p className="text-white/35 text-[10px] uppercase tracking-[0.15em] font-semibold mb-1.5">Current Streak</p>
            <div className="flex items-end gap-2.5">
              <span className="text-6xl font-black text-white leading-none">{streak}</span>
              <div className="mb-1">
                <span className="text-gold text-xl font-black">days</span>
                {streak > 0 && (
                  <Flame
                    size={22}
                    className="inline ml-2 text-gold animate-glow-breathe"
                    style={{ filter: 'drop-shadow(0 0 8px rgba(212,175,55,0.8))' }}
                  />
                )}
              </div>
            </div>
            <p className="text-white/25 text-xs mt-2">Best: <span className="text-white/40 font-semibold">{longestStreak}d</span> · Log a contact to keep going</p>
          </div>

          {/* Week progress mini card */}
          <div className="bg-dark-200/80 backdrop-blur rounded-2xl p-4 border border-dark-100/80 min-w-[110px]">
            <p className="text-white/30 text-[10px] font-semibold uppercase tracking-wider mb-1">This Week</p>
            <p className="text-white font-black text-xl leading-tight">
              {weekContacts}
              <span className="text-white/25 text-sm font-normal">/{weekTarget}</span>
            </p>
            <div className="w-full h-2 bg-dark-100 rounded-full mt-2 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${weekProgress}%`, background: weekProgress >= 100 ? '#4ade80' : `linear-gradient(90deg, ${GOLD}99, ${GOLD})` }}
              />
            </div>
            <p className="text-white/20 text-[10px] mt-1.5 text-center">{Math.round(weekProgress)}% of target</p>
          </div>
        </div>
      </div>

      {/* ── Diary mic CTA ─────────────────────────────────────────────────── */}
      <button
        onClick={() => navigate('/diary')}
        className="w-full flex items-center gap-4 p-4 rounded-2xl border border-gold/25 bg-gradient-to-r from-gold/6 to-transparent hover:from-gold/12 hover:border-gold/40 transition-all group active:scale-[0.98]"
        style={{ boxShadow: '0 0 0 0 rgba(212,175,55,0)' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 24px rgba(212,175,55,0.1)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 0 rgba(212,175,55,0)'; }}
      >
        <div className="relative flex-shrink-0">
          <div className="w-12 h-12 rounded-xl bg-gold/15 border border-gold/30 flex items-center justify-center group-hover:bg-gold/22 transition-colors">
            <Mic size={22} className="text-gold" />
          </div>
          {/* Pulse ring */}
          <span className="absolute inset-0 rounded-xl border border-gold/40 animate-ping opacity-30 group-hover:opacity-60" />
        </div>
        <div className="text-left flex-1">
          <p className="text-white font-bold text-sm">Log Today's Work</p>
          <p className="text-white/35 text-xs mt-0.5">Tap to open diary & record voice entries</p>
        </div>
        <ChevronRight size={16} className="text-gold/35 group-hover:text-gold group-hover:translate-x-0.5 transition-all flex-shrink-0" />
      </button>

      {/* ── Quick stats ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card text-center py-4 animate-fade-in-up stagger-1">
          <p className="text-2xl font-black text-white">{customers.length}</p>
          <p className="text-white/30 text-[11px] mt-0.5 font-medium">Customers</p>
        </div>
        <div className={`card text-center py-4 animate-fade-in-up stagger-2 ${overdueTasks.length > 0 ? 'border-red-500/25' : ''}`}>
          <p className={`text-2xl font-black ${overdueTasks.length > 0 ? 'text-red-400' : 'text-white'}`}>
            {overdueTasks.length}
          </p>
          <p className="text-white/30 text-[11px] mt-0.5 font-medium">Overdue</p>
        </div>
        <div className="card text-center py-4 animate-fade-in-up stagger-3">
          <p className="text-2xl font-black text-white">{latestPerf?.responseRate || 0}<span className="text-sm text-white/40">%</span></p>
          <p className="text-white/30 text-[11px] mt-0.5 font-medium">Response</p>
        </div>
      </div>

      {/* ── Today's tasks ─────────────────────────────────────────────────── */}
      {(todayTasks.length > 0 || overdueTasks.length > 0) && (
        <div className="card">
          <SectionHeader
            icon={Target}
            title="Today's Tasks"
            subtitle={`${todayTasks.length} today · ${overdueTasks.length} overdue`}
            action={
              <button onClick={() => navigate('/tasks')} className="text-white/25 text-xs hover:text-gold transition-colors flex items-center gap-1 font-medium">
                All <ChevronRight size={12} />
              </button>
            }
          />
          <div className="space-y-2">
            {[...overdueTasks.slice(0, 2), ...todayTasks.slice(0, 3)].map(t => (
              <div key={t.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                t.dueDate < today ? 'bg-red-500/5 border-red-500/15' : 'bg-dark-200 border-dark-100'
              }`}>
                <button
                  onClick={() => handleCompleteTask(t.id)}
                  className="w-5 h-5 rounded-full border-2 border-gold/35 hover:border-gold hover:bg-gold/15 flex items-center justify-center flex-shrink-0 transition-all group"
                >
                  <CheckCircle size={10} className="text-gold opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-semibold truncate">{t.title}</p>
                  {t.customerName && <p className="text-white/30 text-[10px]">{t.customerName}</p>}
                </div>
                {t.dueDate < today && (
                  <span className="text-[10px] font-bold flex-shrink-0 px-2 py-0.5 rounded-full bg-red-500/20 text-red-300">Overdue</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Customer queue ────────────────────────────────────────────────── */}
      <div className="card">
        <SectionHeader
          icon={Zap}
          title="Customer Queue"
          subtitle="Sorted by urgency — contact the top ones first"
          action={
            <button onClick={() => navigate('/customers')} className="text-white/25 text-xs hover:text-gold transition-colors flex items-center gap-1 font-medium">
              All <ChevronRight size={12} />
            </button>
          }
        />
        {sortedCustomers.length === 0 ? (
          <div className="flex flex-col items-center py-8 gap-2">
            <div className="w-10 h-10 rounded-2xl bg-gold/8 border border-gold/15 flex items-center justify-center">
              <Users size={18} className="text-gold/40" />
            </div>
            <p className="text-white/25 text-sm">No customers assigned yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sortedCustomers.slice(0, 6).map((c, i) => {
              const days = c.lastContact
                ? Math.round((Date.now() - new Date(c.lastContact).getTime()) / 86400000)
                : null;
              const isOverdue = days !== null && days > 7;
              return (
                <div
                  key={c.id}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all hover:scale-[1.01] ${
                    isOverdue ? 'border-red-500/20 bg-red-500/5 hover:border-red-500/30' : 'border-dark-100 bg-dark-200 hover:border-gold/20'
                  }`}
                  style={{ animationDelay: `${i * 35}ms` }}
                  onClick={() => navigate('/customers')}
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 border ${
                    isOverdue ? 'bg-red-500/12 border-red-500/20' : 'bg-dark-100 border-dark-50'
                  }`}>
                    <span className={`text-xs font-black ${isOverdue ? 'text-red-300' : 'text-white/50'}`}>{c.name[0]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-semibold truncate">{c.name}</p>
                    <p className="text-white/30 text-[10px]">{c.phone}</p>
                  </div>
                  <div className="text-right flex-shrink-0 space-y-1">
                    <div className="flex items-center justify-end gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: PIPELINE_COLORS[c.status] || '#555' }} />
                      <span className="text-white/25 text-[10px] capitalize">{c.status}</span>
                    </div>
                    <p className={`text-[10px] font-semibold ${isOverdue ? 'text-red-400' : days === 0 ? 'text-green-400' : 'text-white/25'}`}>
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
      {/* Page header */}
      <div className="mb-6 flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1 h-6 rounded-full bg-gold animate-glow-breathe" />
            <h1 className="text-2xl font-black text-white tracking-tight">
              {isAdmin ? 'Dashboard' : 'My Dashboard'}
            </h1>
          </div>
          <p className="text-white/30 text-sm pl-3">
            <span className="text-gold font-semibold">{user?.name?.split(' ')[0]}</span>
            {' — '}
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-1.5 text-[10px] text-white/20 bg-dark-200 border border-dark-100 rounded-xl px-3 py-1.5">
            <Sparkles size={10} className="text-gold/40" />
            <span>Live</span>
          </div>
        )}
      </div>
      {isAdmin ? <AdminDashboard /> : <StaffDashboard />}
    </div>
  );
}
