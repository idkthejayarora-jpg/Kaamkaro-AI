import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Bell, AlertTriangle, Clock, Flame, CheckCircle, X,
  TrendingDown, ShieldAlert, MessageSquare, ChevronDown,
  ChevronUp, Phone, ExternalLink, User, Calendar,
} from 'lucide-react';
import { aiAPI, customersAPI, staffAPI, tasksAPI, broadcastAPI, interactionsAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useSSE } from '../hooks/useSSE';
import { useNavigate } from 'react-router-dom';
import type { Interaction } from '../types';

// ── Types ─────────────────────────────────────────────────────────────────────

function getBcastReadSet(userId: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(`kk_bcast_read_${userId}`) || '[]')); }
  catch { return new Set(); }
}

interface Notification {
  id: string;
  type: 'overdue' | 'task_due' | 'streak_at_risk' | 'well_done' | 'critical' | 'warning' | 'info';
  title: string;
  body: string;
  href?: string;
  modalKey?: 'very_overdue' | 'overdue_7' | 'all_overdue'; // open customer modal instead of navigating
  read: boolean;
}

interface StaleCustomer {
  id: string;
  name: string;
  phone: string;
  status: string;
  assignedTo: string | null;
  assignedStaffName: string;
  lastContact: string | null;
  daysSilent: number;
}

const TYPE_CONFIG: Record<Notification['type'], { icon: React.ElementType; color: string; bg: string }> = {
  critical:       { icon: ShieldAlert,   color: 'text-red-400',    bg: 'bg-red-500/10'    },
  overdue:        { icon: AlertTriangle, color: 'text-red-400',    bg: 'bg-red-500/10'    },
  warning:        { icon: TrendingDown,  color: 'text-orange-400', bg: 'bg-orange-500/10' },
  task_due:       { icon: Clock,         color: 'text-orange-400', bg: 'bg-orange-500/10' },
  streak_at_risk: { icon: Flame,         color: 'text-gold',       bg: 'bg-gold/10'       },
  info:           { icon: MessageSquare, color: 'text-amber-400',  bg: 'bg-amber-500/10'  },
  well_done:      { icon: CheckCircle,   color: 'text-green-400',  bg: 'bg-green-500/10'  },
};

const LS_KEY = 'kk_notif_read';
function getReadSet(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]')); }
  catch { return new Set(); }
}

function fmtDate(iso: string | null) {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// ── Stale customers modal ─────────────────────────────────────────────────────

function StaleCustomersModal({
  customers, onClose,
}: { customers: StaleCustomer[]; onClose: () => void }) {
  const navigate = useNavigate();
  const [expandedId,    setExpandedId]    = useState<string | null>(null);
  const [interactions,  setInteractions]  = useState<Record<string, Interaction[]>>({});
  const [loadingId,     setLoadingId]     = useState<string | null>(null);

  const toggle = useCallback(async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (interactions[id]) return; // already loaded
    setLoadingId(id);
    try {
      const data = await interactionsAPI.list({ customerId: id });
      setInteractions(prev => ({ ...prev, [id]: data }));
    } catch { /* non-fatal */ }
    finally { setLoadingId(null); }
  }, [expandedId, interactions]);

  const typeIcon: Record<string, string> = { call: '📞', meeting: '🤝', email: '📧', message: '💬', diary: '📓' };

  // Sort: longest silent first
  const sorted = [...customers].sort((a, b) => b.daysSilent - a.daysSilent);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in"
      style={{ background: 'rgba(0,0,0,0.70)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}>
      <div
        className="relative w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl bg-dark-300 border border-white/[0.09] shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08] flex-shrink-0">
          <div>
            <h2 className="text-white font-bold text-base flex items-center gap-2">
              <AlertTriangle size={15} className="text-red-400" />
              {customers.length} Customers Not Contacted
            </h2>
            <p className="text-white/30 text-xs mt-0.5">No interaction logged in the last 7+ days</p>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto divide-y divide-white/[0.06]">
          {sorted.map(c => {
            const isExpanded = expandedId === c.id;
            const ixns       = interactions[c.id] || [];
            const isLoading  = loadingId === c.id;

            return (
              <div key={c.id}>
                {/* Customer row */}
                <div className={`px-5 py-3.5 transition-colors ${isExpanded ? 'bg-white/[0.03]' : 'hover:bg-white/[0.02]'}`}>
                  <div className="flex items-start gap-3">
                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-red-400 text-sm font-bold">{c.name[0]}</span>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white/85 text-sm font-medium">{c.name}</span>
                        <span className={`text-[10px] px-1.5 py-px rounded-full border ${
                          c.daysSilent >= 30
                            ? 'bg-red-500/15 text-red-400 border-red-500/25'
                            : 'bg-amber-500/15 text-amber-400 border-amber-500/25'
                        }`}>
                          {c.daysSilent}d silent
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
                        <span className="text-white/30 text-xs flex items-center gap-1">
                          <Phone size={9}/>{c.phone}
                        </span>
                        {c.assignedStaffName && (
                          <span className="text-white/25 text-xs flex items-center gap-1">
                            <User size={9}/>{c.assignedStaffName}
                          </span>
                        )}
                        <span className="text-white/20 text-xs flex items-center gap-1">
                          <Calendar size={9}/>Last: {fmtDate(c.lastContact)}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => { onClose(); navigate(`/customers`); }}
                        className="p-1.5 rounded-lg text-white/20 hover:text-gold hover:bg-gold/10 transition-colors"
                        title="View customer"
                      >
                        <ExternalLink size={12} />
                      </button>
                      <button
                        onClick={() => toggle(c.id)}
                        className="p-1.5 rounded-lg text-white/20 hover:text-white hover:bg-white/[0.07] transition-colors"
                        title={isExpanded ? 'Collapse' : 'Show past interactions'}
                      >
                        {isExpanded ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded interaction history */}
                {isExpanded && (
                  <div className="px-5 pb-4 bg-dark-400/40">
                    <p className="text-white/25 text-[10px] font-semibold uppercase tracking-widest mb-2.5 mt-1">
                      Past Interactions
                    </p>

                    {isLoading && (
                      <div className="flex items-center gap-2 py-3">
                        <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                        <span className="text-white/30 text-xs">Loading…</span>
                      </div>
                    )}

                    {!isLoading && ixns.length === 0 && (
                      <p className="text-white/20 text-xs italic py-2">No interactions on record</p>
                    )}

                    {!isLoading && ixns.length > 0 && (
                      <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                        {ixns.slice(0, 20).map(ix => (
                          <div key={ix.id} className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                            {/* Row 1: type + responded + time */}
                            <div className="flex items-center gap-2 flex-wrap mb-1.5">
                              <span className="text-sm leading-none">{typeIcon[ix.type] || '📞'}</span>
                              <span className="text-white/60 text-xs font-medium capitalize">{ix.type}</span>
                              <span className={`text-[10px] px-1.5 py-px rounded-full border ${
                                ix.responded
                                  ? 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20'
                                  : 'bg-red-400/10 text-red-400 border-red-400/20'
                              }`}>
                                {ix.responded ? 'Responded' : 'No response'}
                              </span>
                              <span className="ml-auto text-white/20 text-[10px]">
                                {new Date(ix.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                {' · '}{fmtTime(ix.createdAt)}
                              </span>
                            </div>
                            {/* Staff name */}
                            {ix.staffName && (
                              <p className="text-white/25 text-[10px] mb-1.5 flex items-center gap-1">
                                <User size={8}/>{ix.staffName}
                              </p>
                            )}
                            {/* Raw notes — full, unclipped */}
                            {ix.notes ? (
                              <p className="text-white/65 text-xs leading-relaxed whitespace-pre-wrap break-words">
                                {ix.notes}
                              </p>
                            ) : (
                              <p className="text-white/15 text-xs italic">No notes</p>
                            )}
                          </div>
                        ))}
                        {ixns.length > 20 && (
                          <p className="text-white/20 text-xs text-center py-1">Showing 20 of {ixns.length}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-white/[0.08] flex items-center justify-between flex-shrink-0">
          <span className="text-white/20 text-xs">{customers.length} customers need follow-up</span>
          <button
            onClick={() => { onClose(); navigate('/followup'); }}
            className="text-xs text-gold hover:text-gold/80 transition-colors flex items-center gap-1"
          >
            Open Follow-up Queue <ExternalLink size={10}/>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main bell component ────────────────────────────────────────────────────────

export default function NotificationsBell() {
  const [open, setOpen]     = useState(false);
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [staleModal, setStaleModal] = useState<StaleCustomer[] | null>(null);
  const { user, isAdmin }   = useAuth();
  const navigate            = useNavigate();
  const ref                 = useRef<HTMLDivElement>(null);

  // Stale customers stored for modal
  const staleCustomersRef = useRef<StaleCustomer[]>([]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  useEffect(() => {
    if (!loaded) { buildNotifications(); setLoaded(true); }
  }, []);

  useSSE(isAdmin ? {
    'customer:created':    () => buildNotifications(),
    'interaction:created': () => buildNotifications(),
  } : {
    'admin:broadcast': () => buildNotifications(),
    'task:created':    () => buildNotifications(),
    'task:updated':    () => buildNotifications(),
  });

  const buildAdminNotifications = async () => {
    const now = Date.now();
    const [summary, customers, staff] = await Promise.all([
      aiAPI.dashboardSummary(),
      customersAPI.list().catch(() => []),
      staffAPI.list().catch(() => []),
    ]);

    // Build staff name lookup
    const staffMap: Record<string, string> = Object.fromEntries(
      (staff as { id: string; name: string }[]).map(s => [s.id, s.name])
    );

    // Compute all stale customers (7+ days no contact) with enriched data
    const allStale = (customers as {
      id: string; name: string; phone: string; status: string;
      assignedTo: string | null; lastContact: string | null;
    }[]).filter(c => {
      if (c.status === 'closed' || c.status === 'churned') return false;
      if (!c.lastContact) return true;
      return now - new Date(c.lastContact).getTime() > 7 * 86400000;
    }).map(c => ({
      id:                c.id,
      name:              c.name,
      phone:             c.phone,
      status:            c.status,
      assignedTo:        c.assignedTo,
      assignedStaffName: c.assignedTo ? (staffMap[c.assignedTo] || 'Unknown') : 'Unassigned',
      lastContact:       c.lastContact,
      daysSilent:        c.lastContact
        ? Math.floor((now - new Date(c.lastContact).getTime()) / 86400000)
        : 999,
    }));

    // Store for modal access
    staleCustomersRef.current = allStale;

    const veryOverdue = allStale.filter(c => c.daysSilent >= 30);
    const stdOverdue  = allStale.filter(c => c.daysSilent >= 7 && c.daysSilent < 30);

    const items: Notification[] = [];

    if (veryOverdue.length > 0) {
      items.push({
        id: 'very_overdue',
        type: 'critical',
        title: `${veryOverdue.length} customer${veryOverdue.length > 1 ? 's' : ''} silent 30+ days`,
        body: 'Click to see who — serious churn risk.',
        modalKey: 'very_overdue',
        read: false,
      });
    }

    const churned = (customers as { status: string }[]).filter(c => c.status === 'churned');
    if (churned.length > 0) {
      items.push({
        id: 'churned',
        type: 'critical',
        title: `${churned.length} churned customer${churned.length > 1 ? 's' : ''}`,
        body: 'Review and consider win-back actions.',
        href: '/customers',
        read: false,
      });
    }

    if (stdOverdue.length > 0) {
      items.push({
        id: 'overdue_7',
        type: 'overdue',
        title: `${stdOverdue.length} customer${stdOverdue.length > 1 ? 's' : ''} not contacted in 7+ days`,
        body: 'Click to see who — assign follow-ups.',
        modalKey: 'overdue_7',
        read: false,
      });
    }

    if (summary.dueTasksCount > 0) {
      items.push({
        id: 'tasks_overdue',
        type: 'task_due',
        title: `${summary.dueTasksCount} task${summary.dueTasksCount > 1 ? 's' : ''} due or overdue`,
        body: 'Pending tasks across all staff. Use Tasks to review.',
        href: '/tasks',
        read: false,
      });
    }

    if (items.length === 0) {
      items.push({
        id: 'admin_all_good',
        type: 'well_done',
        title: 'No critical alerts',
        body: 'All customers are being followed up.',
        read: true,
      });
    }

    const readSet = getReadSet();
    setNotifs(items.map(n => ({ ...n, read: readSet.has(n.id) })));
  };

  const buildStaffNotifications = async () => {
    const [myTasks, broadcasts] = await Promise.all([
      tasksAPI.list({ completed: false }).catch(() => []),
      broadcastAPI.list().catch(() => []),
    ]) as [{ dueDate: string; title: string }[], { id: string; message: string; sentBy: string; sentAt: string }[]];

    const today = new Date().toISOString().split('T')[0];
    const overdueTasks   = myTasks.filter(t => t.dueDate < today);
    const dueTodayTasks  = myTasks.filter(t => t.dueDate === today);
    const items: Notification[] = [];

    const readSet2 = getBcastReadSet(user?.id || '');
    const unreadBcasts = broadcasts.filter(b => !readSet2.has(b.id));
    if (unreadBcasts.length > 0) {
      items.push({
        id: 'broadcasts',
        type: 'info',
        title: `${unreadBcasts.length} unread announcement${unreadBcasts.length > 1 ? 's' : ''}`,
        body: unreadBcasts[0].message.slice(0, 80) + (unreadBcasts[0].message.length > 80 ? '…' : ''),
        href: '/',
        read: false,
      });
    }

    if (overdueTasks.length > 0) {
      items.push({
        id: 'my_overdue_tasks',
        type: 'overdue',
        title: `${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''}`,
        body: overdueTasks.slice(0, 2).map(t => t.title).join(', ') + (overdueTasks.length > 2 ? ` +${overdueTasks.length - 2} more` : ''),
        href: '/tasks',
        read: false,
      });
    }

    if (dueTodayTasks.length > 0) {
      items.push({
        id: 'my_today_tasks',
        type: 'task_due',
        title: `${dueTodayTasks.length} task${dueTodayTasks.length > 1 ? 's' : ''} due today`,
        body: dueTodayTasks.slice(0, 2).map(t => t.title).join(', '),
        href: '/tasks',
        read: false,
      });
    }

    if (items.length === 0) {
      items.push({
        id: 'all_good',
        type: 'well_done',
        title: 'All caught up!',
        body: 'No overdue tasks. Great work.',
        read: true,
      });
    }

    const readSet = getReadSet();
    setNotifs(items.map(n => ({ ...n, read: readSet.has(n.id) })));
  };

  const buildNotifications = async () => {
    try {
      if (isAdmin) await buildAdminNotifications();
      else         await buildStaffNotifications();
    } catch { /* non-fatal */ }
  };

  const markRead = (id: string) => {
    const s = getReadSet();
    s.add(id);
    localStorage.setItem(LS_KEY, JSON.stringify([...s]));
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const markAllRead = () => {
    const ids = notifs.map(n => n.id);
    localStorage.setItem(LS_KEY, JSON.stringify(ids));
    setNotifs(prev => prev.map(n => ({ ...n, read: true })));
  };

  const handleNotifClick = (n: Notification) => {
    markRead(n.id);
    if (n.modalKey) {
      // Show stale customers modal filtered to the right window
      const all = staleCustomersRef.current;
      const filtered = n.modalKey === 'very_overdue'
        ? all.filter(c => c.daysSilent >= 30)
        : all.filter(c => c.daysSilent >= 7);
      setStaleModal(filtered);
      setOpen(false);
    } else if (n.href) {
      navigate(n.href);
      setOpen(false);
    }
  };

  const unread = notifs.filter(n => !n.read).length;

  return (
    <>
      <div className="relative" ref={ref}>
        <button
          onClick={() => { setOpen(o => !o); if (!loaded) { buildNotifications(); setLoaded(true); } }}
          className="relative p-2 rounded-lg hover:bg-dark-50 text-white/40 hover:text-white transition-colors"
          title={isAdmin ? 'Critical alerts' : 'Notifications'}
        >
          <Bell size={18} />
          {unread > 0 && (
            <span className={`absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white ${
              isAdmin && notifs.some(n => !n.read && n.type === 'critical') ? 'bg-red-500 animate-pulse' : 'bg-red-500'
            }`}>
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 w-80 bg-dark-300 border border-dark-50 rounded-2xl shadow-2xl z-50 overflow-hidden animate-slide-up">
            <div className="flex items-center justify-between px-4 py-3 border-b border-dark-50">
              <div>
                <p className="text-white font-semibold text-sm">
                  {isAdmin ? 'Critical Alerts' : 'Notifications'}
                </p>
                {isAdmin && (
                  <p className="text-white/30 text-[10px] mt-0.5">Click red alerts to see customer list</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {unread > 0 && (
                  <button onClick={markAllRead} className="text-white/30 hover:text-white text-xs transition-colors">
                    Clear all
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="text-white/30 hover:text-white">
                  <X size={14} />
                </button>
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto">
              {notifs.length === 0 ? (
                <div className="py-8 text-center text-white/25 text-sm">No alerts</div>
              ) : (
                notifs.map(n => {
                  const cfg  = TYPE_CONFIG[n.type];
                  const Icon = cfg.icon;
                  const isClickable = !!(n.href || n.modalKey);
                  return (
                    <div
                      key={n.id}
                      className={`flex gap-3 px-4 py-3 border-b border-dark-50/50 last:border-0 transition-colors ${
                        isClickable ? 'cursor-pointer hover:bg-dark-200/50' : ''
                      } ${n.read ? 'opacity-50' : ''}`}
                      onClick={() => isClickable && handleNotifClick(n)}
                    >
                      <div className={`w-7 h-7 rounded-full ${cfg.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                        <Icon size={13} className={cfg.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium leading-snug ${n.read ? 'text-white/40' : 'text-white'}`}>{n.title}</p>
                        <p className="text-white/30 text-xs mt-0.5 leading-relaxed">{n.body}</p>
                        {n.modalKey && !n.read && (
                          <p className="text-red-400/60 text-[10px] mt-1 flex items-center gap-1">
                            <ChevronDown size={9}/> Click to see customers
                          </p>
                        )}
                      </div>
                      {!n.read && (
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${
                          n.type === 'critical' ? 'bg-red-500' : 'bg-gold'
                        }`} />
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {isAdmin && (
              <div className="px-4 py-2.5 border-t border-dark-50 bg-dark-400/50">
                <button
                  onClick={() => buildNotifications()}
                  className="text-white/30 hover:text-white text-xs transition-colors"
                >
                  Refresh alerts
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stale customers modal — rendered outside the dropdown */}
      {staleModal && (
        <StaleCustomersModal
          customers={staleModal}
          onClose={() => setStaleModal(null)}
        />
      )}
    </>
  );
}
