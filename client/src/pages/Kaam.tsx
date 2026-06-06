/**
 * Kaam — a staff member's personal work log for a day.
 *
 * Pulls everything they did on a given date into one place:
 *   • Diary entries logged (+ how many customers the AI extracted)
 *   • Tasks completed
 *   • Calls / interactions logged (CRM activity)
 *
 * Browse day-by-day with prev/next. Answers "what kaam did I do today?".
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen, CheckCircle, Phone, ChevronLeft, ChevronRight, Mic,
  MessageSquare, Users, CalendarDays, Sparkles,
} from 'lucide-react';
import { diaryAPI, tasksAPI, interactionsAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { DiaryEntry, Task, Interaction } from '../types';

const todayStr = () => new Date().toLocaleDateString('sv-SE'); // local YYYY-MM-DD

// Is an ISO timestamp on the given YYYY-MM-DD (local)?
const onDay = (iso: string | null | undefined, day: string) =>
  !!iso && new Date(iso).toLocaleDateString('sv-SE') === day;

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

const IX_META: Record<string, { label: string; icon: typeof Phone; color: string }> = {
  call:    { label: 'Call',    icon: Phone,         color: '#22c55e' },
  message: { label: 'Message', icon: MessageSquare, color: '#3b82f6' },
  meeting: { label: 'Meeting', icon: Users,         color: '#a855f7' },
  email:   { label: 'Email',   icon: MessageSquare, color: '#f59e0b' },
  diary:   { label: 'Diary',   icon: BookOpen,      color: '#C9A84C' },
};

export default function Kaam() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [day, setDay] = useState(todayStr());
  const [diary, setDiary] = useState<DiaryEntry[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [ixs, setIxs] = useState<Interaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      diaryAPI.list().catch(() => []),
      tasksAPI.list({ completed: true }).catch(() => []),
      interactionsAPI.list(user?.id ? { staffId: user.id } : undefined).catch(() => []),
    ]).then(([d, t, i]) => {
      if (cancelled) return;
      setDiary(Array.isArray(d) ? d : []);
      setTasks(Array.isArray(t) ? t : []);
      setIxs(Array.isArray(i) ? i : []);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user?.id]);

  // Filter each source to the selected day
  const dayDiary = useMemo(
    () => diary.filter(d => (d.date === day) || onDay(d.createdAt, day)),
    [diary, day],
  );
  const dayTasks = useMemo(
    () => tasks.filter(t => t.completed && onDay(t.completedAt, day)),
    [tasks, day],
  );
  // Exclude diary-sourced interactions here — diary entries are shown in their own section
  const dayIxs = useMemo(
    () => ixs.filter(i => onDay(i.createdAt, day) && i.type !== 'diary'),
    [ixs, day],
  );

  const customersTouched = useMemo(() => {
    const set = new Set<string>();
    dayDiary.forEach(d => (d.aiEntries || []).forEach(e => e.customerName && set.add(e.customerName)));
    dayIxs.forEach(i => i.customerId && set.add(i.customerId));
    return set.size;
  }, [dayDiary, dayIxs]);

  const shiftDay = (dir: number) => {
    const d = new Date(day + 'T00:00:00');
    d.setDate(d.getDate() + dir);
    setDay(d.toLocaleDateString('sv-SE'));
  };

  const isToday = day === todayStr();
  const prettyDay = new Date(day + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const nothing = !loading && dayDiary.length === 0 && dayTasks.length === 0 && dayIxs.length === 0;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2">
          Kaam <Sparkles size={18} className="text-gold" />
        </h1>
        <p className="text-white/30 text-sm mt-0.5">Everything you did, day by day.</p>
      </div>

      {/* Day navigator */}
      <div className="flex items-center justify-between rounded-2xl bg-dark-300 border border-dark-100 px-3 py-2.5">
        <button onClick={() => shiftDay(-1)} className="p-2 rounded-xl hover:bg-dark-200 text-white/40 hover:text-white transition-colors"><ChevronLeft size={18} /></button>
        <div className="text-center">
          <p className="text-white font-bold text-sm flex items-center gap-1.5 justify-center"><CalendarDays size={14} className="text-gold" />{isToday ? 'Today' : prettyDay}</p>
          {isToday && <p className="text-white/30 text-[10px]">{prettyDay}</p>}
        </div>
        <button onClick={() => shiftDay(1)} disabled={isToday}
          className="p-2 rounded-xl hover:bg-dark-200 text-white/40 hover:text-white transition-colors disabled:opacity-25 disabled:cursor-not-allowed"><ChevronRight size={18} /></button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Diary',     value: dayDiary.length, color: 'text-gold' },
          { label: 'Tasks',     value: dayTasks.length, color: 'text-green-400' },
          { label: 'Calls',     value: dayIxs.length,   color: 'text-blue-400' },
          { label: 'Customers', value: customersTouched, color: 'text-purple-400' },
        ].map(s => (
          <div key={s.label} className="rounded-2xl bg-dark-300 border border-dark-100 p-3 text-center">
            <p className={`text-2xl font-black leading-none ${s.color}`}>{s.value}</p>
            <p className="text-white/35 text-[9px] uppercase tracking-wider mt-1.5">{s.label}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-20 rounded-2xl bg-dark-300 animate-pulse" />)}</div>
      ) : nothing ? (
        <div className="rounded-2xl bg-dark-300 border border-dark-100 flex flex-col items-center py-14 gap-3 text-center">
          <BookOpen size={32} className="text-white/10" />
          <p className="text-white/40 text-sm">No work logged for this day yet</p>
          {isToday && (
            <button onClick={() => navigate('/diary')} className="btn-primary mt-1 flex items-center gap-2 text-sm">
              <Mic size={15} /> Log your work
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {/* ── Diary entries ── */}
          {dayDiary.length > 0 && (
            <Section icon={<BookOpen size={15} className="text-gold" />} title="Diary entries" count={dayDiary.length} onAll={() => navigate('/diary')}>
              {dayDiary.map(d => (
                <button key={d.id} onClick={() => navigate('/diary')}
                  className="w-full text-left p-3.5 rounded-xl bg-dark-200 border border-dark-100 hover:border-gold/30 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-white/30 text-[10px]">{fmtTime(d.createdAt)}</span>
                    {(d.aiEntries?.length ?? 0) > 0 && (
                      <span className="text-[10px] font-bold text-gold/80 bg-gold/10 px-2 py-0.5 rounded-full">
                        {d.aiEntries.length} customer{d.aiEntries.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <p className="text-white/75 text-xs mt-1.5 line-clamp-2 leading-relaxed">{d.translatedContent || d.content}</p>
                  {(d.aiEntries?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {d.aiEntries.slice(0, 6).map((e, i) => (
                        <span key={i} className="text-[10px] text-white/50 bg-dark-100 px-2 py-0.5 rounded-full">{e.customerName}</span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </Section>
          )}

          {/* ── Calls / CRM logs ── */}
          {dayIxs.length > 0 && (
            <Section icon={<Phone size={15} className="text-blue-400" />} title="Calls & contacts" count={dayIxs.length} onAll={() => navigate('/customers')}>
              {dayIxs.map(i => {
                const meta = IX_META[i.type] || IX_META.call;
                const Icon = meta.icon;
                return (
                  <div key={i.id} className="flex items-start gap-3 p-3.5 rounded-xl bg-dark-200 border border-dark-100">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: meta.color + '22', color: meta.color }}>
                      <Icon size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold" style={{ color: meta.color }}>{meta.label}</span>
                        <span className="text-white/30 text-[10px]">{fmtTime(i.createdAt)}</span>
                      </div>
                      {i.notes && <p className="text-white/70 text-xs mt-1 line-clamp-2 leading-relaxed">{i.notes}</p>}
                      {i.responded && <span className="text-[10px] text-green-400/70 mt-1 inline-block">✓ responded</span>}
                    </div>
                  </div>
                );
              })}
            </Section>
          )}

          {/* ── Tasks completed ── */}
          {dayTasks.length > 0 && (
            <Section icon={<CheckCircle size={15} className="text-green-400" />} title="Tasks completed" count={dayTasks.length} onAll={() => navigate('/tasks')}>
              {dayTasks.map(t => (
                <div key={t.id} className="flex items-center gap-3 p-3.5 rounded-xl bg-dark-200 border border-dark-100">
                  <CheckCircle size={16} className="text-green-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-white/80 text-xs font-medium truncate line-through decoration-white/20">{t.title}</p>
                    {t.customerName && <p className="text-white/30 text-[10px]">{t.customerName}</p>}
                  </div>
                  {t.completedAt && <span className="text-white/25 text-[10px] flex-shrink-0">{fmtTime(t.completedAt)}</span>}
                </div>
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ icon, title, count, onAll, children }: {
  icon: React.ReactNode; title: string; count: number; onAll: () => void; children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-dark-300 border border-dark-100 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-dark-100/60">
        <p className="text-white font-bold text-sm flex items-center gap-2">{icon}{title}
          <span className="text-white/30 text-xs font-normal">· {count}</span>
        </p>
        <button onClick={onAll} className="text-white/30 text-[11px] hover:text-gold transition-colors flex items-center gap-0.5">
          Open <ChevronRight size={11} />
        </button>
      </div>
      <div className="p-3 space-y-2">{children}</div>
    </div>
  );
}
