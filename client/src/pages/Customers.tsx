import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Search, Phone, Mail, X, Check, ChevronDown, ChevronUp,
  Upload, Clock, MessageSquare, Calendar, TrendingUp, TrendingDown,
  Minus, Trash2, Users, Tag, UserPlus, StickyNote, Send,
  BookOpen, Pencil, Filter, ExternalLink,
} from 'lucide-react';
import { customersAPI, staffAPI, interactionsAPI, templatesAPI, aiAPI, tagDefsAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useSSE } from '../hooks/useSSE';
import type { Customer, CustomerNote, Staff, Interaction, PipelineStatus, Template, SentimentPoint, TagDef } from '../types';
import TagPicker from '../components/TagPicker';
import Portal from '../components/Portal';

// ── Pipeline config ────────────────────────────────────────────────────────────
const STAGES: { key: PipelineStatus; label: string; color: string; bg: string }[] = [
  { key: 'lead',        label: 'Lead',        color: 'text-white/50',   bg: 'bg-white/5' },
  { key: 'contacted',   label: 'Contacted',   color: 'text-blue-400',   bg: 'bg-blue-500/10' },
  { key: 'interested',  label: 'Interested',  color: 'text-gold',       bg: 'bg-gold/10' },
  { key: 'negotiating', label: 'Negotiating', color: 'text-orange-400', bg: 'bg-orange-500/10' },
  { key: 'closed',      label: 'Closed',      color: 'text-green-400',  bg: 'bg-green-500/10' },
  { key: 'churned',     label: 'Churned',     color: 'text-red-400',    bg: 'bg-red-500/10' },
];

function stageBadge(status: PipelineStatus) {
  const s = STAGES.find(x => x.key === status);
  if (!s) return null;
  return <span className={`badge ${s.bg} ${s.color} border border-current/20`}>{s.label}</span>;
}

// ── Avatar & heat helpers ──────────────────────────────────────────────────────
// Consistent avatar gradient color based on name
function getAvatarGradient(name: string): [string, string] {
  const palettes: [string, string][] = [
    ['#7c3aed', '#a855f7'], ['#2563eb', '#60a5fa'], ['#059669', '#34d399'],
    ['#d97706', '#fbbf24'], ['#dc2626', '#f87171'], ['#0891b2', '#22d3ee'],
    ['#be185d', '#f472b6'], ['#4338ca', '#818cf8'],
  ];
  const idx = (name.charCodeAt(0) + (name.charCodeAt(1) || 0)) % palettes.length;
  return palettes[idx];
}

// Heat level based on days since last contact
function getHeat(days: number | null) {
  if (days === null) return {
    color: 'text-red-400', label: '⚠ Never', glow: '0 0 14px rgba(248,113,113,0.55)', pulse: true,
    pill: 'bg-red-500/15 border-red-500/30 text-red-400',
  };
  if (days === 0) return {
    color: 'text-emerald-400', label: '● Today', glow: '0 0 12px rgba(52,211,153,0.55)', pulse: false,
    pill: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400',
  };
  if (days <= 3) return {
    color: 'text-blue-400', label: `${days}d ago`, glow: '0 0 10px rgba(96,165,250,0.4)', pulse: false,
    pill: 'bg-blue-500/10 border-blue-500/25 text-blue-400',
  };
  if (days <= 7) return {
    color: 'text-amber-400', label: `${days}d ago`, glow: '0 0 10px rgba(251,191,36,0.4)', pulse: false,
    pill: 'bg-amber-500/10 border-amber-500/25 text-amber-400',
  };
  return {
    color: 'text-red-400', label: `${days}d ago`, glow: '0 0 14px rgba(248,113,113,0.5)', pulse: true,
    pill: 'bg-red-500/15 border-red-500/30 text-red-400',
  };
}

// Stage left-border color (expanded panel)
const STAGE_BORDER: Record<string, string> = {
  lead: 'border-l-white/15', contacted: 'border-l-blue-500/50',
  interested: 'border-l-gold/60', negotiating: 'border-l-orange-500/60',
  closed: 'border-l-emerald-500/60', churned: 'border-l-red-500/40',
};

// Stage hex color — used for inline gradient effects
const STAGE_HEX: Record<string, string> = {
  lead: '#ffffff', contacted: '#3b82f6', interested: '#C9A84C',
  negotiating: '#f97316', closed: '#10b981', churned: '#ef4444',
};

// Stage card outer ring
const STAGE_RING: Record<string, string> = {
  lead:        'border-white/8',
  contacted:   'border-blue-500/30',
  interested:  'border-amber-400/40',
  negotiating: 'border-orange-500/35',
  closed:      'border-emerald-500/35',
  churned:     'border-red-500/25',
};

// ── Sentiment Trend ────────────────────────────────────────────────────────────
function SentimentTrendView({ customerId }: { customerId: string }) {
  const [trend, setTrend] = useState<SentimentPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    aiAPI.sentimentTrend(customerId)
      .then(d => { setTrend(d.trend || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [customerId]);

  if (loading) return <div className="text-xs text-white/25 py-2">Loading sentiment…</div>;
  if (trend.length === 0) return <div className="text-xs text-white/25 py-2">No sentiment data yet (add diary entries)</div>;

  const avg = trend.reduce((s, t) => s + t.score, 0) / trend.length;
  const Icon = avg > 0.6 ? TrendingUp : avg < 0.4 ? TrendingDown : Minus;
  const color = avg > 0.6 ? 'text-green-400' : avg < 0.4 ? 'text-red-400' : 'text-gold';

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={12} className={color} />
        <span className={`text-xs font-medium ${color}`}>
          {avg > 0.6 ? 'Positive trend' : avg < 0.4 ? 'Negative trend' : 'Neutral trend'}
        </span>
        <span className="text-white/20 text-xs">({trend.length} data points)</span>
      </div>
      <div className="flex gap-1 flex-wrap">
        {trend.slice(-8).map((t, i) => (
          <div key={i} className={`px-2 py-1 rounded-lg text-[10px] border ${
            t.sentiment === 'positive' ? 'bg-green-500/10 border-green-500/20 text-green-400' :
            t.sentiment === 'negative' ? 'bg-red-500/10 border-red-500/20 text-red-400' :
            'bg-white/5 border-dark-50 text-white/30'
          }`} title={t.notes}>
            {t.sentiment} · {t.date}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Templates picker ───────────────────────────────────────────────────────────
function TemplatePicker({ onSelect, onClose }: { onSelect: (content: string) => void; onClose: () => void }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  useEffect(() => { templatesAPI.list().then(setTemplates); }, []);

  if (templates.length === 0) return (
    <div className="absolute bottom-full mb-2 left-0 w-72 bg-dark-300 border border-dark-50 rounded-xl shadow-2xl p-3 z-10">
      <p className="text-white/30 text-xs text-center py-2">No templates yet — admin can add them</p>
    </div>
  );

  return (
    <div className="absolute bottom-full mb-2 left-0 w-72 bg-dark-300 border border-dark-50 rounded-xl shadow-2xl z-10 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-dark-50">
        <p className="text-white/50 text-xs font-medium uppercase tracking-wider">Templates</p>
        <button onClick={onClose} className="text-white/30 hover:text-white"><X size={12} /></button>
      </div>
      <div className="max-h-48 overflow-y-auto">
        {templates.map(t => (
          <button key={t.id} onClick={() => { onSelect(t.content); templatesAPI.use(t.id); onClose(); }}
            className="w-full text-left px-3 py-2.5 hover:bg-dark-200 transition-colors border-b border-dark-50/40 last:border-0">
            <p className="text-white text-xs font-medium">{t.title}</p>
            <p className="text-white/30 text-[10px] mt-0.5 truncate">{t.content}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Log Interaction Modal ──────────────────────────────────────────────────────
function LogInteractionModal({ customer, onClose, onLogged }: {
  customer: Customer; onClose: () => void; onLogged: (updated: Customer) => void;
}) {
  const [form, setForm] = useState({
    type: 'call' as Interaction['type'],
    responded: false,
    notes: '',
    followUpDate: '',
    followUpTitle: '',
    newStatus: customer.status,
  });
  const [loading, setLoading]     = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await interactionsAPI.create({
        customerId: customer.id, type: form.type, responded: form.responded,
        notes: form.notes, followUpDate: form.followUpDate || null, followUpTitle: form.followUpTitle || null,
      });
      if (form.newStatus !== customer.status) {
        await customersAPI.update(customer.id, { status: form.newStatus });
      }
      const updated = await customersAPI.get(customer.id);
      onLogged(updated);
    } finally { setLoading(false); }
  };

  const TYPE_OPTS: { val: Interaction['type']; label: string; icon: React.ElementType }[] = [
    { val: 'call', label: 'Call', icon: Phone },
    { val: 'message', label: 'Message', icon: MessageSquare },
    { val: 'email', label: 'Email', icon: Mail },
    { val: 'meeting', label: 'Meeting', icon: Calendar },
  ];

  return (
    <Portal>
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-dark-300 border border-dark-50 rounded-t-2xl sm:rounded-2xl w-full max-w-md shadow-2xl animate-slide-up sm:animate-scale-in max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-50 flex-shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Log Interaction</h2>
            <p className="text-white/30 text-xs mt-0.5">{customer.name}</p>
          </div>
          <button type="button" onClick={onClose} className="text-white/40 hover:text-white"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Type */}
          <div>
            <label className="label">Type</label>
            <div className="grid grid-cols-4 gap-2">
              {TYPE_OPTS.map(({ val, label, icon: Icon }) => (
                <button key={val} onClick={() => setForm(f => ({ ...f, type: val }))}
                  className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl border text-xs font-medium transition-all ${
                    form.type === val ? 'border-gold bg-gold/10 text-gold' : 'border-dark-50 text-white/40 hover:text-white hover:border-white/20'
                  }`}>
                  <Icon size={14} />{label}
                </button>
              ))}
            </div>
          </div>

          {/* Responded */}
          <div>
            <label className="label">Did they respond?</label>
            <div className="flex gap-3">
              {[{ val: true, label: 'Yes ✓' }, { val: false, label: 'No ✗' }].map(({ val, label }) => (
                <button key={String(val)} onClick={() => setForm(f => ({ ...f, responded: val }))}
                  className={`flex-1 py-2 rounded-xl border text-sm font-medium transition-all ${
                    form.responded === val
                      ? val ? 'border-green-500/50 bg-green-500/10 text-green-400' : 'border-red-500/50 bg-red-500/10 text-red-400'
                      : 'border-dark-50 text-white/40 hover:text-white'
                  }`}>{label}</button>
              ))}
            </div>
          </div>

          {/* Notes + Templates */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="label mb-0">Notes</label>
              <button onClick={() => setShowTemplates(s => !s)}
                className="text-gold/50 hover:text-gold text-[10px] font-medium uppercase tracking-wider transition-colors">
                Templates
              </button>
            </div>
            <div className="relative">
              {showTemplates && (
                <TemplatePicker onSelect={c => setForm(f => ({ ...f, notes: c }))} onClose={() => setShowTemplates(false)} />
              )}
              <textarea className="input resize-none" rows={3} placeholder="What was discussed?"
                value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>

          {/* Update stage */}
          <div>
            <label className="label">Update Pipeline Stage</label>
            <select className="input" value={form.newStatus}
              onChange={e => setForm(f => ({ ...f, newStatus: e.target.value as PipelineStatus }))}>
              {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>

          {/* Follow-up */}
          <div className="border-t border-dark-50 pt-4">
            <label className="label">Schedule Follow-up (optional)</label>
            <div className="space-y-2">
              <input type="date" className="input" value={form.followUpDate}
                min={new Date().toISOString().split('T')[0]}
                onChange={e => setForm(f => ({ ...f, followUpDate: e.target.value }))} />
              {form.followUpDate && (
                <input className="input" placeholder="Task title (e.g. 'Call back about pricing')"
                  value={form.followUpTitle} onChange={e => setForm(f => ({ ...f, followUpTitle: e.target.value }))} />
              )}
            </div>
          </div>
        </div>

        <div className="p-5 border-t border-dark-50 flex gap-3 flex-shrink-0">
          <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button type="button" onClick={handleSubmit} disabled={loading} className="btn-primary flex-1">
            <Check size={14} className="mr-1.5" />
            {loading ? 'Logging...' : 'Log Interaction'}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

// ── Staff Assignment Panel (inside expanded card) ─────────────────────────────
function StaffAssignPanel({ customer, allStaff, onChange }: {
  customer: Customer; allStaff: Staff[];
  onChange: (updated: Customer) => void;
}) {
  const [saving, setSaving] = useState(false);
  const current = customer.assignedStaff?.length
    ? customer.assignedStaff
    : (customer.assignedTo ? [customer.assignedTo] : []);

  const toggle = async (staffId: string) => {
    const next = current.includes(staffId)
      ? current.filter(id => id !== staffId)
      : [...current, staffId];
    setSaving(true);
    try {
      const updated = await customersAPI.update(customer.id, {
        assignedStaff: next,
        assignedTo: next[0] || null,
      });
      onChange(updated);
    } catch { /* silent */ }
    setSaving(false);
  };

  return (
    <div className="space-y-2">
      <p className="text-white/30 text-[10px] uppercase tracking-wider font-medium">
        Assigned Staff — click to add or remove
      </p>
      <div className="flex flex-wrap gap-2">
        {allStaff.map(s => {
          const active = current.includes(s.id);
          return (
            <button
              key={s.id}
              onClick={() => toggle(s.id)}
              disabled={saving}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all border disabled:opacity-50 ${
                active
                  ? 'border-gold/50 bg-gold/10 text-gold'
                  : 'border-dark-50 text-white/30 hover:text-white hover:border-white/20'
              }`}
            >
              {active && <span>✓</span>}
              {s.name}
            </button>
          );
        })}
      </div>
      {current.length === 0 && (
        <p className="text-white/20 text-xs">No staff assigned — customer is unassigned</p>
      )}
    </div>
  );
}

// ── Add Customer Modal ────────────────────────────────────────────────────────
function AddCustomerModal({ staff, isAdmin, selfId, onClose, onCreated }: {
  staff: Staff[]; isAdmin: boolean; selfId: string;
  onClose: () => void; onCreated: (c: Customer) => void;
}) {
  const [form, setForm] = useState({
    name: '', phone: '', email: '',
    // Multi-staff: admin starts empty, staff auto-assigns themselves
    assignedStaff: isAdmin ? [] as string[] : [selfId],
    notes: '', tags: [] as string[], status: 'lead' as PipelineStatus,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [linkedMsg, setLinkedMsg] = useState('');

  const toggleStaff = (id: string) => {
    setForm(f => ({
      ...f,
      assignedStaff: f.assignedStaff.includes(id)
        ? f.assignedStaff.filter(s => s !== id)
        : [...f.assignedStaff, id],
    }));
  };

  const doSubmit = async () => {
    if (!form.name) { setError('Name required'); return; }
    setLoading(true);
    setLinkedMsg('');
    try {
      const c = await customersAPI.create({
        name: form.name, phone: form.phone, email: form.email,
        notes: form.notes, status: form.status,
        assignedTo: form.assignedStaff[0] || null,
        assignedStaff: form.assignedStaff,
        tags: form.tags,
      });
      // autoLinked = true means an existing customer was found and staff was added
      if ((c as Customer & { autoLinked?: boolean }).autoLinked) {
        setLinkedMsg(`"${c.name}" already exists — you've been linked to that customer.`);
        setTimeout(() => { onCreated(c); }, 1800);
      } else {
        onCreated(c);
      }
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed');
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-dark-300 border border-dark-50 rounded-2xl w-full max-w-md shadow-2xl animate-scale-in max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-50 flex-shrink-0">
          <div>
            <h2 className="text-white font-semibold">Add Customer</h2>
            {!isAdmin && <p className="text-white/30 text-xs mt-0.5">Will be assigned to you</p>}
          </div>
          <button type="button" onClick={onClose} className="text-white/40 hover:text-white"><X size={18} /></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); doSubmit(); }} className="p-6 space-y-4 overflow-y-auto flex-1">
          {error     && <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-4 py-3 text-sm">{error}</div>}
          {linkedMsg && <div className="bg-gold/10 border border-gold/30 text-gold rounded-xl px-4 py-3 text-sm">{linkedMsg}</div>}
          <div><label className="label">Name *</label><input className="input" placeholder="Full name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Phone</label><input className="input" type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
            <div><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
          </div>
          <div>
            <label className="label">Stage</label>
            <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as PipelineStatus }))}>
              {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          {/* Multi-staff assignment — admin only */}
          {isAdmin && staff.length > 0 && (
            <div>
              <label className="label">Assign to Staff <span className="text-white/20 font-normal">(select multiple)</span></label>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {staff.map(s => {
                  const selected = form.assignedStaff.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleStaff(s.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all border ${
                        selected
                          ? 'border-gold/50 bg-gold/10 text-gold'
                          : 'border-dark-50 text-white/40 hover:text-white hover:border-white/20'
                      }`}
                    >
                      {selected && <span className="mr-1">✓</span>}{s.name}
                    </button>
                  );
                })}
              </div>
              {form.assignedStaff.length === 0 && (
                <p className="text-white/20 text-xs mt-1.5">No staff selected — customer will be unassigned</p>
              )}
            </div>
          )}
          <div>
            <label className="label">Tags</label>
            <TagPicker
              selected={form.tags}
              onChange={tags => setForm(f => ({ ...f, tags }))}
              isAdmin={isAdmin}
            />
          </div>
          <div><label className="label">Notes</label><textarea className="input resize-none" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
          <button type="submit" className="sr-only" aria-hidden>Submit</button>
        </form>
        <div className="px-6 pb-6 flex gap-3 flex-shrink-0">
          <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button type="button" onClick={doSubmit} disabled={loading} className="btn-primary flex-1">{loading ? 'Adding...' : 'Add Customer'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Customer interaction timeline (with delete) ───────────────────────────────
function CustomerTimeline({ customerId, isAdmin }: { customerId: string; isAdmin: boolean }) {
  const [items, setItems]     = useState<Interaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const TYPE_ICON: Record<string, React.ElementType> = {
    call: Phone, message: MessageSquare, email: Mail, meeting: Calendar,
    diary: BookOpen,
  };
  const TYPE_LABEL: Record<string, string> = {
    call: 'Call', message: 'Message', email: 'Email', meeting: 'Meeting',
    diary: 'Diary entry',
  };

  useEffect(() => {
    interactionsAPI.list({ customerId })
      .then(data => { setItems(data); setLoading(false); });
  }, [customerId]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this interaction log?')) return;
    setDeletingId(id);
    try {
      await interactionsAPI.delete(id);
      setItems(prev => prev.filter(x => x.id !== id));
    } catch { alert('Failed to delete interaction'); }
    finally { setDeletingId(null); }
  };

  if (loading) return <div className="py-4 text-center text-white/25 text-xs">Loading…</div>;
  if (items.length === 0) return (
    <div className="py-6 text-center text-white/25 text-xs">
      No interactions logged yet — use the Log button or add diary entries.
    </div>
  );

  return (
    <div className="space-y-0 mt-2">
      {items.map(i => {
        const Icon = TYPE_ICON[i.type] || Phone;
        const isExpanded = expandedId === i.id;
        const isDiary = i.type === 'diary';

        return (
          <div key={i.id} className="border-b border-dark-50/30 last:border-0 group">
            <div className="flex gap-3 py-2.5">
              {/* Type icon */}
              <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                isDiary     ? 'bg-purple-500/15'
                : i.responded ? 'bg-green-500/15'
                : 'bg-dark-200'
              }`}>
                <Icon size={12} className={
                  isDiary     ? 'text-purple-400'
                  : i.responded ? 'text-green-400'
                  : 'text-white/30'
                } />
              </div>

              <div className="flex-1 min-w-0">
                {/* Top row: type label + response + badges */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white/80 text-xs font-semibold">
                    {TYPE_LABEL[i.type] || i.type}
                  </span>
                  {!isDiary && (
                    <span className={`text-[10px] font-medium ${i.responded ? 'text-green-400' : 'text-red-400/60'}`}>
                      {i.responded ? '✓ Responded' : '✗ No response'}
                    </span>
                  )}
                  {i.source === 'webhook' && <span className="badge badge-gold text-[9px]">webhook</span>}
                  {i.source === 'kamal_ai' && <span className="badge bg-purple-500/10 text-purple-400 text-[9px]">Kamal AI</span>}
                </div>

                {/* Staff name — crucial for admin to see who did what */}
                {i.staffName && (
                  <p className="text-white/30 text-[10px] mt-0.5">
                    by <span className="text-gold/60 font-medium">{i.staffName}</span>
                  </p>
                )}

                {/* Notes — expandable if long */}
                {i.notes && (
                  <div className="mt-1">
                    <p className={`text-white/50 text-xs leading-relaxed ${!isExpanded && i.notes.length > 120 ? 'line-clamp-2' : ''}`}>
                      {i.notes}
                    </p>
                    {i.notes.length > 120 && (
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : i.id)}
                        className="text-white/20 hover:text-white/50 text-[10px] mt-0.5 transition-colors"
                      >
                        {isExpanded ? 'Show less ↑' : 'Show more ↓'}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Date + delete */}
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <span className="text-white/25 text-[10px] whitespace-nowrap">
                  {new Date(i.createdAt).toLocaleDateString('en-IN', {
                    day: 'numeric', month: 'short', year: 'numeric',
                  })}
                </span>
                <span className="text-white/15 text-[10px]">
                  {new Date(i.createdAt).toLocaleTimeString('en-IN', {
                    hour: '2-digit', minute: '2-digit',
                  })}
                </span>
                {(isAdmin || true) && (
                  <button
                    onClick={() => handleDelete(i.id)}
                    disabled={deletingId === i.id}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-white/20 hover:text-red-400 p-0.5 mt-0.5"
                    title="Delete this log"
                  >
                    {deletingId === i.id
                      ? <div className="w-3 h-3 border border-red-400/40 border-t-red-400 rounded-full animate-spin" />
                      : <Trash2 size={10} />}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Customer Notes (append-only timeline, each deletable) ─────────────────────
function CustomerNotes({ customerId }: { customerId: string }) {
  const [notes, setNotes]     = useState<CustomerNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [saving, setSaving]   = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [loaded, setLoaded]   = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    customersAPI.get(customerId).then(c => {
      setNotes(c.notesList || []);
      setLoaded(true);
    });
  }, [customerId]);

  const handleAdd = async () => {
    const text = newNote.trim();
    if (!text) return;
    setSaving(true);
    try {
      const note = await customersAPI.addNote(customerId, text);
      setNotes(prev => [...prev, note]);
      setNewNote('');
      inputRef.current?.focus();
    } finally { setSaving(false); }
  };

  const handleDelete = async (noteId: string) => {
    if (!confirm('Delete this note?')) return;
    setDeleting(noteId);
    try {
      await customersAPI.deleteNote(customerId, noteId);
      setNotes(prev => prev.filter(n => n.id !== noteId));
    } finally { setDeleting(null); }
  };

  if (!loaded) return <div className="py-4 text-center text-white/25 text-xs">Loading notes…</div>;

  return (
    <div className="space-y-3 mt-2">
      {/* Add note */}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          className="input flex-1 text-xs py-2"
          placeholder="Add a note… (e.g. 'Very interested in premium plan')"
          value={newNote}
          onChange={e => setNewNote(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAdd(); } }}
        />
        <button
          onClick={handleAdd}
          disabled={!newNote.trim() || saving}
          className="btn-primary text-xs py-2 px-3 flex-shrink-0 flex items-center gap-1"
        >
          <Send size={11} />{saving ? '…' : 'Add'}
        </button>
      </div>

      {/* Notes list — newest first */}
      {notes.length === 0 ? (
        <p className="text-white/20 text-xs text-center py-3">No notes yet — add your first one above</p>
      ) : (
        <div className="space-y-2">
          {[...notes].reverse().map(n => (
            <div key={n.id} className="flex gap-2 p-3 bg-dark-200 rounded-xl border border-dark-50/50 group">
              <div className="flex-1 min-w-0">
                <p className="text-white/70 text-xs leading-relaxed">{n.text}</p>
                <p className="text-white/25 text-[10px] mt-1.5">
                  {n.createdBy} · {new Date(n.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <button
                onClick={() => handleDelete(n.id)}
                disabled={deleting === n.id}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-white/20 hover:text-red-400 p-1 flex-shrink-0 self-start"
                title="Delete note"
              >
                {deleting === n.id
                  ? <div className="w-3 h-3 border border-red-400/40 border-t-red-400 rounded-full animate-spin" />
                  : <Trash2 size={11} />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── CSV Import Modal ──────────────────────────────────────────────────────────
function CSVImportModal({ staff, onClose, onImported }: {
  staff: Staff[]; onClose: () => void; onImported: (customers: Customer[]) => void;
}) {
  const [preview, setPreview]   = useState<Record<string, string>[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [assignTo, setAssignTo] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const parseCSV = (text: string) => text.trim().split('\n').filter(l => l.trim()).map(line =>
    line.split(',').map(c => c.replace(/^"|"$/g, '').trim())
  );

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      const rows = parseCSV(e.target?.result as string);
      setPreview(rows.slice(0, 5).map(r => ({ name: r[0]||'', phone: r[1]||'', email: r[2]||'', status: r[3]||'lead' })));
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!fileRef.current?.files?.[0]) { setError('Select a file first'); return; }
    setLoading(true);
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        const rows = parseCSV(e.target?.result as string);
        const customers = rows.map(r => ({ name:r[0]||'', phone:r[1]||'', email:r[2]||'', status:r[3]||'lead', assignedTo:assignTo||null })).filter(c => c.name);
        const result = await customersAPI.bulkImport(customers);
        onImported(result.customers);
      } catch { setError('Import failed. Check file format.'); }
      finally { setLoading(false); }
    };
    reader.readAsText(fileRef.current.files[0]);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-dark-300 border border-dark-50 rounded-2xl w-full max-w-lg shadow-2xl animate-slide-up max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-50 flex-shrink-0">
          <h2 className="text-white font-semibold">Import Customers via CSV</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {error && <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-4 py-3 text-sm">{error}</div>}
          <p className="text-white/40 text-xs">CSV format: <span className="font-mono text-white/60">Name, Phone, Email, Status</span></p>
          <input ref={fileRef} type="file" accept=".csv" className="input py-2 cursor-pointer file:bg-gold file:text-white file:border-0 file:rounded-lg file:px-3 file:py-1 file:text-xs file:font-semibold file:mr-3 file:cursor-pointer"
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
          <div>
            <label className="label">Assign all to staff (optional)</label>
            <select className="input" value={assignTo} onChange={e => setAssignTo(e.target.value)}>
              <option value="">Unassigned</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {preview.length > 0 && (
            <div className="overflow-x-auto border border-dark-50 rounded-xl">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-dark-50"><th className="text-left text-white/30 font-medium py-2 px-3">Name</th><th className="text-left text-white/30 font-medium py-2 px-3">Phone</th><th className="text-left text-white/30 font-medium py-2 px-3">Status</th></tr></thead>
                <tbody>{preview.map((row, i) => <tr key={i} className="border-b border-dark-50/40 last:border-0"><td className="py-2 px-3 text-white">{row.name}</td><td className="py-2 px-3 text-white/50">{row.phone}</td><td className="py-2 px-3">{stageBadge(row.status as PipelineStatus)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
        <div className="px-6 pb-6 flex gap-3 flex-shrink-0">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button onClick={handleImport} disabled={loading} className="btn-primary flex-1"><Upload size={14} className="mr-1.5" />{loading ? 'Importing...' : 'Import'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Bulk Actions Toolbar ──────────────────────────────────────────────────────
function BulkToolbar({ selected, staff, onAction, onClear }: {
  selected: string[]; staff: Staff[];
  onAction: (action: string, value?: string) => void;
  onClear: () => void;
}) {
  const [assignTo, setAssignTo] = useState('');
  const [stage, setStage]       = useState('');

  return (
    <div className="card border-gold/30 bg-gold/5 animate-slide-up flex flex-wrap items-center gap-3">
      <span className="text-gold font-semibold text-sm">{selected.length} selected</span>
      <div className="flex gap-2 flex-wrap flex-1">
        {staff.length > 0 && (
          <div className="flex gap-1">
            <select className="input py-1 text-xs h-8" value={assignTo} onChange={e => setAssignTo(e.target.value)}>
              <option value="">Assign to...</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button disabled={!assignTo} onClick={() => onAction('assign', assignTo)} className="btn-secondary py-1 px-3 text-xs h-8 flex items-center gap-1">
              <Users size={11} />Assign
            </button>
          </div>
        )}
        <div className="flex gap-1">
          <select className="input py-1 text-xs h-8" value={stage} onChange={e => setStage(e.target.value)}>
            <option value="">Move to stage...</option>
            {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <button disabled={!stage} onClick={() => onAction('stage', stage)} className="btn-secondary py-1 px-3 text-xs h-8">
            Move
          </button>
        </div>
        <button onClick={() => { if (confirm(`Delete ${selected.length} customers?`)) onAction('delete'); }}
          className="btn-danger py-1 px-3 text-xs h-8 flex items-center gap-1">
          <Trash2 size={11} />Delete
        </button>
      </div>
      <button onClick={onClear} className="text-white/30 hover:text-white text-xs">✕ Clear</button>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Customers() {
  const navigate = useNavigate();
  const [customers, setCustomers]     = useState<Customer[]>([]);
  const [staff, setStaff]             = useState<Staff[]>([]);
  const [search, setSearch]           = useState('');
  const [stageFilter, setStageFilter] = useState<PipelineStatus | 'all'>('all');
  const [tagFilter, setTagFilter]     = useState('');
  const [showAdd, setShowAdd]         = useState(false);
  const [showCSV, setShowCSV]         = useState(false);
  const [logging, setLogging]         = useState<Customer | null>(null);
  const [expanded, setExpanded]       = useState<string | null>(null);
  const [expandedTab, setExpandedTab] = useState<'timeline' | 'sentiment' | 'notes' | 'staff'>('timeline');
  const [loading, setLoading]         = useState(true);
  const [selected, setSelected]         = useState<string[]>([]);
  const [quickCreating, setQuickCreating] = useState(false);
  const [deletingId, setDeletingId]     = useState<string | null>(null);
  const [editingNameId,  setEditingNameId]  = useState<string | null>(null);
  const [editNameValue,  setEditNameValue]  = useState('');
  const [savingName,     setSavingName]     = useState(false);
  const [staffFilter,    setStaffFilter]    = useState<string>('all');
  const { isAdmin, user } = useAuth();

  const [tagDefs, setTagDefs] = useState<TagDef[]>([]);

  const load = async () => {
    // Load staff for everyone — needed for "Assign to" dropdown in admin mode
    // and to display staff names on cards
    const [c, s, defs] = await Promise.all([
      customersAPI.list(),
      staffAPI.list().catch(() => []),
      tagDefsAPI.list().catch(() => []),
    ]);
    setCustomers(c);
    setStaff(s);
    setTagDefs(defs);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // Real-time: new customers auto-created by diary analysis appear instantly
  useSSE({
    'customer:created': (c) => {
      setCustomers(prev =>
        prev.find(x => x.id === (c as Customer).id) ? prev : [...prev, c as Customer]
      );
    },
    'customer:updated': (c) => {
      setCustomers(prev => prev.map(x => x.id === (c as Customer).id ? { ...x, ...(c as Customer) } : x));
    },
  });

  // All unique tags across customers
  const allTags = [...new Set(customers.flatMap(c => c.tags || []))];

  const filtered = customers.filter(c => {
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase())
      || c.phone.includes(search) || c.email.toLowerCase().includes(search.toLowerCase());
    const matchStage  = stageFilter === 'all' || c.status === stageFilter;
    const matchTag    = !tagFilter || (c.tags || []).includes(tagFilter);
    const allAssigned = c.assignedStaff?.length ? c.assignedStaff : (c.assignedTo ? [c.assignedTo] : []);
    const matchStaff  = !isAdmin || staffFilter === 'all'
      || (staffFilter === 'unassigned'
        ? allAssigned.length === 0
        : allAssigned.includes(staffFilter));
    return matchSearch && matchStage && matchTag && matchStaff;
  }).sort((a, b) => {
    // Overdue first, then by health score descending
    const da = a.lastContact ? Date.now() - new Date(a.lastContact).getTime() : Infinity;
    const db = b.lastContact ? Date.now() - new Date(b.lastContact).getTime() : Infinity;
    return db - da;
  });

  // Stage counts respect the active staff filter so pill numbers stay accurate
  const staffFiltered = isAdmin && staffFilter !== 'all'
    ? customers.filter(c => staffFilter === 'unassigned' ? !c.assignedTo : c.assignedTo === staffFilter)
    : customers;
  const stageCounts = STAGES.reduce((acc, s) => {
    acc[s.key] = staffFiltered.filter(c => c.status === s.key).length;
    return acc;
  }, {} as Record<string, number>);

  const activeCount = customers.filter(c => !['churned'].includes(c.status)).length;

  const getStaffName = (id: string | null) => id ? staff.find(s => s.id === id)?.name || 'Unknown' : 'Unassigned';

  const toggleSelect = (id: string) =>
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const handleBulkAction = async (action: string, value?: string) => {
    try {
      await customersAPI.bulkActions(selected, action, value);
      setSelected([]);
      load();
    } catch (err: unknown) {
      alert('Action failed: ' + ((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Unknown error'));
    }
  };

  const handleDeleteCustomer = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await customersAPI.delete(id);
      // Remove from state immediately — no need to reload
      setCustomers(prev => prev.filter(c => c.id !== id));
      setExpanded(prev => prev === id ? null : prev);
    } catch (err: unknown) {
      alert('Delete failed: ' + ((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Unknown error'));
    } finally {
      setDeletingId(null);
    }
  };

  // Quick-create: staff types a name → customer doesn't exist → one click creates + opens log modal
  const handleQuickCreate = async (name: string) => {
    if (!name.trim()) return;
    setQuickCreating(true);
    try {
      const newCustomer = await customersAPI.create({
        name: name.trim(),
        // Server auto-assigns to self for staff; admin leaves unassigned
        assignedTo: isAdmin ? null : user?.id || null,
      });
      // Add to list and clear search so the new card is visible
      setCustomers(prev => [...prev, newCustomer]);
      setSearch('');
      // Open the log modal immediately on the newly created customer
      setLogging(newCustomer);
    } catch {
      // fallback: just open the Add Customer modal with the name pre-filled
      setShowAdd(true);
    } finally {
      setQuickCreating(false);
    }
  };

  // Admin-only: inline rename a customer
  const handleNameSave = async (id: string) => {
    const name = editNameValue.trim();
    if (!name) return;
    setSavingName(true);
    try {
      const updated = await customersAPI.update(id, { name });
      setCustomers(prev => prev.map(c => c.id === id ? { ...c, name: updated.name } : c));
      setEditingNameId(null);
      setEditNameValue('');
    } catch {
      /* keep edit open so admin can retry */
    } finally { setSavingName(false); }
  };

  if (loading) return <div className="space-y-3">{Array(5).fill(0).map((_, i) => <div key={i} className="card h-16 shimmer" />)}</div>;

  const overdueCount = customers.filter(c => {
    const days = c.lastContact ? Math.round((Date.now() - new Date(c.lastContact).getTime()) / 86400000) : null;
    return days !== null && days > 7;
  }).length;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Customers</h1>
          <p className="text-white/30 text-sm mt-0.5">
            {isAdmin && staffFilter !== 'all'
              ? `Showing ${filtered.length} of ${customers.length}`
              : `${customers.length} contacts`}
            {isAdmin && staffFilter !== 'all' && (
              <span className="ml-2 badge bg-gold/10 text-gold border-gold/20 text-[10px]">
                {staffFilter === 'unassigned' ? 'Unassigned' : staff.find(s => s.id === staffFilter)?.name || 'Staff'}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <button onClick={() => setShowCSV(true)} className="btn-secondary flex items-center gap-2">
              <Upload size={14} /><span className="hidden sm:inline">Import CSV</span>
            </button>
          )}
          <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2">
            <Plus size={14} /><span className="hidden sm:inline">Add Customer</span>
          </button>
        </div>
      </div>

      {/* Mini stat row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card py-3 px-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-500/15 flex items-center justify-center flex-shrink-0"
            style={{ boxShadow: '0 0 12px rgba(96,165,250,0.2)' }}>
            <Users size={16} className="text-blue-400" />
          </div>
          <div>
            <p className="text-white font-bold text-lg leading-none">{customers.length}</p>
            <p className="text-white/30 text-[10px] mt-0.5">Total</p>
          </div>
        </div>
        <div className="card py-3 px-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 flex items-center justify-center flex-shrink-0"
            style={{ boxShadow: '0 0 12px rgba(52,211,153,0.2)' }}>
            <TrendingUp size={16} className="text-emerald-400" />
          </div>
          <div>
            <p className="text-white font-bold text-lg leading-none">{activeCount}</p>
            <p className="text-white/30 text-[10px] mt-0.5">Active</p>
          </div>
        </div>
        <div className="card py-3 px-4 flex items-center gap-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${overdueCount > 0 ? 'bg-red-500/15' : 'bg-white/5'}`}
            style={overdueCount > 0 ? { boxShadow: '0 0 12px rgba(248,113,113,0.25)' } : undefined}>
            <Clock size={16} className={overdueCount > 0 ? 'text-red-400' : 'text-white/20'} />
          </div>
          <div>
            <p className={`font-bold text-lg leading-none ${overdueCount > 0 ? 'text-red-400' : 'text-white/30'}`}>{overdueCount}</p>
            <p className="text-white/30 text-[10px] mt-0.5">Overdue</p>
          </div>
        </div>
      </div>

      {/* Bulk toolbar */}
      {selected.length > 0 && (
        <BulkToolbar selected={selected} staff={staff} onAction={handleBulkAction} onClear={() => setSelected([])} />
      )}

      {/* Pipeline stage pills */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setStageFilter('all')}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${stageFilter === 'all' ? 'bg-gold text-black shadow-[0_0_12px_rgba(212,175,55,0.4)]' : 'border border-dark-50 text-white/40 hover:text-white hover:border-white/20'}`}>
          All {staffFiltered.length}
        </button>
        {STAGES.map(s => (
          <button key={s.key} onClick={() => setStageFilter(s.key)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              stageFilter === s.key
                ? `${s.bg} ${s.color} border border-current/40 shadow-[0_0_10px_currentColor/20]`
                : 'border border-dark-50 text-white/40 hover:text-white hover:border-white/20'
            }`}>
            {s.label} <span className={`ml-1 ${stageFilter === s.key ? 'opacity-70' : 'opacity-50'}`}>{stageCounts[s.key] || 0}</span>
          </button>
        ))}
      </div>

      {/* Search + Tag + Staff filter */}
      <div className="space-y-2">
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[160px]">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
            <input type="text" placeholder="Search by name, phone, or email…" value={search}
              onChange={e => setSearch(e.target.value)} className="input pl-10" />
          </div>
          {/* Admin-only: filter by assigned staff */}
          {isAdmin && staff.length > 0 && (
            <div className="relative">
              <Filter size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
              <select
                className="input pl-8 w-auto"
                value={staffFilter}
                onChange={e => { setStaffFilter(e.target.value); setSelected([]); }}
              >
                <option value="all">All Staff</option>
                <option value="unassigned">Unassigned</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          {allTags.length > 0 && (
            <div className="relative">
              <Tag size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <select className="input pl-8 w-auto" value={tagFilter} onChange={e => setTagFilter(e.target.value)}>
                <option value="">All tags</option>
                {allTags.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* ── Quick-create strip: shown when search text matches no existing customer ── */}
        {search.trim().length > 1 && filtered.length === 0 && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-gold/25 bg-gold/5 animate-fade-in">
            <div className="flex items-center gap-2 min-w-0">
              <UserPlus size={15} className="text-gold flex-shrink-0" />
              <span className="text-white/50 text-sm truncate">
                No customer named <span className="text-white font-semibold">"{search.trim()}"</span>
              </span>
            </div>
            <button
              onClick={() => handleQuickCreate(search.trim())}
              disabled={quickCreating}
              className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap"
            >
              <Plus size={12} />
              {quickCreating ? 'Creating…' : `Add & Log`}
            </button>
          </div>
        )}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="card flex flex-col items-center py-16 text-center">
          <Phone size={36} className="text-white/10 mb-4" />
          <p className="text-white/40 font-medium">
            {search.trim() ? `No customer matches "${search}"` : 'No customers yet'}
          </p>
          <p className="text-white/20 text-xs mt-1">
            {search.trim() ? 'Use the button above to add them instantly' : 'Add your first customer to get started'}
          </p>
          {!search.trim() && (
            <button onClick={() => setShowAdd(true)} className="btn-primary mt-4">Add Customer</button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(c => {
            const days         = c.lastContact
              ? Math.round((Date.now() - new Date(c.lastContact).getTime()) / 86400000) : null;
            const heat         = getHeat(days);
            const [c1, c2]     = getAvatarGradient(c.name);
            const stageHex     = STAGE_HEX[c.status] || '#ffffff';
            const isOpen       = expanded === c.id;
            const isChecked    = selected.includes(c.id);
            const assignedIds  = c.assignedStaff?.length ? c.assignedStaff : (c.assignedTo ? [c.assignedTo] : []);
            const customerTags = (c.tags || []).filter(t => t !== 'crm-lead' && t !== 'bulk-import' && t !== 'diary-import');

            return (
              <div
                key={c.id}
                className={`group relative rounded-2xl border overflow-hidden bg-dark-400 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-2xl ${
                  STAGE_RING[c.status] || 'border-white/8'
                } ${isChecked ? '!border-gold/60 ring-2 ring-gold/20' : ''}`}
                style={isChecked ? { boxShadow: '0 0 0 2px rgba(201,168,76,0.25)' } : undefined}
              >
                {/* Stage color tint overlay — transparent gradient, adapts to any bg */}
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{ background: `linear-gradient(120deg, ${stageHex}12 0%, transparent 40%)` }}
                />

                {/* Left accent bar — vivid stage color */}
                <div
                  className="absolute left-0 top-0 bottom-0 w-[3px] z-10"
                  style={{ background: `linear-gradient(to bottom, ${stageHex}cc, ${stageHex}44)` }}
                />

                {/* Card body */}
                <div className="relative pl-5 pr-4 pt-4 pb-3">
                  <div className="flex gap-3.5">

                    {/* Checkbox */}
                    {isAdmin && (
                      <div className="flex-shrink-0 pt-1.5">
                        <input type="checkbox" checked={isChecked} onChange={() => toggleSelect(c.id)}
                          className="accent-gold w-4 h-4 cursor-pointer" onClick={e => e.stopPropagation()} />
                      </div>
                    )}

                    {/* Avatar — large, glowing, clickable */}
                    <button
                      onClick={() => navigate(`/customers/${c.id}`)}
                      className="flex-shrink-0 focus:outline-none group/avatar"
                      title="Open customer profile"
                    >
                      <div
                        className="w-14 h-14 rounded-2xl flex items-center justify-center font-black text-2xl text-white transition-all duration-200 group-hover/avatar:scale-105"
                        style={{
                          background: `linear-gradient(135deg, ${c1}, ${c2})`,
                          boxShadow: `0 6px 24px ${c1}55, ${heat.glow}`,
                        }}
                      >
                        {c.name[0].toUpperCase()}
                      </div>
                    </button>

                    {/* Main info */}
                    <div className="flex-1 min-w-0">

                      {/* Top row: name + heat badge */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          {isAdmin && editingNameId === c.id ? (
                            <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                              <input
                                autoFocus
                                className="bg-dark-200 border border-gold/50 text-white font-bold rounded-lg px-2 py-0.5 text-sm focus:outline-none focus:border-gold w-44"
                                value={editNameValue}
                                onChange={e => setEditNameValue(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') handleNameSave(c.id);
                                  if (e.key === 'Escape') { setEditingNameId(null); setEditNameValue(''); }
                                }}
                              />
                              <button onClick={() => handleNameSave(c.id)} disabled={savingName || !editNameValue.trim()}
                                className="text-green-400 hover:text-green-300 p-0.5 disabled:opacity-40">
                                {savingName ? <div className="w-3 h-3 border border-green-400/40 border-t-green-400 rounded-full animate-spin" /> : <Check size={13} />}
                              </button>
                              <button onClick={() => { setEditingNameId(null); setEditNameValue(''); }}
                                className="text-white/30 hover:text-white p-0.5"><X size={13} /></button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 group/name">
                              <button
                                onClick={() => navigate(`/customers/${c.id}`)}
                                className="text-white font-bold text-lg leading-tight hover:text-gold transition-colors text-left"
                              >
                                {c.name}
                              </button>
                              <button onClick={e => { e.stopPropagation(); setEditingNameId(c.id); setEditNameValue(c.name); }}
                                className="text-white/20 hover:text-gold transition-colors p-0.5 opacity-0 group-hover/name:opacity-100"
                                title="Rename customer">
                                <Pencil size={11} />
                              </button>
                            </div>
                          )}

                          {/* Contact info */}
                          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                            {c.phone && (
                              <a href={`tel:${c.phone}`} onClick={e => e.stopPropagation()}
                                className="text-white/40 text-xs flex items-center gap-1 hover:text-white/80 transition-colors">
                                <Phone size={9} className="text-white/25" />{c.phone}
                              </a>
                            )}
                            {c.email && (
                              <span className="text-white/25 text-xs flex items-center gap-1">
                                <Mail size={9} />{c.email}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Heat pill — prominent status badge */}
                        <div
                          className={`flex-shrink-0 px-2.5 py-1 rounded-xl text-[10px] font-bold border ${heat.pill} ${heat.pulse ? 'animate-glow-breathe' : ''}`}
                          style={{ boxShadow: heat.glow }}
                        >
                          {heat.label}
                        </div>
                      </div>

                      {/* Stage + tags + assigned staff */}
                      <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                        {stageBadge(c.status)}
                        {customerTags.map(t => {
                          const def = tagDefs.find(d => d.name === t);
                          return def ? (
                            <span
                              key={t}
                              className="text-[10px] px-2 py-0.5 rounded-full border font-semibold"
                              style={{ color: def.color, background: `${def.color}18`, borderColor: `${def.color}40` }}
                            >{t}</span>
                          ) : (
                            <span key={t} className="badge badge-gold text-[10px]">{t}</span>
                          );
                        })}
                        {isAdmin && assignedIds.length > 0 && (
                          <span className="text-[10px] text-gold/45 font-medium">
                            → {assignedIds.map(id => getStaffName(id)).filter(Boolean).join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* ── Bottom action bar ── */}
                  <div className="flex items-center justify-between mt-3.5 pt-3 border-t border-white/5">
                    {/* Profile CTA */}
                    <button
                      onClick={() => navigate(`/customers/${c.id}`)}
                      className="flex items-center gap-1.5 text-xs font-semibold text-gold/70 hover:text-gold transition-all group/profile"
                    >
                      <div className="w-5 h-5 rounded-md bg-gold/10 group-hover/profile:bg-gold/20 flex items-center justify-center transition-colors">
                        <ExternalLink size={10} className="text-gold" />
                      </div>
                      Full Profile
                    </button>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setLogging(c)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 text-white/70 hover:text-white transition-all"
                      >
                        <Clock size={11} className="text-white/40" /> Log
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => handleDeleteCustomer(c.id, c.name)}
                          disabled={deletingId === c.id}
                          className="p-1.5 text-red-400/20 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all disabled:opacity-40"
                          title="Delete customer"
                        >
                          {deletingId === c.id
                            ? <div className="w-3.5 h-3.5 border border-red-400/40 border-t-red-400 rounded-full animate-spin" />
                            : <Trash2 size={13} />}
                        </button>
                      )}
                      <button
                        onClick={() => setExpanded(isOpen ? null : c.id)}
                        className={`p-1.5 rounded-xl transition-all ${isOpen ? 'bg-white/8 text-white' : 'text-white/25 hover:text-white hover:bg-white/5'}`}
                        title={isOpen ? 'Collapse' : 'Expand history & notes'}
                      >
                        <ChevronDown size={14} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* ── Expanded drawer — smooth height with CSS grid trick ── */}
                <div
                  className="grid transition-all duration-300 ease-out"
                  style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
                >
                  <div className="overflow-hidden">
                    <div className="relative border-t border-dark-50/30 bg-dark-300 px-5 pt-3 pb-4">
                      <div className="flex gap-1 mb-3 flex-wrap">
                        {[
                          { key: 'timeline',  label: '📋 History' },
                          { key: 'notes',     label: '📝 Notes'   },
                          { key: 'sentiment', label: '📈 Sentiment' },
                          ...(isAdmin ? [{ key: 'staff', label: '👥 Staff' }] : []),
                        ].map(({ key, label }) => (
                          <button key={key} onClick={() => setExpandedTab(key as typeof expandedTab)}
                            className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                              expandedTab === key ? 'bg-gold/10 text-gold' : 'text-white/30 hover:text-white/70'
                            }`}>
                            {label}
                          </button>
                        ))}
                      </div>
                      {expandedTab === 'timeline'  && <CustomerTimeline customerId={c.id} isAdmin={isAdmin} />}
                      {expandedTab === 'notes'     && <CustomerNotes customerId={c.id} />}
                      {expandedTab === 'sentiment' && <SentimentTrendView customerId={c.id} />}
                      {expandedTab === 'staff' && isAdmin && (
                        <StaffAssignPanel
                          customer={c}
                          allStaff={staff}
                          onChange={updated => setCustomers(prev => prev.map(x => x.id === updated.id ? updated : x))}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAdd  && <AddCustomerModal staff={staff} isAdmin={isAdmin} selfId={user?.id || ''} onClose={() => setShowAdd(false)} onCreated={c => {
        const linked = (c as Customer & { autoLinked?: boolean }).autoLinked;
        setCustomers(p => linked
          ? p.map(x => x.id === c.id ? { ...x, ...c } : x)   // update existing
          : [...p, c]                                           // add new
        );
        setShowAdd(false);
      }} />}
      {showCSV  && <CSVImportModal staff={staff} onClose={() => setShowCSV(false)} onImported={cs => { setCustomers(p => [...p, ...cs]); setShowCSV(false); }} />}
      {logging  && <LogInteractionModal customer={logging} onClose={() => setLogging(null)} onLogged={u => { setCustomers(p => p.map(c => c.id === u.id ? u : c)); setLogging(null); }} />}
    </div>
  );
}
