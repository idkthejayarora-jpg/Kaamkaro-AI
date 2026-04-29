import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Loader2, Search, X, User } from 'lucide-react';
import { leadsAPI, staffAPI, customersAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { Lead, LeadStage, LeadSource, Staff } from '../types';
import { STAGES, STAGE_LABELS, SOURCE_LABELS } from './CRM';

const SOURCES: LeadSource[] = ['walk_in', 'referral', 'phone', 'instagram', 'whatsapp', 'other'];

interface Customer {
  id: string;
  name: string;
  phone?: string;
  place?: string;
}

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

  const [form,            setForm]            = useState<FormState>(EMPTY);
  const [staffList,       setStaffList]       = useState<Staff[]>([]);
  const [customers,       setCustomers]       = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSearch,  setCustomerSearch]  = useState('');
  const [showDropdown,    setShowDropdown]    = useState(false);
  const [loading,         setLoading]         = useState(isEdit);
  const [saving,          setSaving]          = useState(false);
  const [error,           setError]           = useState('');
  const [dirty,           setDirty]           = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Load customers + staff list
  useEffect(() => {
    customersAPI.list().then((data: Customer[]) => setCustomers(data)).catch(() => {});
    if (isAdmin) staffAPI.list().then((s: Staff[]) => setStaffList(s)).catch(() => {});
  }, [isAdmin]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    (c.phone && c.phone.includes(customerSearch))
  ).slice(0, 8);

  const selectCustomer = (c: Customer) => {
    setSelectedCustomer(c);
    setCustomerSearch(c.name);
    setShowDropdown(false);
    setForm(f => ({
      ...f,
      name:  c.name,
      phone: c.phone || '',
      place: (c as any).place || f.place,
    }));
    setDirty(true);
  };

  const clearCustomer = () => {
    setSelectedCustomer(null);
    setCustomerSearch('');
    setForm(f => ({ ...f, name: '', phone: '', place: '' }));
  };

  const handleBack = () => {
    if (dirty && !confirm('You have unsaved changes. Leave anyway?')) return;
    navigate(isEdit ? `/crm/${id}` : '/crm');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() && !selectedCustomer) { setError('Select a customer or enter a name'); return; }
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
          ...(selectedCustomer ? { customerId: selectedCustomer.id } : {}),
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

        {/* Customer picker — only for new leads */}
        {!isEdit && (
          <div ref={searchRef}>
            <label className="label">Customer *</label>

            {selectedCustomer ? (
              /* Selected customer chip */
              <div className="flex items-center gap-3 px-4 py-3 bg-gold/5 border border-gold/20 rounded-xl">
                <div className="w-8 h-8 rounded-lg bg-gold/15 flex items-center justify-center flex-shrink-0">
                  <span className="text-gold text-sm font-bold">{selectedCustomer.name[0].toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-semibold">{selectedCustomer.name}</p>
                  {selectedCustomer.phone
                    ? <p className="text-white/30 text-xs">{selectedCustomer.phone}</p>
                    : <p className="text-amber-400/60 text-xs">No phone — add below</p>
                  }
                </div>
                <button type="button" onClick={clearCustomer} className="text-white/30 hover:text-white transition-colors">
                  <X size={16} />
                </button>
              </div>
            ) : (
              /* Search box */
              <div className="relative">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                  <input
                    className="input pl-9"
                    placeholder="Search by name or phone…"
                    value={customerSearch}
                    onChange={e => { setCustomerSearch(e.target.value); setShowDropdown(true); }}
                    onFocus={() => setShowDropdown(true)}
                    autoFocus
                  />
                </div>

                {showDropdown && customerSearch.length > 0 && (
                  <div className="absolute z-20 w-full mt-1 bg-dark-400 border border-dark-50 rounded-xl shadow-xl overflow-hidden">
                    {filteredCustomers.length === 0 ? (
                      <div className="px-4 py-3 text-white/30 text-sm flex items-center gap-2">
                        <User size={14} />
                        No match — will create new customer
                      </div>
                    ) : (
                      filteredCustomers.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => selectCustomer(c)}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left"
                        >
                          <div className="w-7 h-7 rounded-lg bg-dark-200 flex items-center justify-center flex-shrink-0">
                            <span className="text-white/50 text-xs font-bold">{c.name[0].toUpperCase()}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm">{c.name}</p>
                            <p className="text-white/30 text-xs">{c.phone || 'No phone'}</p>
                          </div>
                        </button>
                      ))
                    )}
                    {/* Option to proceed without selecting (new customer) */}
                    {customerSearch.length >= 2 && filteredCustomers.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowDropdown(false);
                          setForm(f => ({ ...f, name: customerSearch }));
                          setDirty(true);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 border-t border-dark-50 hover:bg-white/5 transition-colors text-left"
                      >
                        <div className="w-7 h-7 rounded-lg bg-dark-200 flex items-center justify-center flex-shrink-0">
                          <span className="text-white/30 text-xs">+</span>
                        </div>
                        <p className="text-white/40 text-sm">Add "<span className="text-white">{customerSearch}</span>" as new customer</p>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Name — shown when editing, or when new customer typed (not picked from list) */}
        {(isEdit || (!selectedCustomer && !showDropdown && form.name)) && (
          <div>
            <label className="label">Name *</label>
            <input
              className="input"
              placeholder="e.g. Ramesh Gupta"
              value={form.name}
              onChange={e => set('name', e.target.value)}
            />
          </div>
        )}

        {/* Phone — always shown; editable so staff can add if missing */}
        <div>
          <label className="label">
            Phone
            {selectedCustomer && !selectedCustomer.phone && (
              <span className="ml-2 text-amber-400/70 text-[10px] font-normal">Missing — add it here</span>
            )}
          </label>
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
