import { useEffect, useState } from 'react';
import {
  Package, Plus, Trash2, ChevronDown, ChevronRight,
  X, BarChart2, User, Calendar, RefreshCw,
} from 'lucide-react';
import { stockAPI, staffAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { StockItem, StockHistoryEntry } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const UNITS = ['pc', 'set', 'pair', 'box', 'packet', 'kg', 'meter', 'yard'];

// ── Manual entry modal ────────────────────────────────────────────────────────
function AddEntryModal({
  onClose, onAdded, staffId, staffName,
}: {
  onClose: () => void;
  onAdded: () => void;
  staffId: string;
  staffName: string;
}) {
  const [form, setForm] = useState({ item: '', qty: '', unit: 'pc', customerName: '', note: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.item.trim() || !form.qty) { setError('Item name and quantity are required'); return; }
    const qty = parseInt(form.qty);
    if (isNaN(qty) || qty <= 0) { setError('Quantity must be a positive number'); return; }
    setLoading(true);
    try {
      await stockAPI.addEntry({
        item: form.item.trim(),
        qty,
        unit: form.unit,
        customerName: form.customerName.trim() || undefined,
        note: form.note.trim() || undefined,
        staffId,
      });
      onAdded();
      onClose();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to add entry');
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-dark-300 border border-dark-50 rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-50">
          <h2 className="text-white font-semibold flex items-center gap-2">
            <Plus size={16} className="text-gold" />
            Add Sale Entry
          </h2>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-4 py-2.5 text-sm">{error}</div>
          )}
          <div>
            <label className="label">Item Name *</label>
            <input
              className="input" placeholder="e.g. Bracelet, Saree, Ring"
              value={form.item} onChange={e => setForm(f => ({ ...f, item: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Quantity *</label>
              <input
                type="number" min="1" max="9999" className="input"
                placeholder="6" value={form.qty}
                onChange={e => setForm(f => ({ ...f, qty: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Unit</label>
              <select className="input" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Customer (optional)</label>
            <input
              className="input" placeholder="e.g. Rahul Agra"
              value={form.customerName} onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">Note (optional)</label>
            <input
              className="input" placeholder="e.g. Delivered to showroom"
              value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? 'Saving…' : 'Add Entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── History row ───────────────────────────────────────────────────────────────
function HistoryRow({ entry, onDelete }: { entry: StockHistoryEntry; onDelete: () => void }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-dark-50 last:border-0 group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-white font-medium text-sm">+{entry.qty} {entry.unit}</span>
          {entry.customerName && (
            <span className="flex items-center gap-1 text-[11px] text-white/40">
              <User size={9} /> {entry.customerName}
            </span>
          )}
          {entry.note && (
            <span className="text-[11px] text-white/30 italic">{entry.note}</span>
          )}
        </div>
        <p className="text-white/25 text-[11px] flex items-center gap-1 mt-0.5">
          <Calendar size={9} /> {fmtDate(entry.date)}
        </p>
      </div>
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 p-1 text-white/20 hover:text-red-400 transition-all flex-shrink-0"
        title="Remove entry"
      >
        <X size={12} />
      </button>
    </div>
  );
}

// ── Stock card ────────────────────────────────────────────────────────────────
function StockCard({
  item, onDeleteItem, onDeleteEntry, onAddEntry,
}: {
  item: StockItem;
  onDeleteItem: (id: string) => void;
  onDeleteEntry: (itemId: string, entryId: string) => void;
  onAddEntry: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="card">
      <div className="flex items-center gap-4">
        {/* Left: item icon + info */}
        <div
          className="flex-1 min-w-0 cursor-pointer flex items-center gap-3"
          onClick={() => setExpanded(e => !e)}
        >
          <div className="w-10 h-10 rounded-xl bg-gold/10 border border-gold/20 flex items-center justify-center flex-shrink-0">
            <Package size={18} className="text-gold" />
          </div>
          <div className="min-w-0">
            <p className="text-white font-semibold">{item.itemName}</p>
            <p className="text-white/40 text-sm">
              {item.totalSold} {item.unit} sold · {item.history.length} entr{item.history.length === 1 ? 'y' : 'ies'}
            </p>
          </div>
        </div>

        {/* Right: total pill + actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="px-2.5 py-1 rounded-xl bg-gold/10 text-gold text-sm font-bold border border-gold/20">
            {item.totalSold}
          </span>
          <button
            onClick={onAddEntry}
            className="p-1.5 rounded-lg hover:bg-dark-200 text-white/30 hover:text-gold transition-colors"
            title="Add manual entry"
          >
            <Plus size={14} />
          </button>
          <button
            onClick={() => setExpanded(e => !e)}
            className="p-1.5 rounded-lg hover:bg-dark-200 text-white/30 hover:text-white transition-colors"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <button
            onClick={() => onDeleteItem(item.id)}
            className="p-1.5 rounded-lg hover:bg-red-500/10 text-white/20 hover:text-red-400 transition-colors"
            title="Delete item"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* History */}
      {expanded && item.history.length > 0 && (
        <div className="mt-4 pl-12 space-y-0">
          {[...item.history].reverse().map(h => (
            <HistoryRow
              key={h.id}
              entry={h}
              onDelete={() => onDeleteEntry(item.id, h.id)}
            />
          ))}
        </div>
      )}
      {expanded && item.history.length === 0 && (
        <p className="mt-3 pl-12 text-white/20 text-sm">No history yet</p>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Stock() {
  const { user, isAdmin } = useAuth();
  const [items, setItems]         = useState<StockItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [staffFilter, setStaffFilter] = useState<string>(user?.id || '');
  const [staffList, setStaffList] = useState<{ id: string; name: string }[]>([]);
  const [showAdd, setShowAdd]     = useState(false);
  const [addForStaffId, setAddForStaffId]   = useState(user?.id || '');
  const [addForStaffName, setAddForStaffName] = useState(user?.name || '');
  const [search, setSearch]       = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const params = isAdmin && staffFilter ? { staffId: staffFilter } : undefined;
      const data = await stockAPI.list(isAdmin ? params : undefined);
      setItems(data);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
  }, [staffFilter]);

  useEffect(() => {
    if (isAdmin) {
      staffAPI.list().then((s: { id: string; name: string }[]) => setStaffList(s));
    }
  }, [isAdmin]);

  const handleDeleteItem = async (id: string) => {
    if (!confirm('Delete this stock item and all its history?')) return;
    await stockAPI.deleteItem(id);
    setItems(prev => prev.filter(s => s.id !== id));
  };

  const handleDeleteEntry = async (itemId: string, entryId: string) => {
    const updated = await stockAPI.deleteEntry(itemId, entryId);
    setItems(prev => prev.map(s => s.id === itemId ? updated : s));
  };

  const openAddModal = (sId: string, sName: string) => {
    setAddForStaffId(sId);
    setAddForStaffName(sName);
    setShowAdd(true);
  };

  // ── Filter + group by staff ────────────────────────────────────────────────
  const filtered = items.filter(s =>
    !search || s.itemName.toLowerCase().includes(search.toLowerCase())
  );

  // Group by staffId (admin sees all, staff sees only own)
  const grouped = filtered.reduce<Record<string, { staffName: string; items: StockItem[] }>>((acc, s) => {
    if (!acc[s.staffId]) acc[s.staffId] = { staffName: s.staffName, items: [] };
    acc[s.staffId].items.push(s);
    return acc;
  }, {});

  // Total sold per item across view (for summary)
  const totals = filtered.reduce<Record<string, number>>((acc, s) => {
    acc[s.itemName] = (acc[s.itemName] || 0) + s.totalSold;
    return acc;
  }, {});
  const topItem = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Package size={24} className="text-gold" />
            Stock Tracker
          </h1>
          <p className="text-white/30 text-sm mt-1">
            Individual staff sales — auto-detected from diary entries
          </p>
        </div>
        <button
          onClick={() => openAddModal(user!.id, user!.name)}
          className="btn-primary flex items-center gap-2 flex-shrink-0"
        >
          <Plus size={14} /> Add Entry
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="card py-3 px-4">
          <p className="text-white/30 text-xs mb-1">Total Items Tracked</p>
          <p className="text-white font-bold text-xl">{Object.keys(totals).length}</p>
        </div>
        <div className="card py-3 px-4">
          <p className="text-white/30 text-xs mb-1">Total Units Sold</p>
          <p className="text-white font-bold text-xl">{Object.values(totals).reduce((a, b) => a + b, 0)}</p>
        </div>
        {topItem && (
          <div className="card py-3 px-4">
            <p className="text-white/30 text-xs mb-1">Top Item</p>
            <p className="text-white font-bold text-base truncate">{topItem[0]}</p>
            <p className="text-gold text-xs font-medium">{topItem[1]} sold</p>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input
          className="input flex-1 min-w-[160px] max-w-xs"
          placeholder="Search item…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {isAdmin && (
          <select
            className="input w-48"
            value={staffFilter}
            onChange={e => setStaffFilter(e.target.value)}
          >
            <option value="">All Staff</option>
            {staffList.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
        <button onClick={load} className="btn-ghost flex items-center gap-2">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          {Array(4).fill(0).map((_, i) => <div key={i} className="card h-16 shimmer" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card flex flex-col items-center py-16 text-center">
          <Package size={36} className="text-white/10 mb-4" />
          <p className="text-white/40 font-medium">No stock entries yet</p>
          <p className="text-white/20 text-sm mt-1">
            Entries are auto-detected from diary — e.g. "6 pc bracelet diya"
          </p>
          <button onClick={() => openAddModal(user!.id, user!.name)} className="btn-primary mt-4">
            Add First Entry
          </button>
        </div>
      ) : isAdmin && !staffFilter ? (
        /* Admin grouped view — show per-staff sections */
        <div className="space-y-8">
          {Object.entries(grouped).map(([sId, { staffName, items: sItems }]) => (
            <div key={sId}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-7 h-7 rounded-full bg-gold/15 border border-gold/25 flex items-center justify-center">
                  <span className="text-gold text-[11px] font-bold">{staffName.charAt(0)}</span>
                </div>
                <h2 className="text-white font-semibold">{staffName}</h2>
                <span className="text-white/30 text-xs">
                  {sItems.reduce((s, i) => s + i.totalSold, 0)} total units
                </span>
              </div>
              {/* Per-staff summary bar */}
              <div className="flex gap-2 flex-wrap mb-3">
                {sItems.map(it => (
                  <span key={it.id} className="flex items-center gap-1.5 px-2.5 py-1 bg-dark-300 border border-dark-50 rounded-xl text-[11px]">
                    <BarChart2 size={10} className="text-gold/60" />
                    <span className="text-white/60">{it.itemName}</span>
                    <span className="text-gold font-bold">{it.totalSold}</span>
                  </span>
                ))}
              </div>
              <div className="space-y-3">
                {sItems.map(it => (
                  <StockCard
                    key={it.id}
                    item={it}
                    onDeleteItem={handleDeleteItem}
                    onDeleteEntry={handleDeleteEntry}
                    onAddEntry={() => openAddModal(sId, staffName)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Single-staff view */
        <div className="space-y-3">
          {filtered.map(it => (
            <StockCard
              key={it.id}
              item={it}
              onDeleteItem={handleDeleteItem}
              onDeleteEntry={handleDeleteEntry}
              onAddEntry={() => openAddModal(it.staffId, it.staffName)}
            />
          ))}
        </div>
      )}

      {showAdd && (
        <AddEntryModal
          staffId={addForStaffId}
          staffName={addForStaffName}
          onClose={() => setShowAdd(false)}
          onAdded={load}
        />
      )}
    </div>
  );
}
