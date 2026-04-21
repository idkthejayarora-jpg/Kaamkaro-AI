import { useEffect, useState } from 'react';
import { Target, Plus, X, Trash2, TrendingUp, Phone, CheckCircle, BarChart3 } from 'lucide-react';
import { goalsAPI, staffAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { Goal, Staff, GoalMetric } from '../types';

const METRIC_CONFIG: Record<GoalMetric, { label: string; unit: string; icon: React.ElementType; color: string }> = {
  calls:           { label: 'Total Calls',        unit: 'calls',       icon: Phone,         color: 'text-blue-400' },
  interactions:    { label: 'Interactions',        unit: 'logs',        icon: TrendingUp,    color: 'text-gold' },
  tasks_completed: { label: 'Tasks Completed',     unit: 'tasks',       icon: CheckCircle,   color: 'text-green-400' },
  response_rate:   { label: 'Response Rate',       unit: '%',           icon: BarChart3,     color: 'text-purple-400' },
};

function ProgressRing({ progress, size = 56, color }: { progress: number; size?: number; color: string }) {
  const radius    = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset    = circumference - (Math.min(progress, 100) / 100) * circumference;
  const colorMap: Record<string, string> = {
    'text-blue-400':   '#60a5fa',
    'text-gold':       '#D4AF37',
    'text-green-400':  '#4ade80',
    'text-purple-400': '#c084fc',
    'text-red-400':    '#f87171',
    'text-orange-400': '#fb923c',
  };
  const stroke = colorMap[color] || '#D4AF37';

  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={4} />
      <circle
        cx={size/2} cy={size/2} r={radius} fill="none"
        stroke={stroke} strokeWidth={4}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.8s ease' }}
      />
    </svg>
  );
}

function AddGoalModal({ staff, onClose, onCreated }: {
  staff: Staff[]; onClose: () => void; onCreated: (g: Goal) => void;
}) {
  const [form, setForm] = useState({
    staffId: '',
    metric: 'interactions' as GoalMetric,
    target: '',
    label: '',
    month: new Date().toISOString().slice(0, 7),
  });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.staffId || !form.target) { setError('Select a staff member and set a target'); return; }
    setLoading(true); setError('');
    try {
      const g = await goalsAPI.create({
        ...form,
        target: Number(form.target),
        label: form.label || METRIC_CONFIG[form.metric].label,
      });
      onCreated(g);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed');
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-dark-300 border border-dark-50 rounded-2xl w-full max-w-md shadow-2xl animate-slide-up">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-50">
          <h2 className="text-white font-semibold">Set Monthly Goal</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {error && <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-4 py-3 text-sm">{error}</div>}

          <div>
            <label className="label">Staff Member *</label>
            <select className="input" value={form.staffId} onChange={e => setForm(f => ({ ...f, staffId: e.target.value }))}>
              <option value="">Select staff...</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div>
            <label className="label">Metric *</label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.entries(METRIC_CONFIG) as [GoalMetric, typeof METRIC_CONFIG[GoalMetric]][]).map(([key, cfg]) => {
                const Icon = cfg.icon;
                return (
                  <button
                    key={key} type="button"
                    onClick={() => setForm(f => ({ ...f, metric: key }))}
                    className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all ${
                      form.metric === key
                        ? 'border-gold bg-gold/10 text-gold'
                        : 'border-dark-50 text-white/40 hover:text-white hover:border-white/20'
                    }`}
                  >
                    <Icon size={14} />
                    <span className="text-xs font-medium">{cfg.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Target ({METRIC_CONFIG[form.metric].unit}) *</label>
              <input className="input" type="number" min="1" placeholder="e.g. 50"
                value={form.target} onChange={e => setForm(f => ({ ...f, target: e.target.value }))} />
            </div>
            <div>
              <label className="label">Month</label>
              <input className="input" type="month" value={form.month}
                onChange={e => setForm(f => ({ ...f, month: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="label">Custom Label (optional)</label>
            <input className="input" placeholder={`e.g. "${METRIC_CONFIG[form.metric].label} target"`}
              value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              <Target size={14} className="mr-1.5" />
              {loading ? 'Setting...' : 'Set Goal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Goals() {
  const [goals, setGoals]     = useState<Goal[]>([]);
  const [staff, setStaff]     = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [staffFilter, setStaffFilter] = useState('all');
  const { isAdmin, user } = useAuth();

  const load = async () => {
    const [g, s] = await Promise.all([goalsAPI.list(), isAdmin ? staffAPI.list() : Promise.resolve([])]);
    setGoals(g);
    setStaff(s);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this goal?')) return;
    await goalsAPI.delete(id);
    setGoals(g => g.filter(x => x.id !== id));
  };

  const filtered = goals.filter(g => staffFilter === 'all' || g.staffId === staffFilter);

  // Group by staff
  const grouped = filtered.reduce((acc, g) => {
    if (!acc[g.staffId]) acc[g.staffId] = [];
    acc[g.staffId].push(g);
    return acc;
  }, {} as Record<string, Goal[]>);

  const getStaffName = (id: string) => staff.find(s => s.id === id)?.name || (user?.id === id ? user.name : 'Unknown');

  if (loading) return <div className="space-y-3">{Array(4).fill(0).map((_, i) => <div key={i} className="card h-24 shimmer" />)}</div>;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Target size={24} className="text-gold" />
            Monthly Goals
          </h1>
          <p className="text-white/30 text-sm mt-1">
            {new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })} targets
          </p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2 flex-shrink-0">
            <Plus size={14} />Set Goal
          </button>
        )}
      </div>

      {/* Staff filter */}
      {isAdmin && staff.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setStaffFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${staffFilter === 'all' ? 'bg-gold text-dark-500' : 'border border-dark-50 text-white/40 hover:text-white'}`}>
            All Staff
          </button>
          {staff.map(s => (
            <button key={s.id} onClick={() => setStaffFilter(s.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${staffFilter === s.id ? 'bg-gold text-dark-500' : 'border border-dark-50 text-white/40 hover:text-white'}`}>
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Goals grouped by staff */}
      {Object.keys(grouped).length === 0 ? (
        <div className="card flex flex-col items-center py-16 text-center">
          <Target size={36} className="text-white/10 mb-4" />
          <p className="text-white/40 font-medium">No goals set yet</p>
          {isAdmin && (
            <>
              <p className="text-white/20 text-sm mt-1">Set monthly targets for each staff member</p>
              <button onClick={() => setShowAdd(true)} className="btn-primary mt-4">Set First Goal</button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([staffId, staffGoals]) => (
            <div key={staffId}>
              <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3 px-1">
                {getStaffName(staffId)}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {staffGoals.map(g => {
                  const cfg  = METRIC_CONFIG[g.metric];
                  const Icon = cfg.icon;
                  const done = g.progress >= 100;
                  return (
                    <div key={g.id} className={`card relative ${done ? 'border-green-500/25 bg-green-500/3' : ''}`}>
                      {isAdmin && (
                        <button
                          onClick={() => handleDelete(g.id)}
                          className="absolute top-3 right-3 p-1 text-white/15 hover:text-red-400 transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}

                      <div className="flex items-start gap-4">
                        {/* Progress ring */}
                        <div className="relative flex-shrink-0">
                          <ProgressRing progress={g.progress} color={done ? 'text-green-400' : cfg.color} />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className={`text-xs font-black ${done ? 'text-green-400' : cfg.color}`}>{g.progress}%</span>
                          </div>
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Icon size={12} className={cfg.color} />
                            <p className="text-white/50 text-xs font-medium uppercase tracking-wider truncate">{g.label}</p>
                          </div>
                          <p className="text-white font-bold text-xl">
                            {g.current}
                            <span className="text-white/30 text-sm font-normal"> / {g.target} {cfg.unit}</span>
                          </p>
                          {done && <p className="text-green-400 text-xs font-medium mt-1">✓ Goal achieved!</p>}
                          {!done && g.progress > 0 && (
                            <p className="text-white/30 text-xs mt-1">
                              {g.target - g.current} {cfg.unit} remaining
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="mt-3 h-1.5 bg-dark-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-1000 ${done ? 'bg-green-400' : 'bg-gold'}`}
                          style={{ width: `${Math.min(g.progress, 100)}%` }}
                        />
                      </div>

                      <p className="text-white/20 text-[10px] mt-2">{g.month}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <AddGoalModal
          staff={staff}
          onClose={() => setShowAdd(false)}
          onCreated={g => { setGoals(p => [...p, g]); setShowAdd(false); }}
        />
      )}
    </div>
  );
}
