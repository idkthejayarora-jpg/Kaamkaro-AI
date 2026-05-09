import { useEffect, useState } from 'react';
import { TabBar, AnimatedTabPanel } from '../components/TabBar';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Phone, Mail, Calendar, Flame, TrendingUp, Users } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import { staffAPI, customersAPI, interactionsAPI, badgesAPI } from '../lib/api';
import type { Staff, Customer, Performance, Interaction, Badge } from '../types';
import { BADGE_META } from '../types';

const GOLD = '#D4AF37';
const DIM  = '#2A2A2A';

const TYPE_LABELS: Record<string, string> = { call: '📞', message: '💬', email: '✉️', meeting: '🤝', diary: '📓' };

function fmt(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export default function StaffProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [staff, setStaff]             = useState<Staff | null>(null);
  const [customers, setCustomers]     = useState<Customer[]>([]);
  const [performance, setPerformance] = useState<Performance[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [loading, setLoading]         = useState(true);
  const [activeTab, setActiveTab]     = useState<'activity' | 'customers'>('activity');
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
            <div key={p.id} className="flex items-center justify-between py-2 border-b border-dark-50/50 last:border-0">
              <span className="text-white/40 text-xs font-mono">{p.week}</span>
              <div className="flex items-center gap-3">
                <div className="flex gap-0.5">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <div key={i} className={`w-4 h-4 rounded-sm ${i < p.streak ? 'bg-gold' : 'bg-dark-200'}`} />
                  ))}
                </div>
                <span className="text-white/30 text-xs w-16 text-right">{p.responseRate}% resp.</span>
                <span className="text-white/30 text-xs w-16 text-right">{p.customersContacted} contacts</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tab switcher ── */}
      <TabBar
        tabs={[
          { id: 'activity',  label: `Activity (${interactions.length})`  },
          { id: 'customers', label: `Customers (${customers.length})` },
        ]}
        active={activeTab}
        onChange={id => setActiveTab(id as 'activity' | 'customers')}
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

      </AnimatedTabPanel>
    </div>
  );
}
