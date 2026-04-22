import { useEffect, useState } from 'react';
import { Clock, AlertTriangle, Calendar, Phone, MessageSquare, Mail, ChevronRight } from 'lucide-react';
import { customersAPI, staffAPI, interactionsAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { Customer, Staff, Interaction } from '../types';

interface QueueItem {
  customer: Customer;
  daysSinceContact: number | null;
  urgency: 'critical' | 'high' | 'medium' | 'low';
  staffName: string;
  lastType: Interaction['type'] | null;
  followUpTasks: number;
}

function urgencyConfig(u: QueueItem['urgency']) {
  return {
    critical: { label: 'Critical',  color: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20' },
    high:     { label: 'High',      color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
    medium:   { label: 'Medium',    color: 'text-gold',       bg: 'bg-gold/10',       border: 'border-gold/20' },
    low:      { label: 'Low',       color: 'text-white/40',   bg: 'bg-white/5',       border: 'border-dark-50' },
  }[u];
}

function getUrgency(days: number | null, status: string): QueueItem['urgency'] {
  if (days === null) return 'critical'; // never contacted
  if (days > 14 || status === 'negotiating') return 'critical';
  if (days > 7)  return 'high';
  if (days > 3)  return 'medium';
  return 'low';
}

const TYPE_ICON: Record<string, React.ElementType> = { call: Phone, message: MessageSquare, email: Mail, meeting: Calendar };

export default function FollowupQueue() {
  const [queue, setQueue]           = useState<QueueItem[]>([]);
  const [staffList, setStaffList]   = useState<Staff[]>([]);
  const [loading, setLoading]       = useState(true);
  const [urgencyFilter, setUrgency] = useState<QueueItem['urgency'] | 'all'>('all');
  const [staffFilter, setStaffFilter] = useState('all');
  const [logging, setLogging]       = useState<Customer | null>(null);
  const { isAdmin } = useAuth();

  const load = async () => {
    const [customers, staff, interactions] = await Promise.all([
      customersAPI.list(),
      isAdmin ? staffAPI.list() : Promise.resolve([]),
      interactionsAPI.list(),
    ]);
    setStaffList(staff);

    const now = Date.now();
    const items: QueueItem[] = (customers as Customer[])
      .filter((c: Customer) => !['closed', 'churned'].includes(c.status))
      .map((c: Customer) => {
        const days = c.lastContact
          ? Math.round((now - new Date(c.lastContact).getTime()) / 86400000)
          : null;
        const custInteractions = (interactions as Interaction[]).filter(i => i.customerId === c.id);
        const lastInteraction  = custInteractions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        const staffObj = staff.find((s: Staff) => s.id === c.assignedTo);
        return {
          customer: c,
          daysSinceContact: days,
          urgency: getUrgency(days, c.status),
          staffName: staffObj?.name || 'Unassigned',
          lastType: lastInteraction?.type || null,
          followUpTasks: 0,
        };
      })
      .sort((a, b) => {
        const uOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        if (uOrder[a.urgency] !== uOrder[b.urgency]) return uOrder[a.urgency] - uOrder[b.urgency];
        const da = a.daysSinceContact ?? Infinity;
        const db = b.daysSinceContact ?? Infinity;
        return db - da;
      });

    setQueue(items);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = queue.filter(item => {
    const matchU = urgencyFilter === 'all' || item.urgency === urgencyFilter;
    const matchS = staffFilter  === 'all' || item.customer.assignedTo === staffFilter;
    return matchU && matchS;
  });

  const counts = {
    critical: queue.filter(q => q.urgency === 'critical').length,
    high:     queue.filter(q => q.urgency === 'high').length,
    medium:   queue.filter(q => q.urgency === 'medium').length,
    low:      queue.filter(q => q.urgency === 'low').length,
  };

  if (loading) return <div className="space-y-3">{Array(6).fill(0).map((_, i) => <div key={i} className="card h-16 shimmer" />)}</div>;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Clock size={24} className="text-gold" />
          Follow-up Queue
        </h1>
        <p className="text-white/30 text-sm mt-1">{queue.length} customers need attention · sorted by urgency</p>
      </div>

      {/* Urgency summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(['critical', 'high', 'medium', 'low'] as const).map(u => {
          const cfg = urgencyConfig(u);
          return (
            <button
              key={u}
              onClick={() => setUrgency(urgencyFilter === u ? 'all' : u)}
              className={`card text-left transition-all ${urgencyFilter === u ? `${cfg.border} ${cfg.bg}` : ''}`}
            >
              <p className={`text-xl font-black ${cfg.color}`}>{counts[u]}</p>
              <p className="text-white/30 text-xs capitalize mt-0.5">{cfg.label}</p>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        {isAdmin && (
          <select className="input flex-shrink-0 w-auto" value={staffFilter}
            onChange={e => setStaffFilter(e.target.value)}>
            <option value="all">All Staff</option>
            {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      {/* Queue list */}
      {filtered.length === 0 ? (
        <div className="card flex flex-col items-center py-16 text-center">
          <Clock size={36} className="text-white/10 mb-4" />
          <p className="text-white/40 font-medium">Queue is clear!</p>
          <p className="text-white/20 text-sm mt-1">All customers are up to date</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(({ customer: c, daysSinceContact, urgency, staffName, lastType }) => {
            const cfg = urgencyConfig(urgency);
            const LastIcon = lastType ? (TYPE_ICON[lastType] || Phone) : AlertTriangle;
            return (
              <div key={c.id} className={`card border ${cfg.border} transition-all`}>
                <div className="flex items-center gap-3">
                  {/* Urgency dot */}
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                    urgency === 'critical' ? 'bg-red-500 animate-pulse' :
                    urgency === 'high'     ? 'bg-orange-500' :
                    urgency === 'medium'   ? 'bg-gold' : 'bg-white/20'
                  }`} />

                  {/* Customer info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-white font-semibold text-sm">{c.name}</p>
                      <span className={`badge ${cfg.bg} ${cfg.color} border border-current/20 text-[10px]`}>{cfg.label}</span>
                      <span className="badge badge-gray text-[10px] capitalize">{c.status}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {isAdmin && <span className="text-gold/50 text-xs">{staffName}</span>}
                      {c.phone && <span className="text-white/30 text-xs">{c.phone}</span>}
                      {lastType && (
                        <span className="text-white/25 text-xs flex items-center gap-1">
                          <LastIcon size={10} />last: {lastType}
                        </span>
                      )}
                      {c.tags.length > 0 && c.tags.slice(0, 2).map(t => (
                        <span key={t} className="badge badge-gold text-[10px]">{t}</span>
                      ))}
                    </div>
                  </div>

                  {/* Days indicator */}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="text-right hidden sm:block">
                      <p className={`font-bold text-sm ${cfg.color}`}>
                        {daysSinceContact === null ? 'Never' : daysSinceContact === 0 ? 'Today' : `${daysSinceContact}d`}
                      </p>
                      <p className="text-white/20 text-[10px]">
                        {daysSinceContact === null ? 'contacted' : 'since contact'}
                      </p>
                    </div>
                    <button
                      onClick={() => setLogging(c)}
                      className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 flex-shrink-0"
                    >
                      <Phone size={11} />Log Now
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Log interaction modal (re-use by navigating to customers page) */}
      {logging && (
        <QuickLogModal
          customer={logging}
          onClose={() => setLogging(null)}
          onLogged={() => { setLogging(null); load(); }}
        />
      )}
    </div>
  );
}

// Quick log modal (stripped-down version for the queue)
function QuickLogModal({ customer, onClose, onLogged }: {
  customer: Customer; onClose: () => void; onLogged: () => void;
}) {
  const [type, setType]       = useState<Interaction['type']>('call');
  const [responded, setResp]  = useState(false);
  const [notes, setNotes]     = useState('');
  const [followUp, setFollowUp] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      await interactionsAPI.create({ customerId: customer.id, type, responded, notes, followUpDate: followUp || null });
      onLogged();
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-dark-300 border border-dark-50 rounded-2xl w-full max-w-sm shadow-2xl animate-slide-up">
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-50">
          <div>
            <p className="text-white font-semibold text-sm">Quick Log</p>
            <p className="text-white/30 text-xs">{customer.name}</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-4 gap-2">
            {(['call', 'message', 'email', 'meeting'] as const).map(t => {
              const I = TYPE_ICON[t] || Phone;
              return (
                <button key={t}
                  onClick={() => setType(t)}
                  className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                    type === t ? 'border-gold bg-gold/10 text-gold' : 'border-dark-50 text-white/40 hover:text-white'
                  }`}
                >
                  <I size={13} />{t}
                </button>
              );
            })}
          </div>
          <div className="flex gap-3">
            {[{ v: true, l: 'Responded ✓' }, { v: false, l: 'No response ✗' }].map(({ v, l }) => (
              <button key={String(v)} onClick={() => setResp(v)}
                className={`flex-1 py-2 rounded-xl border text-sm font-medium transition-all ${
                  responded === v
                    ? v ? 'border-green-500/50 bg-green-500/10 text-green-400' : 'border-red-500/50 bg-red-500/10 text-red-400'
                    : 'border-dark-50 text-white/40 hover:text-white'
                }`}>{l}</button>
            ))}
          </div>
          <textarea className="input resize-none" rows={2} placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
          <input type="date" className="input" value={followUp} min={new Date().toISOString().split('T')[0]} onChange={e => setFollowUp(e.target.value)} placeholder="Follow-up date (optional)" />
        </div>
        <div className="px-5 pb-5 flex gap-3">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button onClick={submit} disabled={loading} className="btn-primary flex-1">
            <ChevronRight size={14} className="mr-1" />{loading ? 'Logging...' : 'Log Interaction'}
          </button>
        </div>
      </div>
    </div>
  );
}
