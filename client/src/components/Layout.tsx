import { Outlet, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Sidebar, { MobileMenuButton } from './Sidebar';
import KamalAssistant from './KamalAssistant';
import NotificationsBell from './NotificationsBell';
import { tasksAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { CheckCircle, X, Calendar, AlertTriangle } from 'lucide-react';
import type { Task } from '../types';

// ── Task reminder popup shown once per session on login ───────────────────────
function TaskReminderModal({ tasks, onClose }: { tasks: Task[]; onClose: () => void }) {
  const navigate  = useNavigate();
  const today     = new Date().toISOString().split('T')[0];
  const overdue   = tasks.filter(t => t.dueDate < today);
  const dueToday  = tasks.filter(t => t.dueDate === today);

  const go = () => { onClose(); navigate('/tasks'); };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4 animate-fade-in">
      <div className="bg-dark-300 border border-dark-50 rounded-2xl w-full max-w-sm shadow-2xl animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-50">
          <div className="flex items-center gap-2">
            {overdue.length > 0
              ? <AlertTriangle size={16} className="text-red-400" />
              : <Calendar size={16} className="text-gold" />}
            <span className="text-white font-semibold text-sm">
              {overdue.length > 0 ? 'Overdue Tasks' : 'Tasks Due Today'}
            </span>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Task list */}
        <div className="px-5 py-4 space-y-2 max-h-64 overflow-y-auto">
          {overdue.length > 0 && (
            <p className="text-red-400/70 text-[10px] uppercase tracking-wider font-medium mb-2">
              {overdue.length} overdue
            </p>
          )}
          {overdue.map(t => (
            <div key={t.id} className="flex items-start gap-2 p-2.5 rounded-xl bg-red-500/8 border border-red-500/20">
              <AlertTriangle size={11} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-white text-xs font-medium leading-snug">{t.title}</p>
                {t.customerName && <p className="text-white/30 text-[10px]">{t.customerName}</p>}
                <p className="text-red-400/60 text-[10px]">Due: {new Date(t.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
              </div>
            </div>
          ))}
          {dueToday.length > 0 && (
            <p className="text-gold/60 text-[10px] uppercase tracking-wider font-medium mt-3 mb-2">
              {dueToday.length} due today
            </p>
          )}
          {dueToday.map(t => (
            <div key={t.id} className="flex items-start gap-2 p-2.5 rounded-xl bg-gold/5 border border-gold/20">
              <Calendar size={11} className="text-gold flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-white text-xs font-medium leading-snug">{t.title}</p>
                {t.customerName && <p className="text-white/30 text-[10px]">{t.customerName}</p>}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 pb-5">
          <button onClick={onClose} className="btn-ghost flex-1 text-sm py-2">Dismiss</button>
          <button onClick={go} className="btn-primary flex-1 flex items-center justify-center gap-1.5 text-sm py-2">
            <CheckCircle size={13} /> View Tasks
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Layout() {
  const [mobileOpen,   setMobileOpen]   = useState(false);
  const [pendingTasks, setPendingTasks] = useState<Task[]>([]);
  const [showReminder, setShowReminder] = useState(false);
  const { user } = useAuth();

  // Show task reminder once per browser session (sessionStorage flag prevents re-show on navigation)
  useEffect(() => {
    if (!user) return;
    const key = `kk_tasknotif_${user.id}`;
    if (sessionStorage.getItem(key)) return; // already shown this session
    sessionStorage.setItem(key, '1');

    const today = new Date().toISOString().split('T')[0];
    tasksAPI.list({ staffId: user.role === 'staff' ? user.id : undefined })
      .then((tasks: Task[]) => {
        const pending = tasks.filter(t =>
          !t.completed && t.dueDate && t.dueDate <= today
        );
        if (pending.length > 0) {
          setPendingTasks(pending);
          setShowReminder(true);
        }
      })
      .catch(() => {});
  }, [user?.id]);

  return (
    <div className="flex h-screen bg-dark-500 overflow-hidden">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-dark-50 bg-dark-400 flex-shrink-0">
          <MobileMenuButton onClick={() => setMobileOpen(true)} />
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-gold flex items-center justify-center">
              <span className="text-dark-500 font-black text-[10px]">K</span>
            </div>
            <span className="text-white font-bold text-sm">Kaamkaro AI</span>
          </div>
          <NotificationsBell />
        </header>

        {/* Desktop header — notifications only */}
        <div className="hidden lg:flex items-center justify-end px-8 py-3 border-b border-dark-50/30 bg-dark-400 flex-shrink-0">
          <NotificationsBell />
        </div>

        <main className="flex-1 overflow-y-auto bg-dark-500">
          {/* pb-28 on mobile gives clearance for Kamal button + iOS home bar */}
          <div className="p-4 pb-28 sm:pb-6 md:p-6 lg:p-8 max-w-7xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Kamal floating AI assistant */}
      <KamalAssistant />

      {/* Task reminder modal — shown once per session if there are due/overdue tasks */}
      {showReminder && (
        <TaskReminderModal
          tasks={pendingTasks}
          onClose={() => setShowReminder(false)}
        />
      )}
    </div>
  );
}
