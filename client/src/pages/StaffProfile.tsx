import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Phone, Mail, Calendar, Flame, TrendingUp, Users, Clock, LogIn, LogOut, Timer } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { staffAPI, customersAPI, interactionsAPI, attendanceAPI, badgesAPI } from '../lib/api';
import type { Staff, Customer, Performance, Interaction, AttendanceRecord, Badge } from '../types';
import { BADGE_META } from '../types';

const GOLD = '#D4AF37';
const DIM  = '#2A2A2A';

const TYPE_LABELS: Record<string, string> = { call: '📞', message: '💬', email: '✉️', meeting: '🤝', diary: '📓' };

function fmt(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}
function fmtHrs(h: number) {
  if (!h) return '—';
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
}

export default function StaffProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [staff, setStaff]             = useState<Staff | null>(null);
  const [customers, setCustomers]     = useState<Customer[]>([]);
  const [performance, setPerformance] = useState<Performance[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [attendance, setAttendance]   = useState<AttendanceRecord[]>([]);
  const [loading, setLoading]         = useState(true);
  const [activeTab, setActiveTab]     = useState<'activity' | 'attendance' | 'customers'>('activity');
  const [badges, setBadges]           = useState<Badge[]>([]);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      staffAPI.get(id).catch(() => null),
      customersAPI.list().catch(() => [] as Customer[]),
      staffAPI.getPerformance(id).catch(() => [] as Performance[]),
      interactionsAPI.list({ staffId: id }).catch(() => [] as Interaction[]),
      attendanceAPI.list({ staffId: id }).catch(() => [] as AttendanceRecord[]),
      badgesAPI.list(id).catch(() => [] as Badge[]),
    ]).then(([s, c, p, i, a, b]) => {
      setStaff(s as Staff | null);
      setCustomers((c as Customer[]).filter(cu =>
        cu.assignedTo === id || (cu.assignedStaff || []).includes(id!)
      ));
      setPerformance((p as Performance[]).sort((a, b) => a.week.localeCompare(b.week)));
      setInteractions(i as Interaction[]);
      setAttendance(a as AttendanceRecord[]);
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
  const chartData = performance.slice(-8).map(p => ({
    week: `W${p.week.split('-W')[1] || p.week}`,
    responseRate: p.responseRate,
    contacts: p.customersContacted,
  }));
  const avgResponse = performance.length
    ? Math.round(performance.reduce((s, p) => s + p.responseRate, 0) / performance.length) : 0;

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
            { label: 'Customers',    value: customers.length,                          icon: Users },
            { label: 'Avg Response', value: `${avgResponse}%`,                        icon: TrendingUp },
            { label: 'Streak',       value: `${staff.streakData?.currentStreak || 0}d`, icon: Flame },
            { label: 'Best Streak',  value: `${staff.streakData?.longestStreak || 0}d`, icon: Flame },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="bg-dark-200 rounded-xl p-3 text-center">
              <Icon size={16} className="text-gold mx-auto mb-1" />
              <p className="text-white font-bold text-lg">{value}</p>
              <p className="text-white/30 text-xs">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="card">
          <h3 className="text-white font-semibold mb-4">Response Rate Over Time</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="staffGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={GOLD} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={GOLD} stopOpacity={0}   />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={DIM} />
              <XAxis dataKey="week" tick={{ fill: '#666', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: '#666', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: '#1A1A1A', border: '1px solid #2A2A2A', borderRadius: '8px', color: '#fff', fontSize: '12px' }} />
              <Area type="monotone" dataKey="responseRate" stroke={GOLD} strokeWidth={2} fill="url(#staffGrad)" name="Response %" dot={{ fill: GOLD, r: 3, strokeWidth: 0 }} />
            </AreaChart>
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
      <div className="flex gap-1 border-b border-dark-50 pb-0">
        {([
          { key: 'activity',   label: `Activity (${interactions.length})` },
          { key: 'attendance', label: `Attendance (${attendance.length} days)` },
          { key: 'customers',  label: `Customers (${customers.length})` },
        ] as const).map(({ key, label }) => (
          <button key={key} onClick={() => setActiveTab(key)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors border-b-2 ${
              activeTab === key
                ? 'border-gold text-gold bg-gold/5'
                : 'border-transparent text-white/30 hover:text-white'
            }`}>
            {label}
          </button>
        ))}
      </div>

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

      {/* ── Attendance tab ── */}
      {activeTab === 'attendance' && (
        <div className="card">
          {/* Summary stats */}
          {attendance.length > 0 && (() => {
            const last7 = attendance.slice(0, 7);
            const totalHrs = last7.reduce((s, r) => s + (r.hoursWorked || 0), 0);
            const avgHrs   = totalHrs / last7.length;
            const daysPresent = last7.filter(r => r.loginAt).length;
            return (
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  { label: 'Days Present (7d)', value: `${daysPresent}/7`, icon: Calendar },
                  { label: 'Total Hours (7d)',  value: fmtHrs(totalHrs),  icon: Timer },
                  { label: 'Avg Hours/Day',     value: fmtHrs(avgHrs),    icon: Clock },
                ].map(({ label, value, icon: Icon }) => (
                  <div key={label} className="bg-dark-200 rounded-xl p-3 text-center">
                    <Icon size={14} className="text-gold mx-auto mb-1" />
                    <p className="text-white font-bold text-sm">{value}</p>
                    <p className="text-white/30 text-[10px]">{label}</p>
                  </div>
                ))}
              </div>
            );
          })()}

          <h3 className="text-white font-semibold mb-3">Daily Login / Logout Log</h3>
          {attendance.length === 0 ? (
            <p className="text-white/25 text-sm text-center py-6">No attendance records yet. Recorded automatically on login/logout.</p>
          ) : (
            <div className="space-y-0">
              {attendance.map(rec => {
                const isToday = rec.date === new Date().toISOString().split('T')[0];
                return (
                  <div key={rec.id} className={`border-b border-dark-50/30 last:border-0 py-3 ${isToday ? 'bg-gold/3 rounded-xl px-2' : ''}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        {/* Date */}
                        <div className="w-12 text-center flex-shrink-0">
                          <p className="text-white/70 text-xs font-bold">
                            {new Date(rec.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                          </p>
                          <p className="text-white/25 text-[10px]">
                            {new Date(rec.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' })}
                          </p>
                        </div>

                        {/* Sessions */}
                        <div className="space-y-1">
                          {(rec.sessions || []).map((s, si) => (
                            <div key={si} className="flex items-center gap-2">
                              <span className="flex items-center gap-1 text-green-400 text-[10px]">
                                <LogIn size={9} />{fmt(s.loginAt)}
                              </span>
                              {s.logoutAt ? (
                                <span className="flex items-center gap-1 text-red-400/70 text-[10px]">
                                  <LogOut size={9} />{fmt(s.logoutAt)}
                                </span>
                              ) : (
                                <span className="text-gold text-[10px] animate-pulse">● Active</span>
                              )}
                            </div>
                          ))}
                          {(!rec.sessions || rec.sessions.length === 0) && rec.loginAt && (
                            <span className="flex items-center gap-1 text-green-400 text-[10px]">
                              <LogIn size={9} />{fmt(rec.loginAt)}
                              {rec.logoutAt
                                ? <><LogOut size={9} className="ml-1 text-red-400/70" />{fmt(rec.logoutAt)}</>
                                : <span className="text-gold ml-1 animate-pulse">● Active</span>}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Hours badge */}
                      <div className="text-right flex-shrink-0">
                        {rec.hoursWorked > 0 ? (
                          <span className="badge bg-gold/10 text-gold border-gold/20 text-xs font-bold">
                            {fmtHrs(rec.hoursWorked)}
                          </span>
                        ) : rec.loginAt && !rec.logoutAt ? (
                          <span className="badge bg-green-500/10 text-green-400 border-green-500/20 text-[10px]">
                            In progress
                          </span>
                        ) : (
                          <span className="text-white/20 text-xs">—</span>
                        )}
                        {isToday && <p className="text-gold/50 text-[9px] mt-0.5">Today</p>}
                      </div>
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
    </div>
  );
}
