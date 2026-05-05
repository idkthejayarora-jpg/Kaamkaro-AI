import { useEffect, useRef, useState } from 'react';
import {
  Bell, AlertTriangle, Clock, Flame, CheckCircle, X,
  UserMinus, Users, TrendingDown, ShieldAlert, MessageSquare,
} from 'lucide-react';
import { aiAPI, customersAPI, staffAPI, tasksAPI, broadcastAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useSSE } from '../hooks/useSSE';
import { useNavigate } from 'react-router-dom';

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
  read: boolean;
}

const TYPE_CONFIG: Record<Notification['type'], { icon: React.ElementType; color: string; bg: string }> = {
  critical:       { icon: ShieldAlert,    color: 'text-red-400',    bg: 'bg-red-500/10'    },
  overdue:        { icon: AlertTriangle,  color: 'text-red-400',    bg: 'bg-red-500/10'    },
  warning:        { icon: TrendingDown,   color: 'text-orange-400', bg: 'bg-orange-500/10' },
  task_due:       { icon: Clock,          color: 'text-orange-400', bg: 'bg-orange-500/10' },
  streak_at_risk: { icon: Flame,          color: 'text-gold',       bg: 'bg-gold/10'       },
  info:           { icon: MessageSquare,  color: 'text-amber-400',  bg: 'bg-amber-500/10'  },
  well_done:      { icon: CheckCircle,    color: 'text-green-400',  bg: 'bg-green-500/10'  },
};

const LS_KEY = 'kk_notif_read';
function getReadSet(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]')); }
  catch { return new Set(); }
}

export default function NotificationsBell() {
  const [open, setOpen]     = useState(false);
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [loaded, setLoaded] = useState(false);
  const { user, isAdmin }   = useAuth();
  const navigate            = useNavigate();
  const ref                 = useRef<HTMLDivElement>(null);

  // Close on outside click
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

  // Admin: refresh on customer/interaction changes. Staff: refresh on new broadcast.
  useSSE(isAdmin ? {
    'customer:created':    () => buildNotifications(),
    'interaction:created': () => buildNotifications(),
  } : {
    'admin:broadcast': () => buildNotifications(),
    'task:created':    () => buildNotifications(),
    'task:updated':    () => buildNotifications(),
  });

  // ── Admin alert builder ──────────────────────────────────────────────────────
  const buildAdminNotifications = async () => {
    const [summary, customers, staff] = await Promise.all([
      aiAPI.dashboardSummary(),
      customersAPI.list().catch(() => []),
      staffAPI.list().catch(() => []),
    ]);

    const now    = Date.now();
    const items: Notification[] = [];

    // Very overdue customers: 30+ days no contact (critical — red)
    const veryOverdue = (customers as { lastContact: string | null; status: string }[]).filter(c => {
      if (!c.lastContact || c.status === 'closed' || c.status === 'churned') return false;
      return now - new Date(c.lastContact).getTime() > 30 * 86400000;
    });
    if (veryOverdue.length > 0) {
      items.push({
        id: 'very_overdue',
        type: 'critical',
        title: `${veryOverdue.length} customer${veryOverdue.length > 1 ? 's' : ''} silent 30+ days`,
        body: 'These customers have had zero contact for over a month — at serious risk of churning.',
        href: '/followup',
        read: false,
      });
    }

    // Churned customers
    const churned = (customers as { status: string }[]).filter(c => c.status === 'churned');
    if (churned.length > 0) {
      items.push({
        id: 'churned',
        type: 'critical',
        title: `${churned.length} churned customer${churned.length > 1 ? 's' : ''}`,
        body: 'Customers marked as churned. Review and consider win-back actions.',
        href: '/customers',
        read: false,
      });
    }

    // Standard overdue (7–30 days)
    const stdOverdue = summary.overdueCount - veryOverdue.length;
    if (stdOverdue > 0) {
      items.push({
        id: 'overdue_7',
        type: 'overdue',
        title: `${stdOverdue} customer${stdOverdue > 1 ? 's' : ''} overdue 7+ days`,
        body: 'Assign follow-ups or escalate to prevent further churn.',
        href: '/followup',
        read: false,
      });
    }

    // Overdue tasks across all staff
    if (summary.dueTasksCount > 0) {
      items.push({
        id: 'tasks_overdue',
        type: 'task_due',
        title: `${summary.dueTasksCount} task${summary.dueTasksCount > 1 ? 's' : ''} due or overdue`,
        body: 'Pending tasks across all staff. Use the staff filter in Tasks to review.',
        href: '/tasks',
        read: false,
      });
    }

    if (items.length === 0) {
      items.push({
        id: 'admin_all_good',
        type: 'well_done',
        title: 'No critical alerts',
        body: 'All customers are being followed up and staff are active.',
        read: true,
      });
    }

    // Merge with read state
    const readSet = getReadSet();
    setNotifs(items.map(n => ({ ...n, read: readSet.has(n.id) })));
  };

  // ── Staff alert builder — uses staff-scoped APIs only, no admin data ──────────
  const buildStaffNotifications = async () => {
    // Fetch only THIS staff member's data (server scopes these by auth token)
    const [myTasks, broadcasts] = await Promise.all([
      tasksAPI.list({ completed: false }).catch(() => []),
      broadcastAPI.list().catch(() => []),
    ]) as [{ dueDate: string; title: string }[], { id: string; message: string; sentBy: string; sentAt: string }[]];

    const today = new Date().toISOString().split('T')[0];
    const overdueTasks = myTasks.filter((t) => t.dueDate < today);
    const dueTodayTasks = myTasks.filter((t) => t.dueDate === today);
    const items: Notification[] = [];

    // Unread broadcast messages
    const readSet2 = getBcastReadSet(user?.id || '');
    const unreadBcasts = broadcasts.filter((b) => !readSet2.has(b.id));
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

    // MY overdue tasks only
    if (overdueTasks.length > 0) {
      items.push({
        id: 'my_overdue_tasks',
        type: 'overdue',
        title: `${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''}`,
        body: overdueTasks.slice(0, 2).map((t) => t.title).join(', ') + (overdueTasks.length > 2 ? ` +${overdueTasks.length - 2} more` : ''),
        href: '/tasks',
        read: false,
      });
    }

    // MY tasks due today only
    if (dueTodayTasks.length > 0) {
      items.push({
        id: 'my_today_tasks',
        type: 'task_due',
        title: `${dueTodayTasks.length} task${dueTodayTasks.length > 1 ? 's' : ''} due today`,
        body: dueTodayTasks.slice(0, 2).map((t) => t.title).join(', '),
        href: '/tasks',
        read: false,
      });
    }

    if (items.length === 0) {
      items.push({
        id: 'all_good',
        type: 'well_done',
        title: 'All caught up!',
        body: 'No overdue tasks and no unread announcements. Great work.',
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

  const unread = notifs.filter(n => !n.read).length;

  return (
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
                <p className="text-white/30 text-[10px] mt-0.5">Admin-level alerts only</p>
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
                return (
                  <div
                    key={n.id}
                    className={`flex gap-3 px-4 py-3 border-b border-dark-50/50 last:border-0 transition-colors cursor-pointer hover:bg-dark-200/50 ${n.read ? 'opacity-50' : ''}`}
                    onClick={() => {
                      markRead(n.id);
                      if (n.href) { navigate(n.href); setOpen(false); }
                    }}
                  >
                    <div className={`w-7 h-7 rounded-full ${cfg.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                      <Icon size={13} className={cfg.color} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium leading-snug ${n.read ? 'text-white/40' : 'text-white'}`}>{n.title}</p>
                      <p className="text-white/30 text-xs mt-0.5 leading-relaxed">{n.body}</p>
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
                onClick={() => { buildNotifications(); }}
                className="text-white/30 hover:text-white text-xs transition-colors"
              >
                Refresh alerts
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
