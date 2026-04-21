import { useEffect, useRef, useState } from 'react';
import { Bell, AlertTriangle, Clock, Flame, CheckCircle, X } from 'lucide-react';
import { aiAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

interface Notification {
  id: string;
  type: 'overdue' | 'task_due' | 'streak_at_risk' | 'well_done';
  title: string;
  body: string;
  href?: string;
  read: boolean;
}

const TYPE_CONFIG = {
  overdue:       { icon: AlertTriangle, color: 'text-red-400',    bg: 'bg-red-500/10' },
  task_due:      { icon: Clock,         color: 'text-orange-400', bg: 'bg-orange-500/10' },
  streak_at_risk:{ icon: Flame,         color: 'text-gold',       bg: 'bg-gold/10' },
  well_done:     { icon: CheckCircle,   color: 'text-green-400',  bg: 'bg-green-500/10' },
};

export default function NotificationsBell() {
  const [open, setOpen]       = useState(false);
  const [notifs, setNotifs]   = useState<Notification[]>([]);
  const [loaded, setLoaded]   = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();
  const ref      = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!loaded) {
      buildNotifications();
      setLoaded(true);
    }
  }, []);

  const buildNotifications = async () => {
    try {
      const summary = await aiAPI.dashboardSummary();
      const items: Notification[] = [];

      if (summary.overdueCount > 0) {
        items.push({
          id: 'overdue',
          type: 'overdue',
          title: `${summary.overdueCount} overdue customers`,
          body: `${summary.overdueCount} customer${summary.overdueCount > 1 ? 's haven\'t' : ' hasn\'t'} been contacted in 7+ days.`,
          href: '/followup',
          read: false,
        });
      }

      if (summary.dueTasksCount > 0) {
        items.push({
          id: 'tasks',
          type: 'task_due',
          title: `${summary.dueTasksCount} task${summary.dueTasksCount > 1 ? 's' : ''} due`,
          body: `You have pending tasks due today or overdue. Stay on top of them!`,
          href: '/tasks',
          read: false,
        });
      }

      if (summary.topStreaker && summary.topStreaker.streak > 0) {
        if (summary.topStreaker.name === user?.name) {
          items.push({
            id: 'streak',
            type: 'well_done',
            title: `${summary.topStreaker.streak}-day streak 🔥`,
            body: 'You\'re on top of the leaderboard! Keep going.',
            href: '/leaderboard',
            read: false,
          });
        }
      }

      if (items.length === 0) {
        items.push({
          id: 'all_good',
          type: 'well_done',
          title: 'All caught up!',
          body: 'No overdue customers or tasks. Great work.',
          read: true,
        });
      }

      // Merge with read state from localStorage
      const readSet = new Set<string>(JSON.parse(localStorage.getItem('kk_notif_read') || '[]'));
      setNotifs(items.map(n => ({ ...n, read: readSet.has(n.id) })));
    } catch {}
  };

  const markRead = (id: string) => {
    const readSet = new Set<string>(JSON.parse(localStorage.getItem('kk_notif_read') || '[]'));
    readSet.add(id);
    localStorage.setItem('kk_notif_read', JSON.stringify([...readSet]));
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const markAllRead = () => {
    const ids = notifs.map(n => n.id);
    localStorage.setItem('kk_notif_read', JSON.stringify(ids));
    setNotifs(prev => prev.map(n => ({ ...n, read: true })));
  };

  const unread = notifs.filter(n => !n.read).length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-lg hover:bg-dark-50 text-white/40 hover:text-white transition-colors"
        title="Notifications"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center text-[9px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-dark-300 border border-dark-50 rounded-2xl shadow-2xl z-50 overflow-hidden animate-slide-up">
          <div className="flex items-center justify-between px-4 py-3 border-b border-dark-50">
            <p className="text-white font-semibold text-sm">Notifications</p>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button onClick={markAllRead} className="text-white/30 hover:text-white text-xs transition-colors">
                  Mark all read
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-white/30 hover:text-white">
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifs.length === 0 ? (
              <div className="py-8 text-center text-white/25 text-sm">No notifications</div>
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
                      <p className={`text-sm font-medium ${n.read ? 'text-white/40' : 'text-white'}`}>{n.title}</p>
                      <p className="text-white/30 text-xs mt-0.5 leading-relaxed">{n.body}</p>
                    </div>
                    {!n.read && (
                      <div className="w-2 h-2 rounded-full bg-gold flex-shrink-0 mt-1.5" />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
