import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import { leadsAPI, staffAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { Lead, LeadStage, LeadSource, Staff } from '../types';
import { STAGES, STAGE_LABELS, SOURCE_LABELS } from './CRM';

const SOURCES: LeadSource[] = ['walk_in', 'referral', 'phone', 'instagram', 'whatsapp', 'other'];

interface FormState {
  name: string;
  phone: string;
  place: string;
  source: LeadSource;
  stage: LeadStage;
  assignedTo: string;
  nextFollowUp: string;
  visitDate: string;
  note: string;
}

const EMPTY: FormState = {
  name: '', phone: '', place: '',
  source: 'other', stage: 'new',
  assignedTo: '',
  nextFollowUp: '', visitDate: '', note: '',
};

export default function CRMForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const isEdit = !!id;

  const [form,      setForm]      = useState<FormState>(EMPTY);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [loading,   setLoading]   = useState(isEdit);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const [dirty,     setDirty]     = useState(false);

  // Load staff list for admin assignee picker
  useEffect(() => {
    if (!isAdmin) return;
    staffAPI.list().then((s: Staff[]) => setStaffList(s)).catch(() => {});
  }, [isAdmin]);

  // Load existing lead when editing
  useEffect(() => {
    if (!isEdit) return;
    leadsAPI.list().then((leads: Lead[]) => {
      const l = leads.find(x => x.id === id);
      if (l) {
        setForm({
          name:         l.name,
          phone:        l.phone || '',
          place:        l.place || '',
          source:       l.source,
          stage:        l.stage,
          assignedTo:   l.staffId || '',
          nextFollowUp: l.nextFollowUp || '',
          visitDate:    l.visitDate || '',
          note:         '',
        });
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id, isEdit]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm(f => ({ ...f, [k]: v }));
    setDirty(true);
  };

  const handleBack = () => {
    if (dirty && !confirm('You have unsaved changes. Leave anyway?')) return;
    navigate(isEdit ? `/crm/${id}` : '/crm');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      if (isEdit) {
        await leadsAPI.update(id!, {
          name:         form.name.trim(),
          phone:        form.phone.trim(),
          place:        form.place.trim(),
          source:       form.source,
          stage:        form.stage,
          nextFollowUp: form.nextFollowUp || null,
          visitDate:    form.visitDate || null,
        });
        navigate(`/crm/${id}`);
      } else {
        const lead: Lead = await leadsAPI.create({
          name:         form.name.trim(),
          phone:        form.phone.trim(),
          place:        form.place.trim(),
          source:       form.source,
          stage:        form.stage,
          nextFollowUp: form.nextFollowUp || null,
          visitDate:    form.visitDate || null,
          note:         form.note.trim(),
          ...(isAdmin && form.assignedTo ? { assignedTo: form.assignedTo } : {}),
        });
        setDirty(false);
        navigate(`/crm/${lead.id}`);
      }
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="card h-16 shimmer" />)}</div>
  );

  return (
    <div className="max-w-xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={handleBack} className="p-2 rounded-xl hover:bg-dark-200 text-white/40 hover:text-white transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-white">{isEdit ? 'Edit Lead' : 'New Lead'}</h1>
          <p className="text-white/30 text-xs mt-0.5">{isEdit ? 'Update lead details' : 'Add a new lead to the pipeline'}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="card space-y-4">
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-4 py-3 text-sm">{error}</div>
        )}

        {/* Name */}
        <div>
          <label className="label">Name *</label>
          <input
            autoFocus
            className="input"
            placeholder="e.g. Ramesh Gupta"
            value={form.name}
            onChange={e => set('name', e.target.value)}
          />
        </div>

        {/* Phone */}
        <div>
          <label className="label">Phone</label>
          <input
            className="input"
            type="tel"
            placeholder="e.g. 9876543210"
            value={form.phone}
            onChange={e => set('phone', e.target.value)}
          />
        </div>

        {/* Place */}
        <div>
          <label className="label">Place / City</label>
          <input
            className="input"
            placeholder="e.g. Noida, Sector 62"
            value={form.place}
            onChange={e => set('place', e.target.value)}
          />
        </div>

        {/* Assign to (admin only — new lead) */}
        {isAdmin && !isEdit && staffList.length > 0 && (
          <div>
            <label className="label">Assign to Staff</label>
            <select className="input" value={form.assignedTo} onChange={e => set('assignedTo', e.target.value)}>
              <option value="">Assign to myself</option>
              {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}

        {/* Source + Stage — side by side */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Source</label>
            <select className="input" value={form.source} onChange={e => set('source', e.target.value as LeadSource)}>
              {SOURCES.map(s => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Stage</label>
            <select className="input" value={form.stage} onChange={e => set('stage', e.target.value as LeadStage)}>
              {STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
            </select>
          </div>
        </div>

        {/* Follow-up + Visit — side by side */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Next Follow-up</label>
            <input
              type="date"
              className="input"
              value={form.nextFollowUp}
              onChange={e => set('nextFollowUp', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Visit Date</label>
            <input
              type="date"
              className="input"
              value={form.visitDate}
              onChange={e => set('visitDate', e.target.value)}
            />
          </div>
        </div>

        {/* Initial note — only for new leads */}
        {!isEdit && (
          <div>
            <label className="label">Initial Note (optional)</label>
            <textarea
              className="input resize-none"
              rows={3}
              placeholder="First contact details, how they found you, what they're looking for…"
              value={form.note}
              onChange={e => set('note', e.target.value)}
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={handleBack} className="btn-ghost flex-1">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-2">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Lead'}
          </button>
        </div>
      </form>
    </div>
  );
}
