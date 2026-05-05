import { useState, useEffect, useCallback } from 'react';
import {
  ChevronLeft, ChevronRight, BookOpen, ClipboardList,
  Phone, TrendingUp, X, User, CheckCircle2, Circle, Clock,
} from 'lucide-react';
import { calendarAPI, staffAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { Staff, Task, DiaryEntry, Interaction } from '../types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DayCounts { tasks: number; diary: number; interactions: number; leads: number; }
interface MonthData  { year: number; month: number; days: Record<string, DayCounts>; }

interface Lead {
  id: string; title?: string; name?: string; company?: string;
  stage: string; value?: number; staffId?: string; staffName?: string;
  createdAt: string; updatedAt?: string;
}
interface DayData {
  date: string;
  tasks: (Task & { staffName: string })[];
  diary: DiaryEntry[];
  interactions: (Interaction & { staffName: string })[];
  leads: Lead[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DAY_ABBR  = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS    = ['January','February','March','April','May','June',
                   'July','August','September','October','November','December'];

// Category config — drives dots, tabs, and section renders
const CATS = [
  { key: 'tasks',        icon: ClipboardList, label: 'Tasks',        dot: '#60a5fa' /* blue-400  */ },
  { key: 'diary',        icon: BookOpen,      label: 'Diary',        dot: '#c084fc' /* purple-400*/ },
  { key: 'interactions', icon: Phone,         label: 'Interactions', dot: '#34d399' /* emerald-400*/},
  { key: 'leads',        icon: TrendingUp,    label: 'Leads',        dot: '#D4AF37' /* gold       */},
] as const;
type CatKey = typeof CATS[number]['key'];

// ── Helpers ───────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

function fmtDateLabel(d: string) {
  // "2025-05-07" → "Wednesday, 7 May 2025"
  return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function fmtTime(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function stageChip(stage: string) {
  const m: Record<string, string> = {
    won: 'bg-gold/15 text-gold border-gold/30',
    lost: 'bg-red-400/15 text-red-300 border-red-400/30',
    interested: 'bg-emerald-400/15 text-emerald-300 border-emerald-400/30',
    new: 'bg-slate-400/15 text-slate-300 border-slate-400/30',
  };
  return m[stage] || 'bg-white/10 text-white/50 border-white/10';
}

// ── Day panel content ─────────────────────────────────────────────────────────

function EmptyState({ tab }: { tab: CatKey }) {
  const labels: Record<CatKey, string> = {
    tasks: 'No tasks on this day', diary: 'No diary entries',
    interactions: 'No interactions logged', leads: 'No leads activity',
  };
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <p className="text-white/20 text-sm">{labels[tab]}</p>
    </div>
  );
}

function TasksTab({ items }: { items: DayData['tasks'] }) {
  if (!items.length) return <EmptyState tab="tasks" />;
  return (
    <div className="space-y-2">
      {items.map(t => (
        <div key={t.id} className="flex gap-3 p-3 rounded-xl bg-white/[0.04] border border-white/[0.07] hover:border-white/12 transition-colors">
          {t.completed
            ? <CheckCircle2 size={15} className="text-emerald-400 flex-shrink-0 mt-0.5" />
            : <Circle       size={15} className="text-white/20 flex-shrink-0 mt-0.5" />}
          <div className="min-w-0 flex-1">
            <p className={`text-sm leading-snug ${t.completed ? 'line-through text-white/35' : 'text-white/85'}`}>
              {t.title}
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
              {t.customerName && <span className="text-white/35 text-xs">{t.customerName}</span>}
              {t.staffName    && <span className="text-white/25 text-xs flex items-center gap-1"><User size={9}/>{t.staffName}</span>}
              {t.completedAt  && <span className="text-emerald-400/60 text-xs">✓ {fmtTime(t.completedAt)}</span>}
              {!t.completed   && <span className="text-amber-400/60 text-xs flex items-center gap-1"><Clock size={9}/>Due {fmtTime(t.dueDate)}</span>}
              {t.isLoop       && <span className="text-[10px] px-1.5 py-px rounded bg-blue-500/15 text-blue-300 border border-blue-500/20">♾ Loop</span>}
            </div>
            {t.notes && <p className="text-white/25 text-xs mt-1 line-clamp-2">{t.notes}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function DiaryTab({ items }: { items: DayData['diary'] }) {
  if (!items.length) return <EmptyState tab="diary" />;
  return (
    <div className="space-y-3">
      {items.map(d => (
        <div key={d.id} className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.07]">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-white/40 text-xs flex items-center gap-1"><User size={9}/>{d.staffName}</span>
            <span className={`ml-auto text-[10px] px-2 py-px rounded-full border ${
              d.status === 'done' ? 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20' :
              d.status === 'processing' ? 'bg-amber-400/10 text-amber-400 border-amber-400/20' :
                                          'bg-red-400/10 text-red-400 border-red-400/20'
            }`}>{d.status}</span>
          </div>
          <p className="text-white/70 text-sm leading-relaxed line-clamp-5">{d.content}</p>
          {d.aiEntries?.length > 0 && (
            <div className="mt-2 pt-2 border-t border-white/[0.06] flex flex-wrap gap-1">
              {d.aiEntries.slice(0, 8).map((e, i) => (
                <span key={i} className={`text-xs px-1.5 py-px rounded border border-white/[0.07] bg-white/[0.03] ${
                  e.sentiment === 'positive' ? 'text-emerald-400' :
                  e.sentiment === 'negative' ? 'text-red-400'     : 'text-white/40'
                }`}>{e.customerName}</span>
              ))}
              {d.aiEntries.length > 8 && <span className="text-white/20 text-xs self-center">+{d.aiEntries.length - 8}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function InteractionsTab({ items }: { items: DayData['interactions'] }) {
  if (!items.length) return <EmptyState tab="interactions" />;
  const typeIcon: Record<string, string> = { call: '📞', meeting: '🤝', email: '📧', message: '💬', diary: '📓' };
  return (
    <div className="space-y-2">
      {items.map(i => (
        <div key={i.id} className="flex gap-3 p-3 rounded-xl bg-white/[0.04] border border-white/[0.07] hover:border-white/12 transition-colors">
          <span className="text-lg leading-none flex-shrink-0 mt-0.5">{typeIcon[i.type] || '📞'}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-white/80 text-sm capitalize font-medium">{i.type}</span>
              <span className={`text-[10px] px-1.5 py-px rounded-full border ${
                i.responded ? 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20'
                            : 'bg-red-400/10 text-red-400 border-red-400/20'
              }`}>{i.responded ? 'Responded' : 'No response'}</span>
              <span className="ml-auto text-white/20 text-xs">{fmtTime(i.createdAt)}</span>
            </div>
            {i.staffName && <p className="text-white/25 text-xs mt-0.5 flex items-center gap-1"><User size={9}/>{i.staffName}</p>}
            {i.notes      && <p className="text-white/45 text-xs mt-1 line-clamp-2">{i.notes}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function LeadsTab({ items }: { items: DayData['leads'] }) {
  if (!items.length) return <EmptyState tab="leads" />;
  return (
    <div className="space-y-2">
      {items.map(l => (
        <div key={l.id} className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.07] hover:border-white/12 transition-colors">
          <div className="flex items-start justify-between gap-2">
            <p className="text-white/85 text-sm font-medium leading-snug truncate">{l.title || l.name}</p>
            <span className={`text-[10px] px-2 py-px rounded-full border flex-shrink-0 ${stageChip(l.stage)}`}>{l.stage}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-1">
            {l.company    && <span className="text-white/30 text-xs">{l.company}</span>}
            {l.staffName  && <span className="text-white/25 text-xs flex items-center gap-1"><User size={9}/>{l.staffName}</span>}
            {l.value != null && l.value > 0 && <span className="text-gold/70 text-xs">₹{l.value.toLocaleString('en-IN')}</span>}
            <span className="ml-auto text-white/20 text-xs">{fmtTime(l.createdAt)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Day panel ─────────────────────────────────────────────────────────────────

function DayPanel({ date, staffId, onClose }: { date: string; staffId: string; onClose: () => void }) {
  const [data,    setData]    = useState<DayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab,     setTab]     = useState<CatKey>('tasks');

  useEffect(() => {
    setLoading(true);
    setData(null);
    calendarAPI.day(date, staffId || undefined)
      .then(setData).catch(console.error).finally(() => setLoading(false));
  }, [date, staffId]);

  const counts: Record<CatKey, number> = {
    tasks:        data?.tasks.length        ?? 0,
    diary:        data?.diary.length        ?? 0,
    interactions: data?.interactions.length ?? 0,
    leads:        data?.leads.length        ?? 0,
  };

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-white/[0.08] flex-shrink-0">
        <div>
          <p className="text-white font-bold text-sm leading-tight">{fmtDateLabel(date)}</p>
          <p className="text-white/30 text-xs mt-0.5">
            {loading ? 'Loading…' : total === 0 ? 'No activity' : `${total} entr${total === 1 ? 'y' : 'ies'}`}
          </p>
        </div>
        <button onClick={onClose} className="text-white/25 hover:text-white transition-colors flex-shrink-0 mt-0.5">
          <X size={16} />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-white/[0.08] flex-shrink-0">
        {CATS.map(c => (
          <button
            key={c.key}
            onClick={() => setTab(c.key)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold transition-colors border-b-2 ${
              tab === c.key
                ? 'border-gold text-gold'
                : 'border-transparent text-white/25 hover:text-white/60'
            }`}
          >
            <c.icon size={13} />
            <span>{c.label}</span>
            {!loading && counts[c.key] > 0 && (
              <span className={`text-[9px] px-1 rounded-full ${tab === c.key ? 'bg-gold/20 text-gold' : 'bg-white/10 text-white/40'}`}>
                {counts[c.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="w-5 h-5 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {!loading && data && (
          <>
            {tab === 'tasks'        && <TasksTab        items={data.tasks}        />}
            {tab === 'diary'        && <DiaryTab        items={data.diary}        />}
            {tab === 'interactions' && <InteractionsTab items={data.interactions} />}
            {tab === 'leads'        && <LeadsTab        items={data.leads}        />}
          </>
        )}
      </div>
    </div>
  );
}

// ── Calendar grid cell ────────────────────────────────────────────────────────

function DayCell({
  day, dateStr, isToday, isSelected, counts, onClick,
}: {
  day: number; dateStr: string;
  isToday: boolean; isSelected: boolean;
  counts?: DayCounts; onClick: () => void;
}) {
  const total = counts ? counts.tasks + counts.diary + counts.interactions + counts.leads : 0;
  const hasActivity = total > 0;

  return (
    <button
      onClick={onClick}
      className={`
        group relative flex flex-col items-center pt-2 pb-1.5 min-h-[64px] sm:min-h-[72px]
        border-r border-b border-white/[0.04] last:border-r-0
        transition-all duration-150
        ${isSelected  ? 'bg-gold/8 z-10'           : 'hover:bg-white/[0.03]'}
      `}
    >
      {/* Day number */}
      <span className={`
        text-sm font-semibold w-7 h-7 flex items-center justify-center rounded-full transition-colors
        ${isToday && isSelected ? 'bg-gold text-dark-500 font-bold' :
          isToday               ? 'bg-gold text-dark-500 font-bold' :
          isSelected            ? 'bg-white/15 text-white'           :
          hasActivity           ? 'text-white/80'                    : 'text-white/20'}
      `}>
        {day}
      </span>

      {/* Activity dots */}
      {hasActivity && (
        <div className="flex gap-[3px] mt-1.5 justify-center flex-wrap max-w-[44px]">
          {(CATS as readonly { key: CatKey; dot: string }[]).map(c =>
            counts && counts[c.key] > 0 ? (
              <span
                key={c.key}
                className="w-[5px] h-[5px] rounded-full flex-shrink-0"
                style={{ background: c.dot }}
              />
            ) : null
          )}
        </div>
      )}

      {/* Total count — small corner badge */}
      {hasActivity && (
        <span className={`
          absolute bottom-1 right-1.5 text-[9px] font-semibold leading-none
          transition-opacity
          ${isSelected ? 'text-gold/80 opacity-100' : 'text-white/15 group-hover:text-white/35 opacity-100'}
        `}>
          {total}
        </span>
      )}
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Calendar() {
  const { isAdmin } = useAuth();

  const now   = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selected,    setSelected]    = useState<string | null>(null);
  const [monthData,   setMonthData]   = useState<MonthData | null>(null);
  const [loadingMonth, setLoadingMonth] = useState(true);
  const [staffList,   setStaffList]   = useState<Staff[]>([]);
  const [filterStaff, setFilterStaff] = useState('');

  // Load staff for admin filter
  useEffect(() => {
    if (!isAdmin) return;
    staffAPI.list().then(setStaffList).catch(console.error);
  }, [isAdmin]);

  // Load month data
  const loadMonth = useCallback(() => {
    setLoadingMonth(true);
    calendarAPI.month(year, month, filterStaff || undefined)
      .then((d: MonthData) => setMonthData(d))
      .catch(console.error)
      .finally(() => setLoadingMonth(false));
  }, [year, month, filterStaff]);

  useEffect(() => { loadMonth(); }, [loadMonth]);

  // Navigation
  const goPrev = () => { setSelected(null); month === 1 ? (setYear(y => y-1), setMonth(12)) : setMonth(m => m-1); };
  const goNext = () => { setSelected(null); month === 12 ? (setYear(y => y+1), setMonth(1))  : setMonth(m => m+1); };
  const goToday = () => { setYear(now.getFullYear()); setMonth(now.getMonth()+1); setSelected(null); };

  // Grid
  const firstDOW  = new Date(year, month - 1, 1).getDay();
  const daysCount = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDOW).fill(null),
    ...Array.from({ length: daysCount }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const todayStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const cellDate = (d: number) => `${year}-${pad(month)}-${pad(d)}`;

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  // Month totals for the summary strip
  const monthTotals = monthData
    ? Object.values(monthData.days).reduce(
        (acc, d) => ({ tasks: acc.tasks + d.tasks, diary: acc.diary + d.diary, interactions: acc.interactions + d.interactions, leads: acc.leads + d.leads }),
        { tasks: 0, diary: 0, interactions: 0, leads: 0 }
      )
    : null;

  return (
    <div className="flex flex-col gap-5 h-full">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-white text-xl font-bold">Calendar</h1>
          <p className="text-white/30 text-xs mt-0.5">{isAdmin ? 'All team activity' : 'Your activity log'}</p>
        </div>
        {isAdmin && (
          <select
            value={filterStaff}
            onChange={e => { setFilterStaff(e.target.value); setSelected(null); }}
            className="ml-auto px-3 py-2 rounded-xl bg-dark-300 border border-white/10 text-white/70 text-sm focus:outline-none focus:border-gold/40"
          >
            <option value="">All Staff</option>
            {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      {/* ── Layout: calendar + panel ── */}
      <div className="flex gap-4 min-h-0 flex-col lg:flex-row">
        {/* Calendar card */}
        <div className={`flex flex-col rounded-2xl bg-dark-300 border border-white/[0.06] overflow-hidden transition-all ${
          selected ? 'lg:flex-1' : 'w-full'
        }`}>
          {/* Month nav */}
          <div className="flex items-center gap-2 px-4 py-3.5 border-b border-white/[0.06]">
            <button onClick={goPrev} className="p-1.5 rounded-lg hover:bg-white/[0.07] text-white/40 hover:text-white transition-colors">
              <ChevronLeft size={16} />
            </button>
            <div className="flex-1 flex items-center justify-center gap-2.5">
              <span className="text-white font-bold text-base">{MONTHS[month-1]} {year}</span>
              {!isCurrentMonth && (
                <button onClick={goToday} className="text-[10px] text-gold border border-gold/30 rounded-md px-2 py-0.5 hover:bg-gold/10 transition-colors">
                  Today
                </button>
              )}
            </div>
            <button onClick={goNext} className="p-1.5 rounded-lg hover:bg-white/[0.07] text-white/40 hover:text-white transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 border-b border-white/[0.06]">
            {DAY_ABBR.map((d, i) => (
              <div key={i} className="py-2 text-center text-white/20 text-[11px] font-semibold tracking-wide">{d}</div>
            ))}
          </div>

          {/* Grid */}
          <div className={`grid grid-cols-7 flex-1 transition-opacity ${loadingMonth ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}>
            {cells.map((day, idx) => {
              if (!day) {
                return <div key={`e${idx}`} className="border-r border-b border-white/[0.04] min-h-[64px]" />;
              }
              const ds = cellDate(day);
              return (
                <DayCell
                  key={ds}
                  day={day}
                  dateStr={ds}
                  isToday={ds === todayStr}
                  isSelected={ds === selected}
                  counts={monthData?.days[ds]}
                  onClick={() => setSelected(selected === ds ? null : ds)}
                />
              );
            })}
          </div>

          {/* Legend + summary strip */}
          <div className="px-4 py-3 border-t border-white/[0.06] flex items-center gap-4 flex-wrap">
            {CATS.map(c => (
              <div key={c.key} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.dot }} />
                <span className="text-white/30 text-xs">{c.label}</span>
                {monthTotals && monthTotals[c.key] > 0 && (
                  <span className="text-white/20 text-[10px]">({monthTotals[c.key]})</span>
                )}
              </div>
            ))}
            <span className="ml-auto text-white/15 text-xs italic">Tap a day to view</span>
          </div>
        </div>

        {/* Day detail panel */}
        {selected && (
          <div className="lg:w-[360px] w-full rounded-2xl bg-dark-300 border border-white/[0.06] overflow-hidden flex flex-col lg:max-h-[calc(100vh-12rem)] max-h-[500px]">
            <DayPanel
              date={selected}
              staffId={filterStaff}
              onClose={() => setSelected(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
