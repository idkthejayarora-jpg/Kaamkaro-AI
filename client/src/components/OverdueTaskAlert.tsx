import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, X, ClipboardList, ChevronRight } from 'lucide-react';
import { tasksAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { Task } from '../types';

// One dismissal per browser session — reappears on next page load / login
const SESSION_KEY = 'kk_overdue_dismissed';

function playAlarm() {
  try {
    const AudioCtx = window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();

    // Three sharp descending beeps — urgent but not annoying
    const schedule = [
      { freq: 880, t0: 0.0,  dur: 0.12 },
      { freq: 880, t0: 0.18, dur: 0.12 },
      { freq: 660, t0: 0.36, dur: 0.22 },
    ];

    for (const { freq, t0, dur } of schedule) {
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.type           = 'square';
      osc.frequency.value = freq;
      const start = ctx.currentTime + t0;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.35, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.05);
    }

    setTimeout(() => ctx.close(), 1500);
  } catch { /* audio not supported */ }
}

export default function OverdueTaskAlert() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [tasks,    setTasks]    = useState<Task[]>([]);
  const [visible,  setVisible]  = useState(false);
  const [animated, setAnimated] = useState(false);

  const dismiss = useCallback(() => {
    sessionStorage.setItem(SESSION_KEY, '1');
    setVisible(false);
  }, []);

  useEffect(() => {
    // Only fire for staff (not admin), once per session
    if (isAdmin || !user || sessionStorage.getItem(SESSION_KEY)) return;

    const today = new Date().toISOString().split('T')[0];

    tasksAPI.list({ completed: false }).then((all: Task[]) => {
      const overdue = all.filter(t => t.dueDate && t.dueDate < today);
      if (overdue.length === 0) return;
      setTasks(overdue);
      setVisible(true);
      // Small delay so the page has rendered before the popup + sound fires
      setTimeout(() => {
        setAnimated(true);
        playAlarm();
      }, 600);
    }).catch(() => {});
  }, [user, isAdmin]);

  if (!visible) return null;

  const goToTasks = () => {
    dismiss();
    navigate('/tasks');
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className={`
        w-full max-w-sm bg-dark-300 border border-red-500/60 rounded-2xl shadow-2xl shadow-red-500/20
        transition-all duration-300
        ${animated ? 'scale-100 opacity-100' : 'scale-90 opacity-0'}
      `}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-red-500/10 border-b border-red-500/20 rounded-t-2xl">
          <div className="flex items-center gap-2.5">
            <AlertTriangle size={18} className="text-red-400 animate-pulse flex-shrink-0" />
            <div>
              <p className="text-red-400 font-bold text-sm tracking-wide">Overdue Tasks</p>
              <p className="text-red-400/60 text-[10px]">Action required</p>
            </div>
          </div>
          <button
            onClick={dismiss}
            className="text-white/30 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10"
            title="Dismiss"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <p className="text-white text-sm font-medium mb-1">
            You have <span className="text-red-400 font-bold">{tasks.length}</span> overdue task{tasks.length !== 1 ? 's' : ''}
          </p>
          <p className="text-white/40 text-xs mb-4">
            Complete them to avoid merit point penalties.
          </p>

          <div className="space-y-2 max-h-48 overflow-y-auto">
            {tasks.slice(0, 6).map(t => {
              const daysOver = Math.round((Date.now() - new Date(t.dueDate).getTime()) / 86400000);
              return (
                <div key={t.id} className="flex items-start gap-2.5 p-2.5 rounded-xl bg-red-500/5 border border-red-500/15">
                  <ClipboardList size={13} className="text-red-400/70 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-medium truncate">{t.title}</p>
                    {t.customerName && (
                      <p className="text-white/30 text-[10px] truncate">{t.customerName}</p>
                    )}
                  </div>
                  <span className="text-red-400 text-[10px] font-bold flex-shrink-0 bg-red-500/10 px-1.5 py-0.5 rounded-md">
                    {daysOver}d late
                  </span>
                </div>
              );
            })}
            {tasks.length > 6 && (
              <p className="text-white/25 text-[10px] text-center pt-1">
                + {tasks.length - 6} more
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="px-5 pb-5 flex gap-2.5">
          <button
            onClick={dismiss}
            className="flex-1 py-2 rounded-xl border border-dark-50 text-white/40 hover:text-white hover:border-white/20 text-sm font-medium transition-colors"
          >
            Dismiss
          </button>
          <button
            onClick={goToTasks}
            className="flex-1 py-2 rounded-xl bg-red-500/15 border border-red-500/40 text-red-400 hover:bg-red-500/25 text-sm font-medium transition-colors flex items-center justify-center gap-1.5"
          >
            <ClipboardList size={13} />
            Go to Tasks
            <ChevronRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
