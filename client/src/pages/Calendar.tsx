import { useState, useEffect, useCallback } from 'react';
import {
  ChevronLeft, ChevronRight, BookOpen, ClipboardList,
  Phone, TrendingUp, X, User, CheckCircle2, Circle,
  Clock, AlertCircle, LogIn, LogOut, Calendar as CalendarIcon,
} from 'lucide-react';
import { calendarAPI, staffAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { Staff, Task, DiaryEntry, Interaction } from '../types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MonthCounts {
  tasks: number;
  diary: number;
  interactions: number;
  leads: number;
  attendance: number;
}

interface MonthData {
  year: number;
  month: number;
  days: Record<string, MonthCounts>;
}

interface Lead {
  id: string;
  title: string;
  company?: string;
  stage: string;
  value?: number;
  staffId?: string;
  staffName?: string;
  createdAt: string;
  updatedAt?: string;
}

interface AttendanceRecord {
  id: string;
  staffId: string;
  staffName: string;
  loginAt?: string;
  logoutAt?: string;
  createdAt: string;
}

interface DayData {
  date: string;
  tasks: (Task & { staffName: string })[];
  diary: DiaryEntry[];
  interactions: (Interaction & { staffName: string })[];
  leads: Lead[];
  attendance: AttendanceRecord[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DOT_COLORS: Record<keyof MonthCounts, string> = {
  tasks:        'bg-blue-400',
  diary:        'bg-purple-400',
  interactions: 'bg-emerald-400',
  leads:        'bg-gold',
  attendance:   'bg-slate-400',
};

const LEGEND = [
  { key: 'tasks',        color: 'bg-blue-400',    label: 'Tasks' },
  { key: 'diary',        color: 'bg-purple-400',  label: 'Diary' },
  { key: 'interactions', color: 'bg-emerald-400', label: 'Interactions' },
  { key: 'leads',        color: 'bg-gold',         label: 'Leads' },
  { key: 'attendance',   color: 'bg-slate-400',   label: 'Attendance' },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function pad(n: number) { return String(n).padStart(2, '0'); }

function formatTime(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatDateLabel(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function stageColor(stage: string) {
  const map: Record<string, string> = {
    lead: 'bg-slate-400/20 text-slate-300',
    contacted: 'bg-blue-400/20 text-blue-300',
    interested: 'bg-emerald-400/20 text-emerald-300',
    negotiating: 'bg-amber-400/20 text-amber-300',
    won: 'bg-gold/20 text-gold',
    lost: 'bg-red-400/20 text-red-300',
  };
  return map[stage] || 'bg-white/10 text-white/60';
}

function sentimentColor(s?: string) {
  if (s === 'positive') return 'text-emerald-400';
  if (s === 'negative') return 'text-red-400';
  return 'text-white/50';
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Dot({ colorClass }: { colorClass: string }) {
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${colorClass} flex-shrink-0`} />;
}

function SectionHeader({ icon: Icon, label, count, color }: {
  icon: React.ElementType; label: string; count: number; color: string;
}) {
  return (
    <div className={`flex items-center gap-2 mb-3 pb-2 border-b border-white/10`}>
      <div className={`p-1.5 rounded-lg ${color}`}>
        <Icon size={13} className="text-white" />
      </div>
      <span className="text-white/80 text-sm font-semibold">{label}</span>
      <span className="ml-auto text-white/30 text-xs">{count}</span>
    </div>
  );
}

// ── Day panel ─────────────────────────────────────────────────────────────────

function DayPanel({ date, staffId, onClose }: { date: string; staffId: string; onClose: () => void }) {
  const [data, setData] = useState<DayData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    calendarAPI.day(date, staffId || undefined)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [date, staffId]);

  const total = data
    ? data.tasks.length + data.diary.length + data.interactions.length + data.leads.length
    : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 p-5 border-b border-white/10 flex-shrink-0">
        <div>
          <p className="text-gold text-xs font-semibold uppercase tracking-wider mb-0.5">
            <CalendarIcon size={11} className="inline mr-1 -mt-0.5" />
            Day View
          </p>
          <h2 className="text-white font-bold text-base leading-tight">
            {formatDateLabel(date)}
          </h2>
          {!loading && (
            <p className="text-white/30 text-xs mt-1">
              {total === 0 ? 'No activity' : `${total} entr${total === 1 ? 'y' : 'ies'}`}
            </p>
          )}
        </div>
        <button onClick={onClose} className="text-white/30 hover:text-white transition-colors mt-0.5">
          <X size={18} />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-7">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && total === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <CalendarIcon size={36} className="text-white/10 mb-3" />
            <p className="text-white/30 text-sm">No entries for this day</p>
          </div>
        )}

        {/* Tasks */}
        {!loading && data && data.tasks.length > 0 && (
          <div>
            <SectionHeader
              icon={ClipboardList}
              label="Tasks"
              count={data.tasks.length}
              color="bg-blue-500/20"
            />
            <div className="space-y-2">
              {data.tasks.map(t => (
                <div key={t.id} className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-white/10 transition-colors">
                  {t.completed
                    ? <CheckCircle2 size={15} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                    : <Circle size={15} className="text-white/20 flex-shrink-0 mt-0.5" />}
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm leading-snug ${t.completed ? 'text-white/40 line-through' : 'text-white/85'}`}>
                      {t.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {t.customerName && (
                        <span className="text-white/30 text-xs">{t.customerName}</span>
                      )}
                      {t.staffName && (
                        <span className="flex items-center gap-1 text-white/25 text-xs">
                          <User size={9} /> {t.staffName}
                        </span>
                      )}
                      {t.completedAt && (
                        <span className="text-emerald-400/60 text-xs">
                          ✓ {formatTime(t.completedAt)}
                        </span>
                      )}
                      {!t.completed && (
                        <span className="flex items-center gap-1 text-amber-400/70 text-xs">
                          <Clock size={9} /> Due: {formatTime(t.dueDate)}
                        </span>
                      )}
                      {t.isLoop && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/20">
                          ♾ Loop
                        </span>
                      )}
                    </div>
                    {t.notes && (
                      <p className="text-white/30 text-xs mt-1 leading-relaxed line-clamp-2">{t.notes}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Diary */}
        {!loading && data && data.diary.length > 0 && (
          <div>
            <SectionHeader
              icon={BookOpen}
              label="Diary Entries"
              count={data.diary.length}
              color="bg-purple-500/20"
            />
            <div className="space-y-2">
              {data.diary.map(d => (
                <div key={d.id} className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-white/10 transition-colors">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="flex items-center gap-1 text-white/30 text-xs">
                      <User size={9} /> {d.staffName}
                    </span>
                    <span className={`ml-auto text-xs px-1.5 py-0.5 rounded-full border ${
                      d.status === 'done'       ? 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20' :
                      d.status === 'processing' ? 'bg-amber-400/10 text-amber-400 border-amber-400/20' :
                                                  'bg-red-400/10 text-red-400 border-red-400/20'
                    }`}>
                      {d.status}
                    </span>
                  </div>
                  <p className="text-white/70 text-sm leading-relaxed line-clamp-4">
                    {d.content}
                  </p>
                  {d.aiEntries && d.aiEntries.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-white/[0.06]">
                      <p className="text-white/30 text-xs mb-1">
                        AI extracted: {d.aiEntries.length} customer{d.aiEntries.length !== 1 ? 's' : ''}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {d.aiEntries.slice(0, 6).map((e, i) => (
                          <span key={i} className={`text-xs px-1.5 py-0.5 rounded ${sentimentColor(e.sentiment)} bg-white/[0.04] border border-white/[0.06]`}>
                            {e.customerName}
                          </span>
                        ))}
                        {d.aiEntries.length > 6 && (
                          <span className="text-xs text-white/20">+{d.aiEntries.length - 6} more</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Interactions */}
        {!loading && data && data.interactions.length > 0 && (
          <div>
            <SectionHeader
              icon={Phone}
              label="Interactions"
              count={data.interactions.length}
              color="bg-emerald-500/20"
            />
            <div className="space-y-2">
              {data.interactions.map(i => (
                <div key={i.id} className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-white/10 transition-colors">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-xs ${
                    i.type === 'call'    ? 'bg-blue-500/15 text-blue-300' :
                    i.type === 'meeting' ? 'bg-purple-500/15 text-purple-300' :
                    i.type === 'email'   ? 'bg-amber-500/15 text-amber-300' :
                                          'bg-emerald-500/15 text-emerald-300'
                  }`}>
                    {i.type === 'call'    ? '📞' :
                     i.type === 'meeting' ? '🤝' :
                     i.type === 'email'   ? '📧' : '💬'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white/80 text-sm capitalize">{i.type}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full border ${
                        i.responded
                          ? 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20'
                          : 'bg-red-400/10 text-red-400 border-red-400/20'
                      }`}>
                        {i.responded ? 'Responded' : 'No response'}
                      </span>
                      <span className="ml-auto text-white/25 text-xs">{formatTime(i.createdAt)}</span>
                    </div>
                    {i.staffName && (
                      <span className="flex items-center gap-1 text-white/25 text-xs mt-0.5">
                        <User size={9} /> {i.staffName}
                      </span>
                    )}
                    {i.notes && (
                      <p className="text-white/50 text-xs mt-1 leading-relaxed line-clamp-2">{i.notes}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Leads */}
        {!loading && data && data.leads.length > 0 && (
          <div>
            <SectionHeader
              icon={TrendingUp}
              label="CRM Leads"
              count={data.leads.length}
              color="bg-gold/20"
            />
            <div className="space-y-2">
              {data.leads.map(l => (
                <div key={l.id} className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-white/10 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-white/85 text-sm font-medium leading-snug truncate">{l.title}</p>
                      {l.company && <p className="text-white/30 text-xs mt-0.5">{l.company}</p>}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full border flex-shrink-0 ${stageColor(l.stage)}`}>
                      {l.stage}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    {l.staffName && (
                      <span className="flex items-center gap-1 text-white/25 text-xs">
                        <User size={9} /> {l.staffName}
                      </span>
                    )}
                    {l.value != null && l.value > 0 && (
                      <span className="text-gold/70 text-xs">₹{l.value.toLocaleString('en-IN')}</span>
                    )}
                    <span className="ml-auto text-white/20 text-xs">{formatTime(l.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Attendance */}
        {!loading && data && data.attendance.length > 0 && (
          <div>
            <SectionHeader
              icon={AlertCircle}
              label="Attendance"
              count={data.attendance.length}
              color="bg-slate-500/20"
            />
            <div className="space-y-2">
              {data.attendance.map(a => (
                <div key={a.id} className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-white/10 transition-colors">
                  <div className="flex items-center gap-2 mb-1">
                    <User size={12} className="text-white/30" />
                    <span className="text-white/70 text-sm">{a.staffName}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="flex items-center gap-1 text-emerald-400/70">
                      <LogIn size={10} /> {formatTime(a.loginAt)} check-in
                    </span>
                    {a.logoutAt && (
                      <span className="flex items-center gap-1 text-red-400/60">
                        <LogOut size={10} /> {formatTime(a.logoutAt)} check-out
                      </span>
                    )}
                    {!a.logoutAt && (
                      <span className="text-white/20 italic">still active</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Calendar page ────────────────────────────────────────────────────────

export default function Calendar() {
  const { isAdmin, user } = useAuth();

  const today = new Date();
  const [year,  setYear]  = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-based
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [monthData, setMonthData] = useState<MonthData | null>(null);
  const [loadingMonth, setLoadingMonth] = useState(true);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [filterStaffId, setFilterStaffId] = useState('');

  // Load staff list for admin filter
  useEffect(() => {
    if (!isAdmin) return;
    staffAPI.list().then(setStaffList).catch(console.error);
  }, [isAdmin]);

  // Load month data whenever year/month/filter changes
  const loadMonth = useCallback(() => {
    setLoadingMonth(true);
    calendarAPI.month(year, month, filterStaffId || undefined)
      .then((data: MonthData) => setMonthData(data))
      .catch(console.error)
      .finally(() => setLoadingMonth(false));
  }, [year, month, filterStaffId]);

  useEffect(() => { loadMonth(); }, [loadMonth]);

  // Navigation
  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else             { setMonth(m => m - 1); }
    setSelectedDate(null);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else              { setMonth(m => m + 1); }
    setSelectedDate(null);
  };
  const goToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth() + 1);
    setSelectedDate(null);
  };

  // Build grid cells
  const firstDayOfMonth = new Date(year, month - 1, 1).getDay(); // 0=Sun
  const totalDays = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDayOfMonth).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];
  // Pad to complete rows
  while (cells.length % 7 !== 0) cells.push(null);

  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  function cellDate(day: number) {
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  function dotsForDay(day: number): (keyof MonthCounts)[] {
    if (!monthData) return [];
    const counts = monthData.days[cellDate(day)];
    if (!counts) return [];
    return (Object.keys(counts) as (keyof MonthCounts)[]).filter(k => counts[k] > 0);
  }

  const totalActivity = monthData
    ? Object.values(monthData.days).reduce((sum, d) =>
        sum + d.tasks + d.diary + d.interactions + d.leads, 0)
    : 0;

  const activeDays = monthData ? Object.keys(monthData.days).length : 0;

  return (
    <div className="flex flex-col gap-6 h-full">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-white text-xl font-bold">Calendar</h1>
          <p className="text-white/30 text-sm mt-0.5">
            {isAdmin ? 'All activity across the team' : 'Your daily activity log'}
          </p>
        </div>

        {/* Admin staff filter */}
        {isAdmin && (
          <select
            value={filterStaffId}
            onChange={e => { setFilterStaffId(e.target.value); setSelectedDate(null); }}
            className="px-3 py-2 rounded-xl bg-dark-300 border border-white/10 text-white/80 text-sm focus:outline-none focus:border-gold/40"
          >
            <option value="">All Staff</option>
            {staffList.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Active Days',    value: activeDays,     color: 'text-gold' },
          { label: 'Total Entries',  value: totalActivity,  color: 'text-emerald-400' },
          { label: 'Month',          value: MONTH_NAMES[month - 1], color: 'text-blue-300' },
          { label: 'Year',           value: year,           color: 'text-purple-300' },
        ].map(s => (
          <div key={s.label} className="rounded-xl bg-dark-300 border border-white/[0.06] px-4 py-3">
            <p className="text-white/30 text-xs mb-1">{s.label}</p>
            <p className={`font-bold text-lg ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Calendar + panel layout */}
      <div className={`flex gap-4 min-h-0 ${selectedDate ? 'flex-col lg:flex-row' : ''}`}>
        {/* Calendar card */}
        <div className={`flex flex-col rounded-2xl bg-dark-300 border border-white/[0.06] overflow-hidden ${
          selectedDate ? 'lg:flex-1' : 'w-full'
        }`}>
          {/* Month navigation */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
            <button onClick={prevMonth}
              className="p-2 rounded-lg hover:bg-white/[0.06] text-white/50 hover:text-white transition-colors">
              <ChevronLeft size={16} />
            </button>
            <div className="flex items-center gap-3">
              <h2 className="text-white font-bold text-base">
                {MONTH_NAMES[month - 1]} {year}
              </h2>
              {(year !== today.getFullYear() || month !== today.getMonth() + 1) && (
                <button onClick={goToday}
                  className="text-xs text-gold border border-gold/30 rounded-lg px-2 py-0.5 hover:bg-gold/10 transition-colors">
                  Today
                </button>
              )}
            </div>
            <button onClick={nextMonth}
              className="p-2 rounded-lg hover:bg-white/[0.06] text-white/50 hover:text-white transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Day name headers */}
          <div className="grid grid-cols-7 border-b border-white/[0.06]">
            {DAY_NAMES.map(d => (
              <div key={d} className="py-2 text-center text-white/25 text-xs font-medium">{d}</div>
            ))}
          </div>

          {/* Grid */}
          <div className={`grid grid-cols-7 flex-1 ${loadingMonth ? 'opacity-50 pointer-events-none' : ''}`}>
            {cells.map((day, idx) => {
              if (!day) {
                return <div key={`empty-${idx}`} className="aspect-[1/1.1] border-r border-b border-white/[0.04] last:border-r-0" />;
              }
              const dateStr = cellDate(day);
              const dots = dotsForDay(day);
              const isToday   = dateStr === todayStr;
              const isSelected = dateStr === selectedDate;
              const hasActivity = dots.length > 0;

              return (
                <button
                  key={dateStr}
                  onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                  className={`
                    aspect-[1/1.1] flex flex-col items-center justify-start pt-2 px-1 pb-1
                    border-r border-b border-white/[0.04] last:border-r-0
                    transition-all relative group
                    ${isSelected ? 'bg-gold/10 border-gold/20' : 'hover:bg-white/[0.04]'}
                    ${isToday && !isSelected ? 'bg-gold/5' : ''}
                  `}
                >
                  {/* Day number */}
                  <span className={`
                    text-sm font-medium leading-none mb-1.5 w-7 h-7 flex items-center justify-center rounded-full
                    transition-colors
                    ${isToday    ? 'bg-gold text-dark-500 font-bold' :
                      isSelected ? 'bg-gold/20 text-gold' :
                      hasActivity ? 'text-white/80' :
                                   'text-white/25'}
                  `}>
                    {day}
                  </span>

                  {/* Dots */}
                  {dots.length > 0 && (
                    <div className="flex gap-0.5 flex-wrap justify-center max-w-full">
                      {dots.slice(0, 4).map(key => (
                        <Dot key={key} colorClass={DOT_COLORS[key]} />
                      ))}
                    </div>
                  )}

                  {/* Total count tooltip on hover */}
                  {hasActivity && (
                    <span className="absolute bottom-1 right-1 text-[9px] text-white/20 group-hover:text-white/40 transition-colors leading-none">
                      {monthData?.days[dateStr]
                        ? Object.values(monthData.days[dateStr]).reduce((a, b) => a + b, 0)
                        : ''}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div className="px-5 py-3 border-t border-white/[0.06] flex items-center gap-4 flex-wrap">
            {LEGEND.map(({ key, color, label }) => (
              <div key={key} className="flex items-center gap-1.5">
                <Dot colorClass={color} />
                <span className="text-white/30 text-xs">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Day detail panel */}
        {selectedDate && (
          <div className="lg:w-96 rounded-2xl bg-dark-300 border border-white/[0.06] overflow-hidden flex flex-col max-h-[600px] lg:max-h-none">
            <DayPanel
              date={selectedDate}
              staffId={filterStaffId}
              onClose={() => setSelectedDate(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
