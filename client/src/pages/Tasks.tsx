import { useEffect, useState, useCallback } from 'react';
import {
  Plus, Check, Trash2, X, Calendar, User, Clock,
  CheckCircle, Filter, Edit2, BookOpen, AlertTriangle,
  Save, RotateCcw, StickyNote, Users, Mic, MicOff, Send,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { tasksAPI, staffAPI, customersAPI, teamsAPI, diaryAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useVoice } from '../hooks/useVoice';
import type { Task, Staff, Customer, Team } from '../types';

// ── Voice Task Panel ──────────────────────────────────────────────────────────
interface VoiceResult {
  summary: string;
  excuseType: string | null;
  customersMatched: string[];
  tasksCreated: Task[];
  tasksUpdated: Task[];
}

function VoiceTaskPanel({ onClose, onTasksChanged }: {
  onClose: () => void;
  onTasksChanged: (created: Task[], updated: Task[]) => void;
}) {
  const [transcript, setTranscript] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult]         = useState<VoiceResult | null>(null);
  const [error, setError]           = useState('');

  const { listening, interimText, hasVoice, voiceError, toggle, stop } = useVoice(
    (text) => setTranscript(prev => (prev ? prev + ' ' : '') + text)
  );

  const handleSubmit = async () => {
    if (!transcript.trim()) return;
    if (listening) stop();
    setSubmitting(true);
    setError('');
    try {
      const res = await diaryAPI.taskVoice(transcript.trim());
      setResult(res);
      onTasksChanged(res.tasksCreated || [], res.tasksUpdated || []);
    } catch {
      setError('Failed to process. Try again.');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4 animate-fade-in">
      <div className="bg-dark-300 border border-dark-50 rounded-2xl w-full max-w-md shadow-2xl animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-50">
          <div className="flex items-center gap-2">
            <Mic size={16} className="text-gold" />
            <h2 className="text-white font-semibold text-sm">Voice Task</h2>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white"><X size={17} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Info strip */}
          {!result && (
            <p className="text-white/30 text-xs leading-relaxed">
              Say what happened — <span className="text-white/50">"Ramesh ne call nahi uthaya, parso follow karunga"</span> or <span className="text-white/50">"Priya ka payment aana baaki hai"</span>. Existing tasks update without penalty; new tasks are created automatically.
            </p>
          )}

          {/* Transcript box */}
          {!result && (
            <div className="relative">
              <textarea
                className="input resize-none text-sm leading-relaxed"
                rows={4}
                placeholder="Tap the mic or type here…"
                value={transcript + (interimText ? ' ' + interimText : '')}
                onChange={e => setTranscript(e.target.value)}
              />
              {listening && (
                <span className="absolute top-2 right-2 flex gap-0.5">
                  {[0,1,2].map(i => (
                    <span key={i} className="w-0.5 bg-gold rounded-full animate-pulse"
                      style={{ height: `${12 + i * 4}px`, animationDelay: `${i * 0.15}s` }} />
                  ))}
                </span>
              )}
            </div>
          )}

          {/* Voice error */}
          {voiceError && <p className="text-red-400 text-xs">{voiceError}</p>}
          {error && <p className="text-red-400 text-xs">{error}</p>}

          {/* Result */}
          {result && (
            <div className="space-y-3">
              <div className={`rounded-xl px-4 py-3 text-sm border ${
                result.excuseType
                  ? 'bg-amber-500/8 border-amber-500/20 text-amber-300'
                  : result.tasksCreated?.length
                  ? 'bg-green-500/8 border-green-500/20 text-green-300'
                  : 'bg-dark-400 border-dark-50 text-white/40'
              }`}>
                {result.summary}
              </div>

              {result.customersMatched?.length > 0 && (
                <p className="text-white/30 text-xs">
                  Matched: <span className="text-white/60">{result.customersMatched.join(', ')}</span>
                </p>
              )}

              {result.tasksCreated?.length > 0 && (
                <div className="space-y-1">
                  <p className="text-white/40 text-[10px] uppercase tracking-wider">Created</p>
                  {result.tasksCreated.map((t, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-white/70 bg-dark-400 rounded-lg px-3 py-1.5">
                      <Plus size={10} className="text-green-400 flex-shrink-0" />
                      {t.title}
                      {t.dueDate && <span className="text-white/30 ml-auto">{t.dueDate}</span>}
                    </div>
                  ))}
                </div>
              )}

              {result.tasksUpdated?.length > 0 && (
                <div className="space-y-1">
                  <p className="text-white/40 text-[10px] uppercase tracking-wider">Updated (no deduction)</p>
                  {result.tasksUpdated.map((t, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-white/70 bg-dark-400 rounded-lg px-3 py-1.5">
                      <RotateCcw size={10} className="text-amber-400 flex-shrink-0" />
                      {t.title}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-5 pb-5 flex gap-2">
          {result ? (
            <>
              <button onClick={() => { setResult(null); setTranscript(''); }} className="btn-ghost flex-1 text-sm">
                New entry
              </button>
              <button onClick={onClose} className="btn-primary flex-1 text-sm">Done</button>
            </>
          ) : (
            <>
              {hasVoice && (
                <button
                  onClick={toggle}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all border ${
                    listening
                      ? 'bg-red-500/15 border-red-500/30 text-red-400 hover:bg-red-500/20'
                      : 'bg-gold/10 border-gold/20 text-gold hover:bg-gold/20'
                  }`}
                >
                  {listening ? <MicOff size={15} /> : <Mic size={15} />}
                  {listening ? 'Stop' : 'Record'}
                </button>
              )}
              <button
                onClick={handleSubmit}
                disabled={!transcript.trim() || submitting}
                className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm"
              >
                {submitting
                  ? <><span className="w-3.5 h-3.5 border-2 border-dark-500/30 border-t-dark-500 rounded-full animate-spin" /> Processing…</>
                  : <><Send size={14} /> Process</>
                }
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Add Task Modal ─────────────────────────────────────────────────────────────
function AddTaskModal({ staff, customers, onClose, onCreated }: {
  staff: Staff[]; customers: Customer[];
  onClose: () => void; onCreated: (t: Task) => void;
}) {
  const { isAdmin, user } = useAuth();
  const [form, setForm] = useState({
    title: '', notes: '', dueDate: new Date().toISOString().split('T')[0],
    customerId: '', assignedTo: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const filteredCustomers = isAdmin
    ? customers.filter(c => !form.assignedTo || c.assignedTo === form.assignedTo)
    : customers;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.dueDate) { setError('Title and due date required'); return; }
    setLoading(true);
    try {
      const customerName = customers.find(c => c.id === form.customerId)?.name || null;
      const t = await tasksAPI.create({
        title: form.title, notes: form.notes, dueDate: form.dueDate,
        customerId: form.customerId || null, customerName,
        assignedTo: form.assignedTo || user?.id,
      });
      onCreated(t);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed');
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-dark-300 border border-dark-50 rounded-2xl w-full max-w-md shadow-2xl animate-slide-up max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-50 flex-shrink-0">
          <h2 className="text-white font-semibold">Add Task</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4 overflow-y-auto flex-1">
          {error && <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-4 py-3 text-sm">{error}</div>}
          <div><label className="label">Task Title *</label>
            <input className="input" placeholder="e.g. Call back about pricing" value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
          <div><label className="label">Due Date *</label>
            <input type="date" className="input" value={form.dueDate}
              onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} /></div>
          {isAdmin && (
            <div><label className="label">Assign to Staff</label>
              <select className="input" value={form.assignedTo}
                onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value, customerId: '' }))}>
                <option value="">Assign to myself</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          <div><label className="label">Linked Customer (optional)</label>
            <select className="input" value={form.customerId}
              onChange={e => setForm(f => ({ ...f, customerId: e.target.value }))}>
              <option value="">None</option>
              {filteredCustomers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div><label className="label">Notes</label>
            <textarea className="input resize-none" rows={2} placeholder="Additional details..."
              value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
        </form>
        <div className="px-6 pb-6 flex gap-3 flex-shrink-0">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button onClick={submit} disabled={loading} className="btn-primary flex-1">
            {loading ? 'Adding...' : 'Add Task'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit / Reschedule Modal ────────────────────────────────────────────────────
function EditTaskModal({ task, onClose, onSaved }: {
  task: Task; onClose: () => void; onSaved: (t: Task) => void;
}) {
  const today = new Date().toISOString().split('T')[0];
  const isOverdue = !task.completed && task.dueDate < today;

  const [title,    setTitle]    = useState(task.title);
  const [notes,    setNotes]    = useState(task.notes || '');
  const [dueDate,  setDueDate]  = useState(task.dueDate);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const dateChanged = dueDate !== task.dueDate;

  const save = async () => {
    if (!title.trim() || !dueDate) { setError('Title and due date required'); return; }
    setLoading(true);
    try {
      const updated = await tasksAPI.update(task.id, {
        title: title.trim(),
        notes: notes.trim(),
        dueDate,
      });
      onSaved(updated);
    } catch {
      setError('Failed to save. Try again.');
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-dark-300 border border-dark-50 rounded-2xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-50">
          <div className="flex items-center gap-2">
            <Edit2 size={15} className="text-gold" />
            <h2 className="text-white font-semibold">Edit Task</h2>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-4">
          {error && <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-4 py-3 text-sm">{error}</div>}

          {/* Overdue banner */}
          {isOverdue && (
            <div className="flex items-start gap-2.5 bg-red-500/8 border border-red-500/20 rounded-xl px-4 py-3">
              <AlertTriangle size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-red-400 text-xs font-semibold">This task is overdue</p>
                <p className="text-red-400/60 text-[10px] mt-0.5">
                  Add a justification note below. Rescheduling to a future date costs −0.5 merit pts.
                </p>
              </div>
            </div>
          )}

          {/* Title */}
          <div>
            <label className="label">Task Title</label>
            <input className="input" value={title}
              onChange={e => setTitle(e.target.value)} />
          </div>

          {/* Due date + reschedule warning */}
          <div>
            <label className="label">Due Date</label>
            <input type="date" className="input" value={dueDate}
              onChange={e => setDueDate(e.target.value)} />
            {dateChanged && (
              <div className="mt-2 flex items-center gap-2 text-amber-400 bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-2">
                <RotateCcw size={12} className="flex-shrink-0" />
                <p className="text-xs font-medium">
                  Rescheduling deducts <span className="font-bold">−0.5 merit points</span>
                  {task.rescheduledCount ? ` · rescheduled ${task.rescheduledCount}× before` : ''}
                </p>
              </div>
            )}
          </div>

          {/* Notes / justification */}
          <div>
            <label className="label flex items-center gap-1.5">
              <StickyNote size={12} />
              {isOverdue ? 'Justification / Notes' : 'Notes'}
            </label>
            <textarea
              className="input resize-none"
              rows={3}
              placeholder={isOverdue
                ? 'Explain why this task is overdue or what happened…'
                : 'Any additional context…'}
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
            {isOverdue && !notes.trim() && (
              <p className="text-white/25 text-[10px] mt-1">
                Adding a note helps your manager understand the situation.
              </p>
            )}
          </div>
        </div>

        <div className="px-6 pb-6 flex gap-3">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button onClick={save} disabled={loading} className="btn-primary flex-1 flex items-center justify-center gap-2">
            <Save size={14} />
            {loading ? 'Saving…' : dateChanged ? 'Reschedule (−0.5 pts)' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Tasks page ────────────────────────────────────────────────────────────
export default function Tasks() {
  const [tasks,       setTasks]       = useState<Task[]>([]);
  const [staff,       setStaff]       = useState<Staff[]>([]);
  const [customers,   setCustomers]   = useState<Customer[]>([]);
  const [teams,       setTeams]       = useState<Team[]>([]);
  const [filter,      setFilter]      = useState<'pending' | 'done'>('pending');
  const [staffFilter, setStaffFilter] = useState<string>('all');
  const [showAdd,     setShowAdd]     = useState(false);
  const [showVoice,   setShowVoice]   = useState(false);
  const [editing,     setEditing]     = useState<Task | null>(null);
  const [loading,     setLoading]     = useState(true);
  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  const load = async () => {
    const [t, s, c, tm] = await Promise.all([
      tasksAPI.list(),
      isAdmin ? staffAPI.list() : Promise.resolve([]),
      customersAPI.list(),
      teamsAPI.list().catch(() => [] as Team[]),
    ]);
    setTasks(t);
    setStaff(s);
    setCustomers(c);
    setTeams(tm);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const today = new Date().toISOString().split('T')[0];

  const staffFiltered = isAdmin && staffFilter !== 'all'
    ? tasks.filter(t => t.staffId === staffFilter)
    : tasks;

  const pending  = staffFiltered.filter(t => !t.completed);
  const done     = staffFiltered.filter(t => t.completed);

  // Separate personal tasks from team pool tasks
  const pendingPersonal = pending.filter(t => !t.teamId);
  const pendingPool     = pending.filter(t => !!t.teamId);

  const overdue  = pendingPersonal.filter(t => t.dueDate < today);
  const dueToday = pendingPersonal.filter(t => t.dueDate === today);
  const upcoming = pendingPersonal.filter(t => t.dueDate > today);

  const getTeamName = (teamId: string) => teams.find(tm => tm.id === teamId)?.name || 'Team';

  const handleComplete = async (id: string) => {
    await tasksAPI.complete(id);
    setTasks(prev => prev.map(t =>
      t.id === id ? { ...t, completed: !t.completed, completedAt: new Date().toISOString() } : t
    ));
  };

  const handleDelete = async (id: string) => {
    await tasksAPI.delete(id);
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  const handleSaved = useCallback((updated: Task) => {
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
    setEditing(null);
  }, []);

  const getStaffName = (id: string) => staff.find(s => s.id === id)?.name || '';

  // ── Task row ─────────────────────────────────────────────────────────────────
  function TaskItem({ task, poolMode }: { task: Task; poolMode?: boolean }) {
    const isOverdueTask = !task.completed && task.dueDate < today;
    const isDueToday    = !task.completed && task.dueDate === today;
    const fromDiary     = task.source === 'diary' && task.diaryEntryId;
    const isPool        = !!task.teamId;

    return (
      <div className={`card group transition-all ${
        isPool        ? 'border-indigo-500/25 bg-indigo-500/3' :
        isOverdueTask ? 'border-red-500/20' :
        isDueToday    ? 'border-gold/20'    : ''
      }`}>
        <div className="flex items-start gap-3">
          {/* Complete toggle */}
          <button
            onClick={() => handleComplete(task.id)}
            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${
              task.completed        ? 'bg-green-500/20 border-green-500/40' :
              isPool                ? 'border-indigo-400/40 hover:border-indigo-400 hover:bg-indigo-500/10' :
              isOverdueTask         ? 'border-red-500/40 hover:border-red-400 hover:bg-red-500/10' :
                                      'border-gold/30 hover:border-gold hover:bg-gold/10'
            }`}
          >
            {task.completed && <Check size={10} className="text-green-400" />}
          </button>

          <div className="flex-1 min-w-0">
            {/* Pool badge + title row */}
            <div className="flex items-start gap-2 flex-wrap">
              {isPool && task.teamId && (
                <span className="flex items-center gap-1 bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-[9px] font-semibold px-1.5 py-0.5 rounded-md flex-shrink-0 mt-0.5">
                  <Users size={8} />{getTeamName(task.teamId)} Pool
                </span>
              )}
              <p className={`text-sm font-medium ${task.completed ? 'line-through text-white/30' : 'text-white'}`}>
                {task.title}
              </p>
            </div>

            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {task.customerName && (
                <span className="text-white/30 text-xs flex items-center gap-1">
                  <User size={10} />{task.customerName}
                </span>
              )}
              {isAdmin && task.staffId && (
                <span className="text-gold/40 text-xs">{getStaffName(task.staffId)}</span>
              )}
              <span className={`text-xs flex items-center gap-1 ${
                isOverdueTask ? 'text-red-400' : isDueToday ? 'text-gold' : 'text-white/30'
              }`}>
                <Calendar size={10} />
                {isOverdueTask
                  ? `Overdue · ${task.dueDate}`
                  : isDueToday ? 'Due today' : task.dueDate}
              </span>
              {/* Reschedule badge */}
              {(task.rescheduledCount ?? 0) > 0 && (
                <span className="text-amber-400/60 text-[10px] flex items-center gap-0.5">
                  <RotateCcw size={8} />rescheduled {task.rescheduledCount}×
                </span>
              )}
              {/* Diary source link */}
              {fromDiary && (
                <button
                  onClick={e => { e.stopPropagation(); navigate('/diary'); }}
                  className="text-gold/40 text-[10px] flex items-center gap-0.5 hover:text-gold transition-colors"
                  title="From diary entry"
                >
                  <BookOpen size={9} />from diary
                </button>
              )}
            </div>

            {/* Notes / justification */}
            {task.notes && (
              <p className="text-white/25 text-xs mt-1.5 flex items-start gap-1">
                <StickyNote size={10} className="mt-0.5 flex-shrink-0 text-white/20" />
                <span className="break-words">{task.notes}</span>
              </p>
            )}
          </div>

          {/* Action buttons — visible on hover */}
          <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            {/* Edit — not shown for completed tasks (admin always can) */}
            {(!task.completed || isAdmin) && (
              <button
                onClick={() => setEditing(task)}
                className="p-1.5 rounded-lg text-white/20 hover:text-gold hover:bg-gold/10 transition-all"
                title="Edit / reschedule"
              >
                <Edit2 size={13} />
              </button>
            )}
            <button
              onClick={() => handleDelete(task.id)}
              className="p-1.5 rounded-lg text-white/10 hover:text-red-400 hover:bg-red-500/10 transition-all"
              title="Delete"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Quick "Add note" prompt for overdue with no notes yet */}
        {isOverdueTask && !task.notes && (
          <button
            onClick={() => setEditing(task)}
            className="mt-3 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl border border-dashed border-red-500/20 text-red-400/50 hover:text-red-400 hover:border-red-500/40 text-xs transition-colors"
          >
            <StickyNote size={11} />
            Add justification note
          </button>
        )}
      </div>
    );
  }

  if (loading) return (
    <div className="space-y-3">{Array(4).fill(0).map((_, i) => <div key={i} className="card h-16 shimmer" />)}</div>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Tasks</h1>
          <p className="text-white/30 text-sm mt-1">
            {pendingPersonal.length} personal · {pendingPool.length > 0 && <span className="text-indigo-300">{pendingPool.length} pool · </span>}
            {overdue.length > 0
              ? <span className="text-red-400">{overdue.length} overdue</span>
              : '0 overdue'}
          </p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2 flex-shrink-0">
          <Plus size={16} /><span className="hidden sm:inline">Add Task</span>
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex rounded-xl border border-dark-50 overflow-hidden w-fit">
          {(['pending', 'done'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-5 py-2 text-xs font-medium capitalize transition-colors ${
                filter === f ? 'bg-gold text-dark-500' : 'text-white/40 hover:text-white'
              }`}>
              {f === 'pending' ? `Pending (${pending.length})` : `Done (${done.length})`}
            </button>
          ))}
        </div>

        {isAdmin && staff.length > 0 && (
          <div className="flex items-center gap-2">
            <Filter size={13} className="text-white/30" />
            <select value={staffFilter} onChange={e => setStaffFilter(e.target.value)}
              className="input py-1.5 text-xs pr-7 w-auto">
              <option value="all">All Staff</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {staffFilter !== 'all' && (
              <button onClick={() => setStaffFilter('all')} className="text-white/30 hover:text-white">
                <X size={13} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Info strip for staff about edit/reschedule */}
      {!isAdmin && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-dark-400 border border-dark-50/50 rounded-xl text-xs text-white/30">
          <Edit2 size={11} className="text-gold/50 flex-shrink-0" />
          <span>Hover any task to edit title, notes, or reschedule. Rescheduling costs <span className="text-amber-400">−0.5 merit pts</span>. Adding notes to overdue tasks keeps your manager informed.</span>
        </div>
      )}

      {filter === 'pending' ? (
        <div className="space-y-6">
          {overdue.length > 0 && (
            <div>
              <p className="text-red-400 text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Clock size={11} /> Overdue ({overdue.length})
              </p>
              <div className="space-y-2">{overdue.map(t => <TaskItem key={t.id} task={t} />)}</div>
            </div>
          )}
          {dueToday.length > 0 && (
            <div>
              <p className="text-gold text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Calendar size={11} /> Due Today ({dueToday.length})
              </p>
              <div className="space-y-2">{dueToday.map(t => <TaskItem key={t.id} task={t} />)}</div>
            </div>
          )}
          {upcoming.length > 0 && (
            <div>
              <p className="text-white/30 text-xs font-semibold uppercase tracking-wider mb-2">
                Upcoming ({upcoming.length})
              </p>
              <div className="space-y-2">{upcoming.map(t => <TaskItem key={t.id} task={t} />)}</div>
            </div>
          )}
          {/* Team Pool tasks — distinct section with indigo styling */}
          {pendingPool.length > 0 && (
            <div>
              <p className="text-indigo-300 text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Users size={11} /> Team Pool ({pendingPool.length})
              </p>
              <p className="text-indigo-300/40 text-[10px] mb-3 -mt-1">
                Shared tasks — complete any of these to earn the merit points
              </p>
              <div className="space-y-2">{pendingPool.map(t => <TaskItem key={t.id} task={t} poolMode />)}</div>
            </div>
          )}

          {pendingPersonal.length === 0 && pendingPool.length === 0 && (
            <div className="card text-center py-16">
              <CheckCircle size={36} className="text-green-400/40 mx-auto mb-3" />
              <p className="text-white/40 font-medium">All caught up!</p>
              <p className="text-white/20 text-sm mt-1">No pending tasks. Add one to stay organised.</p>
              <button onClick={() => setShowAdd(true)} className="btn-primary mt-4">Add Task</button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {done.length === 0
            ? <p className="text-white/25 text-sm text-center py-8">No completed tasks yet</p>
            : done.map(t => <TaskItem key={t.id} task={t} />)
          }
        </div>
      )}

      {showAdd && (
        <AddTaskModal staff={staff} customers={customers}
          onClose={() => setShowAdd(false)}
          onCreated={t => { setTasks(p => [...p, t]); setShowAdd(false); }} />
      )}

      {editing && (
        <EditTaskModal task={editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved} />
      )}
    </div>
  );
}
