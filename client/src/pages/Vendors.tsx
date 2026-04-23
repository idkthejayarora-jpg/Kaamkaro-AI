import { useEffect, useState } from 'react';
import { Plus, Search, Building2, Phone, Mail, X, Trash2, BookOpen, ChevronDown, ChevronUp } from 'lucide-react';
import { vendorsAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { Vendor, VendorInteraction } from '../types';

const CATEGORIES = ['General', 'Raw Materials', 'Logistics', 'Technology', 'Marketing', 'Finance', 'Operations', 'Other'];

function AddVendorModal({ onClose, onCreated }: { onClose: () => void; onCreated: (v: Vendor) => void }) {
  const [form, setForm] = useState({ name: '', company: '', phone: '', email: '', category: 'General', notes: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name) { setError('Name is required'); return; }
    setLoading(true);
    try {
      const v = await vendorsAPI.create(form);
      onCreated(v);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed');
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-dark-300 border border-dark-50 rounded-2xl w-full max-w-md shadow-2xl animate-slide-up max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-50 flex-shrink-0">
          <h2 className="text-white font-semibold">Add Vendor</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          {error && <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-4 py-3 text-sm">{error}</div>}
          <div><label className="label">Contact Name *</label><input className="input" placeholder="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div><label className="label">Company</label><input className="input" placeholder="Company name" value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Phone</label><input className="input" type="tel" placeholder="Phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
            <div><label className="label">Email</label><input className="input" type="email" placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
          </div>
          <div>
            <label className="label">Category</label>
            <select className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div><label className="label">Notes</label><textarea className="input resize-none" rows={2} placeholder="Notes..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
        </form>
        <div className="px-6 pb-6 flex gap-3 flex-shrink-0">
          <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button onClick={handleSubmit} disabled={loading} className="btn-primary flex-1">{loading ? 'Adding...' : 'Add Vendor'}</button>
        </div>
      </div>
    </div>
  );
}

const SENTIMENT_COLOR: Record<string, string> = {
  positive: 'text-green-400',
  negative: 'text-red-400',
  neutral:  'text-white/30',
};

function VendorLog({ vendorId }: { vendorId: string }) {
  const [logs,     setLogs]     = useState<VendorInteraction[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    vendorsAPI.interactions(vendorId)
      .then(setLogs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [vendorId]);

  if (loading) return <div className="h-4 shimmer rounded mt-2" />;
  if (logs.length === 0) return null;

  const preview = logs[0];

  return (
    <div className="mt-3 pt-3 border-t border-dark-50/50">
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center justify-between w-full text-left group"
      >
        <span className="flex items-center gap-1.5 text-white/30 text-xs group-hover:text-white/50 transition-colors">
          <BookOpen size={11} />
          {logs.length} diary {logs.length === 1 ? 'entry' : 'entries'}
        </span>
        {expanded ? <ChevronUp size={12} className="text-white/20" /> : <ChevronDown size={12} className="text-white/20" />}
      </button>

      {!expanded && (
        <p className="text-white/25 text-xs mt-1.5 line-clamp-2 italic">
          "{preview.notes.slice(0, 120)}{preview.notes.length > 120 ? '…' : ''}"
        </p>
      )}

      {expanded && (
        <div className="mt-2 space-y-2">
          {logs.map(log => (
            <div key={log.id} className="bg-dark-200 rounded-xl px-3 py-2 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-white/25 text-[10px]">
                  {new Date(log.createdAt).toLocaleDateString('en-IN', {
                    day: 'numeric', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </span>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-medium ${SENTIMENT_COLOR[log.sentiment] ?? 'text-white/30'}`}>
                    {log.sentiment}
                  </span>
                  <span className="text-white/20 text-[10px]">by {log.staffName}</span>
                </div>
              </div>
              <p className="text-white/50 text-xs leading-relaxed">{log.notes}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Vendors() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [search, setSearch]   = useState('');
  const [category, setCategory] = useState('all');
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(true);
  const { isAdmin } = useAuth();

  useEffect(() => {
    vendorsAPI.list().then(setVendors).finally(() => setLoading(false));
  }, []);

  const categories = ['all', ...Array.from(new Set(vendors.map(v => v.category)))];

  const filtered = vendors.filter(v => {
    const matchSearch = v.name.toLowerCase().includes(search.toLowerCase())
      || v.company.toLowerCase().includes(search.toLowerCase())
      || v.phone.includes(search);
    const matchCat = category === 'all' || v.category === category;
    return matchSearch && matchCat;
  });

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this vendor?')) return;
    await vendorsAPI.delete(id);
    setVendors(v => v.filter(x => x.id !== id));
  };

  const toggleStatus = async (v: Vendor) => {
    const updated = await vendorsAPI.update(v.id, { status: v.status === 'active' ? 'inactive' : 'active' });
    setVendors(prev => prev.map(x => x.id === updated.id ? updated : x));
  };

  if (loading) return <div className="space-y-3">{Array(4).fill(0).map((_, i) => <div key={i} className="card h-20 shimmer" />)}</div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Vendors</h1>
          <p className="text-white/40 text-sm mt-1">{vendors.length} vendors · {vendors.filter(v => v.status === 'active').length} active</p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2 flex-shrink-0">
            <Plus size={16} /><span className="hidden sm:inline">Add Vendor</span>
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
          <input type="text" placeholder="Search vendors..." value={search} onChange={e => setSearch(e.target.value)} className="input pl-10" />
        </div>
        <div className="flex gap-1 flex-wrap">
          {categories.map(c => (
            <button key={c} onClick={() => setCategory(c)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors ${category === c ? 'bg-gold text-dark-500' : 'border border-dark-50 text-white/40 hover:text-white'}`}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card flex flex-col items-center py-16 text-center">
          <Building2 size={40} className="text-white/10 mb-4" />
          <p className="text-white/40 font-medium">No vendors found</p>
          {isAdmin && <button onClick={() => setShowAdd(true)} className="btn-primary mt-4">Add Vendor</button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map(v => (
            <div key={v.id} className="card group">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-dark-200 border border-dark-50 flex items-center justify-center flex-shrink-0">
                    <Building2 size={16} className="text-white/40" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-white font-semibold truncate">{v.name}</p>
                    <p className="text-white/40 text-xs truncate">{v.company}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className={`badge ${v.status === 'active' ? 'badge-green' : 'badge-gray'}`}>{v.status}</span>
                  {isAdmin && (
                    <button onClick={() => handleDelete(v.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-white/20 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-3 space-y-1">
                {v.phone && <p className="text-white/40 text-xs flex items-center gap-1.5"><Phone size={10} />{v.phone}</p>}
                {v.email && <p className="text-white/40 text-xs flex items-center gap-1.5"><Mail size={10} />{v.email}</p>}
              </div>

              <div className="flex items-center justify-between mt-3 pt-3 border-t border-dark-50/50">
                <span className="badge badge-gold">{v.category}</span>
                {isAdmin && (
                  <button onClick={() => toggleStatus(v)} className="text-xs text-white/30 hover:text-white transition-colors">
                    {v.status === 'active' ? 'Deactivate' : 'Activate'}
                  </button>
                )}
              </div>

              {v.notes && <p className="text-white/25 text-xs mt-2 line-clamp-2">{v.notes}</p>}
              <VendorLog vendorId={v.id} />
            </div>
          ))}
        </div>
      )}

      {showAdd && <AddVendorModal onClose={() => setShowAdd(false)} onCreated={v => { setVendors(p => [...p, v]); setShowAdd(false); }} />}
    </div>
  );
}
