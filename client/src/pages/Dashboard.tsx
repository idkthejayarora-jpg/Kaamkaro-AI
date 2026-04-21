import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import {
  Flame, TrendingUp, Users, UserCheck, AlertTriangle,
  CheckCircle, Clock, ChevronRight, Phone, Calendar,
  MessageSquare, Mail, Target, Zap,
} from 'lucide-react';
import { staffAPI, customersAPI, aiAPI, tasksAPI, interactionsAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { Staff, Customer, Performance, DashboardSummary, Task } from '../types';

const GOLD = '#D4AF37';
const DIM  = '#2A2A2A';

const PIPELINE_COLORS: Record<string, string> = {
  lead: '#666',  contacted: '#60a5fa', interested: '#D4AF37',
  negotiating: '#f97316', closed: '#4ade80', churned: '#f87171',
};

function StatCard({ label, value, sub, icon: Icon, accent = false, alert = false }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; accent?: boolean; alert?: boolean;
}) {
  return (
    <div className={`stat-card ${alert ? 'border-red-500/30' : ''}`}>
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
  const [staff, setStaff]       = useState<Staff[]>([]);
  const [performance, setPerf]  = useState<Performance[]>([]);
  const [summary, setSummary]   = useState<DashboardSummary | null>(null);
  const [loading, setLoading]   = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const [s, sum] = await Promise.all([staffAPI.list(), aiAPI.dashboardSummary()]);
      setStaff(s);
      setSummary(sum);
      const allPerf = await Promise.all(s.map((st: Staff) => staffAPI.getPerformance(st.id)));
      setPerf(allPerf.flat());
      setLoading(false);
    })();
  }, []);

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
      streak: s.streakData?.currentStreak || 0,
    };
  });

  if (loading) return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array(4).fill(0).map((_, i) => <div key={i} className="card h-28 shimmer" />)}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Alert banners */}
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

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Staff"       value={summary?.totalStaff ?? 0}           icon={Users}      accent />
        <StatCard label="Active Customers"  value={summary?.activeCustomers ?? 0}       icon={UserCheck}  accent />
        <StatCard label="Avg Response Rate" value={`${summary?.avgResponseRate ?? 0}%`} icon={TrendingUp}
          accent={Boolean(summary && summary.avgResponseRate >= 60)} />
        <StatCard
          label="Top Streak"
          value={summary?.topStreaker ? `${summary.topStreaker.streak}d` : '—'}
          sub={summary?.topStreaker?.name}
          icon={Flame} accent
        />
      </div>

      {/* Charts */}
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

      {/* Staff table */}
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
                  {['Staff', 'Response Rate', 'Streak', 'Contacts'].map(h => (
                    <th key={h} className="text-left text-white/25 font-medium text-xs py-2 pr-4 first:pr-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {staffPerfData.map((s, i) => (
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
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 bg-dark-200 rounded-full">
                          <div className="h-full bg-gold rounded-full" style={{ width: `${s.responseRate}%` }} />
                        </div>
                        <span className="text-white/50 text-xs">{s.responseRate}%</span>
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-1">
                        <Flame size={12} className={s.streak > 0 ? 'text-gold' : 'text-white/20'} />
                        <span className="text-white/60 text-xs">{s.streak}d</span>
                      </div>
                    </td>
                    <td className="py-3 text-white/50 text-xs">{s.contacts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [tasks, setTasks]         = useState<Task[]>([]);
  const [performance, setPerf]    = useState<Performance[]>([]);
  const [loading, setLoading]     = useState(true);

  const load = useCallback(async () => {
    const [c, t, p] = await Promise.all([
      customersAPI.list(),
      tasksAPI.list({ completed: false }),
      staffAPI.getPerformance(user!.id),
    ]);
    setCustomers(c);
    setTasks(t);
    setPerf(p.sort((a: Performance, b: Performance) => a.week.localeCompare(b.week)));
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

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
