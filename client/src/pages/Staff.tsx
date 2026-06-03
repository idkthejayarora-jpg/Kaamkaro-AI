import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, ChevronRight, Users, Phone, Calendar, Trash2, X, Eye, EyeOff, KeyRound, Flame } from 'lucide-react';
import { staffAPI, customersAPI, attendanceAPI } from '../lib/api';
import type { Staff, Customer } from '../types';
import Portal from '../components/Portal';

// Today's attendance status → single indicator dot.
const ATT_STATUS = {
  present: { label: 'Present', color: 'text-green-400', dot: 'bg-green-400', glow: '0 0 6px rgba(34,197,94,0.7)' },
  late:    { label: 'Late',    color: 'text-blue-400',  dot: 'bg-blue-400',  glow: '0 0 6px rgba(96,165,250,0.7)' },
  absent:  { label: 'Absent',  color: 'text-red-400',   dot: 'bg-red-400',   glow: '0 0 6px rgba(248,113,113,0.6)' },
} as const;
type AttKey = keyof typeof ATT_STATUS;

// ── Add Staff Modal ────────────────────────────────────────────────────────────
function AddStaffModal({ customers, onClose, onCreated }: {
  customers: Customer[]; onClose: () => void; onCreated: (s: Staff) => void;
}) {
  const [form, setForm] = useState({ name: '', phone: '', password: '', email: '', customers: [] as string[] });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const toggleCustomer = (id: string) =>
    setForm(f => ({ ...f, customers: f.customers.includes(id) ? f.customers.filter(c => c !== id) : [...f.customers, id] }));

  const doSubmit = async () => {
    if (!form.name || !form.phone || !form.password) { setError('Name, phone and password required'); return; }
    setLoading(true); setError('');
    try {
      const created = await staffAPI.create(form);
      for (const cId of form.customers) await customersAPI.update(cId, { assignedTo: created.id });
      onCreated(created);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed');
    } finally { setLoading(false); }
  };

  return (
    <Portal>
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-dark-300 border border-dark-50 rounded-t-2xl sm:rounded-2xl w-full max-w-md shadow-2xl animate-slide-up sm:animate-scale-in max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-50 flex-shrink-0">
          <h2 className="text-white font-semibold">Add New Staff</h2>
          <button type="button" onClick={onClose} className="text-white/40 hover:text-white"><X size={18} /></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); doSubmit(); }} className="overflow-y-auto p-6 space-y-4 flex-1">
          {error && <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-4 py-3 text-sm">{error}</div>}
          <div><label className="label">Full Name *</label>
            <input className="input" placeholder="e.g. Priya Sharma" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div>
            <label className="label">Phone Number * (login username)</label>
            <input className="input" type="tel" placeholder="9876543210" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            <p className="text-white/20 text-[10px] mt-1">Staff will use this to log in</p>
          </div>
          <div>
            <label className="label">Password *</label>
            <div className="relative">
              <input className="input pr-10" type={showPass ? 'text' : 'password'} placeholder="Create a password"
                value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
              <button type="button" onClick={() => setShowPass(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60">
                {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div><label className="label">Email (optional)</label>
            <input className="input" type="email" placeholder="staff@company.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
          {customers.length > 0 && (
            <div>
              <label className="label">Assign Customers ({form.customers.length} selected)</label>
              <div className="max-h-40 overflow-y-auto space-y-1 border border-dark-50 rounded-xl p-2 bg-dark-200">
                {customers.map(c => (
                  <label key={c.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-dark-100/50 cursor-pointer">
                    <input type="checkbox" checked={form.customers.includes(c.id)} onChange={() => toggleCustomer(c.id)} className="accent-gold w-3.5 h-3.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-xs font-medium truncate">{c.name}</p>
                      <p className="text-white/30 text-[10px]">{c.phone}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </form>
        <div className="px-6 pb-6 flex gap-3 flex-shrink-0">
          <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button type="button" onClick={doSubmit} disabled={loading} className="btn-primary flex-1">{loading ? 'Creating...' : 'Create Staff'}</button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

// ── Reset Password Modal ───────────────────────────────────────────────────────
function ResetPasswordModal({ staff, onClose, onSaved }: { staff: Staff; onClose: () => void; onSaved?: () => void }) {
  // Kiosk-created staff get a `kiosk_<timestamp>` placeholder phone — that's not
  // a real login identifier, so don't prefill it; make the admin set a number.
  const isPlaceholderPhone = /^kiosk_\d+$/.test(staff.phone || '');
  const [phone, setPhone]       = useState(isPlaceholderPhone ? '' : (staff.phone || ''));
  const [newPassword, setNewPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [done, setDone]         = useState(false);
  const [error, setError]       = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const phoneTrim = phone.trim();
    if (!phoneTrim) { setError('Login phone number is required'); return; }
    if (newPassword.length < 6) { setError('Password must be at least 6 characters'); return; }
    setLoading(true); setError('');
    try {
      // One call sets BOTH the login phone and the (hashed) password.
      await staffAPI.update(staff.id, { phone: phoneTrim, password: newPassword });
      setDone(true);
      onSaved?.();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed');
    } finally { setLoading(false); }
  };

  return (
    <Portal>
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4 animate-fade-in">
      <div className="bg-dark-300 border border-dark-50 rounded-t-2xl sm:rounded-2xl w-full max-w-sm shadow-2xl animate-slide-up sm:animate-scale-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-50">
          <div>
            <h2 className="text-white font-semibold text-sm">Login Credentials</h2>
            <p className="text-white/30 text-xs mt-0.5">{staff.name}</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X size={16} /></button>
        </div>
        <div className="p-5">
          {done ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-full bg-green-500/15 border border-green-500/25 flex items-center justify-center mx-auto mb-3">
                <KeyRound size={20} className="text-green-400" />
              </div>
              <p className="text-white font-medium">Credentials Set!</p>
              <p className="text-white/40 text-sm mt-1">{staff.name} can log in with <span className="text-white/70 font-semibold">{phone.trim()}</span>.</p>
              <button onClick={onClose} className="btn-primary mt-4 w-full">Done</button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {error && <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-4 py-3 text-sm">{error}</div>}
              {isPlaceholderPhone && (
                <div className="bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-xl px-4 py-2.5 text-xs">
                  Created at the kiosk — no login phone yet. Set one below so they can sign in.
                </div>
              )}
              <div>
                <label className="label">Login Phone</label>
                <input className="input" type="tel" placeholder="9876543210"
                  value={phone} onChange={e => setPhone(e.target.value)} />
                <p className="text-white/25 text-[10px] mt-1">The number they sign in with.</p>
              </div>
              <div>
                <label className="label">New Password</label>
                <div className="relative">
                  <input className="input pr-10" type={showPass ? 'text' : 'password'}
                    placeholder="Min 6 characters" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                  <button type="button" onClick={() => setShowPass(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60">
                    {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancel</button>
                <button type="submit" disabled={loading} className="btn-primary flex-1">{loading ? 'Saving...' : 'Save'}</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
    </Portal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function StaffPage() {
  const [staff, setStaff]         = useState<Staff[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch]       = useState('');
  const [showModal, setShowModal] = useState(false);
  const [resetting, setResetting] = useState<Staff | null>(null);
  const [loading, setLoading]     = useState(true);
  const [today, setToday]         = useState<Record<string, { status: string; isLate: boolean }>>({});
  const [filter, setFilter]       = useState<'all' | 'absent' | 'dups' | 'kiosk'>('all');
  const navigate = useNavigate();

  const load = async () => {
    const [s, c, t] = await Promise.all([
      staffAPI.list(),
      customersAPI.list(),
      attendanceAPI.today().catch(() => [] as { staffId: string; status: string; isLate: boolean }[]),
    ]);
    setStaff(s);
    setCustomers(c.filter((cu: Customer) => !cu.assignedTo));
    const map: Record<string, { status: string; isLate: boolean }> = {};
    for (const r of (t as { staffId: string; status: string; isLate: boolean }[])) {
      map[r.staffId] = { status: r.status, isLate: r.isLate };
    }
    setToday(map);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // Today's attendance state for one staff → present / late / absent.
  const attKey = (s: Staff): AttKey => {
    const rec = today[s.id];
    if (!rec || rec.status === 'absent') return 'absent';
    if (rec.isLate) return 'late';
    return 'present';
  };

  // Duplicate name detection — same trimmed/lowercased name on 2+ records
  // (this is how an unrecognised face creates a second ID at the kiosk).
  const nameCounts = staff.reduce<Record<string, number>>((m, s) => {
    const k = (s.name || '').trim().toLowerCase();
    if (k) m[k] = (m[k] || 0) + 1;
    return m;
  }, {});
  const isDup   = (s: Staff) => nameCounts[(s.name || '').trim().toLowerCase()] > 1;
  const isKiosk = (s: Staff) => (s as Staff & { kioskCreated?: boolean }).kioskCreated === true || /^kiosk_\d+$/.test(s.phone || '');

  const absentCount = staff.filter(s => attKey(s) === 'absent').length;
  const dupCount    = staff.filter(isDup).length;
  const kioskCount  = staff.filter(isKiosk).length;

  const filtered = staff.filter(s => {
    const matchesSearch = s.name.toLowerCase().includes(search.toLowerCase()) || s.phone.includes(search);
    if (!matchesSearch) return false;
    if (filter === 'absent') return attKey(s) === 'absent';
    if (filter === 'dups')   return isDup(s);
    if (filter === 'kiosk')  return isKiosk(s);
    return true;
  });

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this staff member? This cannot be undone.')) return;
    await staffAPI.delete(id);
    setStaff(s => s.filter(x => x.id !== id));
  };

  if (loading) return <div className="space-y-4">{Array(4).fill(0).map((_, i) => <div key={i} className="card h-20 shimmer" />)}</div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Staff</h1>
          <p className="text-white/30 text-sm mt-1">{staff.length} team members</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2 flex-shrink-0">
          <Plus size={16} /><span className="hidden sm:inline">Add Staff</span>
        </button>
      </div>

      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
        <input type="text" placeholder="Search by name or phone..." value={search}
          onChange={e => setSearch(e.target.value)} className="input pl-10" />
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        {([
          { key: 'all',    label: 'All',             count: staff.length, tone: 'gold'  },
          { key: 'absent', label: 'Absent today',    count: absentCount,  tone: 'red'   },
          { key: 'dups',   label: 'Duplicate names', count: dupCount,     tone: 'amber' },
          { key: 'kiosk',  label: 'Kiosk-made',      count: kioskCount,   tone: 'amber' },
        ] as const).map(({ key, label, count, tone }) => {
          const active = filter === key;
          const toneCls = tone === 'red'
            ? (active ? 'bg-red-500/20 text-red-300 border-red-500/40' : 'text-red-300/70 border-red-500/20 hover:bg-red-500/10')
            : tone === 'amber'
            ? (active ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'text-amber-300/70 border-amber-500/20 hover:bg-amber-500/10')
            : (active ? 'bg-gold/20 text-gold border-gold/40' : 'text-white/45 border-dark-100 hover:bg-white/5');
          return (
            <button key={key} onClick={() => setFilter(key)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${toneCls}`}>
              {label}{key !== 'all' && count > 0 ? <span className="ml-1 opacity-80">· {count}</span> : ''}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="card flex flex-col items-center py-16 text-center">
          <Users size={40} className="text-white/10 mb-4" />
          <p className="text-white/40 font-medium">No staff found</p>
          <button onClick={() => setShowModal(true)} className="btn-primary mt-4">Add Staff</button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(s => (
            <div key={s.id} className="card group flex items-center gap-4 cursor-pointer" onClick={() => navigate(`/staff/${s.id}`)}>
              <div className="w-10 h-10 rounded-full bg-gold/15 border border-gold/25 flex items-center justify-center flex-shrink-0 transition-all duration-300 group-hover:shadow-[0_0_16px_rgba(212,175,55,0.65)]" style={{ boxShadow: '0 0 10px rgba(212,175,55,0.4)' }}>
                <span className="text-gold font-bold text-sm">{s.avatar}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Attendance indicator dot — green present · blue late · red absent */}
                  {(() => {
                    const cfg = ATT_STATUS[attKey(s)];
                    return (
                      <span className={`flex items-center gap-1.5 text-xs font-semibold ${cfg.color}`} title={`Today: ${cfg.label}`}>
                        <span className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} style={{ boxShadow: cfg.glow }} />
                        {cfg.label}
                      </span>
                    );
                  })()}
                  <p className="text-white font-semibold">{s.name}</p>
                  {isDup(s) && <span className="badge badge-red flex-shrink-0" title="Another staff record shares this name">Duplicate</span>}
                  {isKiosk(s) && <span className="badge badge-gold flex-shrink-0" title="Created at the attendance kiosk">Kiosk</span>}
                  {!s.active && <span className="badge badge-gray flex-shrink-0">Inactive</span>}
                  {/^kiosk_\d+$/.test(s.phone || '') && (
                    <span className="badge badge-gold flex-shrink-0">Set login</span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  <span className="text-white/30 text-xs flex items-center gap-1"><Phone size={10} />{/^kiosk_\d+$/.test(s.phone || '') ? 'No login phone' : s.phone}</span>
                  <span className="text-white/20 text-xs flex items-center gap-1"><Calendar size={10} />{new Date(s.joinDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</span>
                  {s.streakData?.currentStreak != null && s.streakData.currentStreak > 0 && (
                    <span className="text-gold/70 text-xs flex items-center gap-1">
                      <Flame size={10} className="drop-shadow-[0_0_6px_rgba(212,175,55,0.7)]" />
                      {s.streakData.currentStreak}d streak
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                <button onClick={() => setResetting(s)} className="p-2 rounded-lg hover:bg-gold/10 text-white/20 hover:text-gold transition-colors" title="Set login credentials">
                  <KeyRound size={14} />
                </button>
                <button onClick={() => handleDelete(s.id)} className="p-2 rounded-lg hover:bg-red-500/10 text-white/20 hover:text-red-400 transition-colors">
                  <Trash2 size={14} />
                </button>
                <ChevronRight size={16} className="text-white/20 group-hover:text-gold transition-colors" />
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && <AddStaffModal customers={customers} onClose={() => setShowModal(false)} onCreated={s => { setStaff(p => [...p, s]); setShowModal(false); }} />}
      {resetting && <ResetPasswordModal staff={resetting} onClose={() => setResetting(null)} onSaved={load} />}
    </div>
  );
}
