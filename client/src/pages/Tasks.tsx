import { useEffect, useState } from 'react';
import { Plus, Check, Trash2, X, Calendar, User, Clock, CheckCircle, Filter } from 'lucide-react';
import { tasksAPI, staffAPI, customersAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { Task, Staff, Customer } from '../types';

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
            <input className="input" placeholder="e.g. Call back about pricing" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
          <div><label className="label">Due Date *</label>
            <input type="date" className="input" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} /></div>
          {isAdmin && (
            <div><label className="label">Assign to Staff</label>
              <select className="input" value={form.assignedTo} onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value, customerId: '' }))}>
                <option value="">Assign to myself</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          <div><label className="label">Linked Customer (optional)</label>
            <select className="input" value={form.customerId} onChange={e => setForm(f => ({ ...f, customerId: e.target.value }))}>
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
          <button onClick={submit} disabled={loading} className="btn-primary flex-1">{loading ? 'Adding...' : 'Add Task'}</button>
        </div>
      </div>
    </div>
  );
}

export default function Tasks() {
  const [tasks, setTasks]       = useState<Task[]>([]);
  const [staff, setStaff]       = useState<Staff[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filter, setFilter]     = useState<'pending' | 'done'>('pending');
  const [staffFilter, setStaffFilter] = useState<string>('all');
  const [showAdd, setShowAdd]   = useState(false);
  const [loading, setLoading]   = useState(true);
  const { isAdmin } = useAuth();

  const load = async () => {
    const [t, s, c] = await Promise.all([
      tasksAPI.list(),
      isAdmin ? staffAPI.list() : Promise.resolve([]),
      customersAPI.list(),
    ]);
    setTasks(t);
    setStaff(s);
    setCustomers(c);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const today = new Date().toISOString().split('T')[0];

  const staffFiltered = isAdmin && staffFilter !== 'all'
    ? tasks.filter(t => t.staffId === staffFilter)
    : tasks;

  const pending = staffFiltered.filter(t => !t.completed);
  const done    = staffFiltered.filter(t => t.completed);

  const overdue  = pending.filter(t => t.dueDate < today);
  const dueToday = pending.filter(t => t.dueDate === today);
  const upcoming = pending.filter(t => t.dueDate > today);

  const handleComplete = async (id: string) => {
    await tasksAPI.complete(id);
    setTasks(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed, completedAt: new Date().toISOString() } : t));
  };

  const handleDelete = async (id: string) => {
    await tasksAPI.delete(id);
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  const getStaffName = (id: string) => staff.find(s => s.id === id)?.name || '';

  function TaskItem({ task }: { task: Task }) {
    const isOverdue = !task.completed && task.dueDate < today;
    const isDueToday = !task.completed && task.dueDate === today;
    return (
      <div className={`card flex items-start gap-3 group ${isOverdue ? 'border-red-500/20' : isDueToday ? 'border-gold/20' : ''}`}>
        <button
          onClick={() => handleComplete(task.id)}
          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${
            task.completed
              ? 'bg-green-500/20 border-green-500/40'
              : isOverdue ? 'border-red-500/40 hover:border-red-400 hover:bg-red-500/10'
              : 'border-gold/30 hover:border-gold hover:bg-gold/10'
          }`}
        >
          {task.completed && <Check size={10} className="text-green-400" />}
        </button>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${task.completed ? 'line-through text-white/30' : 'text-white'}`}>
            {task.title}
          </p>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {task.customerName && (
              <span className="text-white/30 text-xs flex items-center gap-1"><User size={10} />{task.customerName}</span>
            )}
            {isAdmin && task.staffId && (
              <span className="text-gold/40 text-xs">{getStaffName(task.staffId)}</span>
            )}
            <span className={`text-xs flex items-center gap-1 ${
              isOverdue ? 'text-red-400' : isDueToday ? 'text-gold' : 'text-white/30'
            }`}>
              <Calendar size={10} />
              {isOverdue ? `Overdue · ${task.dueDate}` : isDueToday ? 'Due today' : task.dueDate}
            </span>
          </div>
          {task.notes && <p className="text-white/25 text-xs mt-1">{task.notes}</p>}
        </div>
        <button onClick={() => handleDelete(task.id)}
          className="p-1.5 rounded-lg text-white/10 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100 flex-shrink-0">
          <Trash2 size={13} />
        </button>
      </div>
    );
  }

  if (loading) return <div className="space-y-3">{Array(4).fill(0).map((_, i) => <div key={i} className="card h-16 shimmer" />)}</div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Tasks</h1>
          <p className="text-white/30 text-sm mt-1">
            {pending.length} pending · {overdue.length > 0 ? <span className="text-red-400">{overdue.length} overdue</span> : '0 overdue'}
          </p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2 flex-shrink-0">
          <Plus size={16} /><span className="hidden sm:inline">Add Task</span>
        </button>
      </div>

      {/* Toggle */}
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
              <p className="text-white/30 text-xs font-semibold uppercase tracking-wider mb-2">Upcoming ({upcoming.length})</p>
              <div className="space-y-2">{upcoming.map(t => <TaskItem key={t.id} task={t} />)}</div>
            </div>
          )}
          {pending.length === 0 && (
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
        <AddTaskModal staff={staff} customers={customers} onClose={() => setShowAdd(false)}
          onCreated={t => { setTasks(p => [...p, t]); setShowAdd(false); }} />
      )}
    </div>
  );
}
