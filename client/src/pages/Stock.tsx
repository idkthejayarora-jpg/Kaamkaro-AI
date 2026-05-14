import { useEffect, useState, useCallback } from 'react';
import {
  Package, Plus, Trash2, X, Send, CheckCircle2,
  User, Calendar, ChevronDown, ChevronUp, Edit2,
  IndianRupee, Archive, Clock, Layers, Pencil, Minus,
} from 'lucide-react';
import { holdingStockAPI, customersAPI, shelfInventoryAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { HoldingStock, HoldingItem, Customer, ShelfItem } from '../types';
import type { Staff } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────
const UNITS = ['pc', 'set', 'pair', 'box', 'packet', 'kg', 'meter', 'yard'];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtRupees(n: number) {
  return n > 0 ? `₹${n.toLocaleString('en-IN')}` : '—';
}
function initials(name: string) {
  return name.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// ── Item row inside modal ─────────────────────────────────────────────────────
function ItemRow({
  item, onChange, onRemove, canRemove,
}: {
  item: { itemName: string; qty: string; unit: string; amount: string };
  onChange: (field: string, value: string) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  return (
    <div className="grid grid-cols-[1fr_60px_72px_80px_28px] gap-1.5 items-center">
      <input
        className="input text-sm py-2"
        placeholder="Item name"
        value={item.itemName}
        onChange={e => onChange('itemName', e.target.value)}
      />
      <input
        type="number" min="1" max="9999"
        className="input text-sm py-2 text-center"
        placeholder="Qty"
        value={item.qty}
        onChange={e => onChange('qty', e.target.value)}
      />
      <select
        className="input text-sm py-2"
        value={item.unit}
        onChange={e => onChange('unit', e.target.value)}
      >
        {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
      </select>
      <input
        type="number" min="0"
        className="input text-sm py-2 text-center"
        placeholder="₹ Amt"
        value={item.amount}
        onChange={e => onChange('amount', e.target.value)}
      />
      <button
        type="button" onClick={onRemove} disabled={!canRemove}
        className="text-white/20 hover:text-red-400 transition-colors disabled:opacity-20 flex justify-center"
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ── Add / Edit Modal ──────────────────────────────────────────────────────────
type FormItem = { itemName: string; qty: string; unit: string; amount: string };

function HoldingModal({
  initial, customers, onClose, onSaved,
}: {
  initial?: HoldingStock;
  customers: Customer[];
  onClose: () => void;
  onSaved: (h: HoldingStock) => void;
}) {
  const isEdit = !!initial;

  const [customerName, setCustomerName] = useState(initial?.customerName ?? '');
  const [customerId,   setCustomerId]   = useState(initial?.customerId   ?? '');
  const [note,         setNote]         = useState(initial?.note         ?? '');
  const [formItems, setFormItems] = useState<FormItem[]>(
    initial?.items?.map(i => ({
      itemName: i.itemName,
      qty:      String(i.qty),
      unit:     i.unit,
      amount:   String(i.amount),
    })) ?? [{ itemName: '', qty: '', unit: 'pc', amount: '' }]
  );
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const total = formItems.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);

  const updateItem = (idx: number, field: string, value: string) =>
    setFormItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));

  const addItem    = () => setFormItems(prev => [...prev, { itemName: '', qty: '', unit: 'pc', amount: '' }]);
  const removeItem = (idx: number) => setFormItems(prev => prev.filter((_, i) => i !== idx));

  // When a CRM customer is selected, auto-fill customer name
  const handleCustomerPick = (id: string) => {
    setCustomerId(id);
    if (id) {
      const c = customers.find(c => c.id === id);
      if (c) setCustomerName(c.name);
    }
  };

  const doSubmit = async () => {
    if (!customerName.trim()) { setError('Customer name is required'); return; }
    const validItems = formItems.filter(i => i.itemName.trim() && parseInt(i.qty) > 0);
    if (!validItems.length) { setError('Add at least one item with name and quantity'); return; }

    setLoading(true); setError('');
    try {
      const payload = {
        customerName: customerName.trim(),
        customerId:   customerId || undefined,
        items: validItems.map(i => ({
          itemName: i.itemName.trim(),
          qty:      parseInt(i.qty) || 1,
          unit:     i.unit,
          amount:   parseFloat(i.amount) || 0,
        })),
        note: note.trim() || undefined,
      };
      const result = isEdit
        ? await holdingStockAPI.update(initial!.id, payload)
        : await holdingStockAPI.create(payload);
      onSaved(result);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save');
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-dark-300 border border-dark-50 rounded-2xl w-full max-w-lg shadow-2xl animate-scale-in max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-50 flex-shrink-0">
          <h2 className="text-white font-semibold flex items-center gap-2">
            <Package size={16} className="text-gold" />
            {isEdit ? 'Edit Holding' : 'Set Stock Aside'}
          </h2>
          <button type="button" onClick={onClose} className="text-white/40 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <form
          onSubmit={e => { e.preventDefault(); doSubmit(); }}
          className="overflow-y-auto p-6 space-y-5 flex-1"
        >
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-4 py-3 text-sm">{error}</div>
          )}

          {/* Customer */}
          <div className="space-y-2">
            <label className="label">Customer Name *</label>
            <input
              className="input"
              placeholder="e.g. Rahul Agra"
              value={customerName}
              onChange={e => setCustomerName(e.target.value)}
            />
            {customers.length > 0 && (
              <select
                className="input text-sm"
                value={customerId}
                onChange={e => handleCustomerPick(e.target.value)}
              >
                <option value="">↳ Link to CRM customer (optional)</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>)}
              </select>
            )}
          </div>

          {/* Items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="label mb-0">Items *</label>
              <span className="text-[10px] text-white/20">Name · Qty · Unit · Amount (₹)</span>
            </div>
            <div className="space-y-2">
              {formItems.map((item, idx) => (
                <ItemRow
                  key={idx}
                  item={item}
                  onChange={(field, val) => updateItem(idx, field, val)}
                  onRemove={() => removeItem(idx)}
                  canRemove={formItems.length > 1}
                />
              ))}
            </div>
            <button
              type="button" onClick={addItem}
              className="flex items-center gap-1.5 text-xs text-gold/70 hover:text-gold transition-colors mt-1"
            >
              <Plus size={12} /> Add another item
            </button>
          </div>

          {/* Note */}
          <div>
            <label className="label">Note (optional)</label>
            <input
              className="input" placeholder="e.g. Handle carefully, bridal order"
              value={note} onChange={e => setNote(e.target.value)}
            />
          </div>

          {/* Total */}
          {total > 0 && (
            <div className="flex items-center justify-between px-4 py-3 bg-gold/5 border border-gold/20 rounded-xl">
              <span className="text-white/50 text-sm">Total Amount</span>
              <span className="text-gold font-bold text-lg">₹{total.toLocaleString('en-IN')}</span>
            </div>
          )}

          <button type="submit" className="sr-only" aria-hidden>Submit</button>
        </form>

        {/* Footer */}
        <div className="px-6 pb-6 flex gap-3 flex-shrink-0">
          <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button type="button" onClick={doSubmit} disabled={loading} className="btn-primary flex-1">
            {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Set Aside'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Dispatch confirm ──────────────────────────────────────────────────────────
function DispatchConfirm({
  holding, onClose, onDispatched,
}: {
  holding: HoldingStock;
  onClose: () => void;
  onDispatched: (id: string) => void;
}) {
  const [loading, setLoading] = useState(false);

  const confirm = async () => {
    setLoading(true);
    try {
      await holdingStockAPI.dispatch(holding.id);
      onDispatched(holding.id);
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-dark-300 border border-dark-50 rounded-2xl w-full max-w-sm shadow-2xl animate-scale-in p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center mx-auto">
          <Send size={20} className="text-emerald-400" />
        </div>
        <div className="text-center">
          <p className="text-white font-semibold">Dispatch order for {holding.customerName}?</p>
          <p className="text-white/40 text-sm mt-1">
            {holding.items.length} item{holding.items.length !== 1 ? 's' : ''}
            {holding.totalAmount > 0 ? ` · ₹${holding.totalAmount.toLocaleString('en-IN')}` : ''}
          </p>
          {holding.customerId && (
            <p className="text-emerald-400/70 text-xs mt-2">
              ✓ A dispatch note will be logged in their CRM record
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button
            type="button" onClick={confirm} disabled={loading}
            className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold text-sm transition-colors disabled:opacity-50"
          >
            {loading ? 'Dispatching…' : '🚀 Dispatch'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Holding card ──────────────────────────────────────────────────────────────
function HoldingCard({
  holding, onDispatch, onEdit, onDelete, onQtyChange, isAdmin,
}: {
  holding: HoldingStock;
  onDispatch: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onQtyChange: (itemId: string, delta: number) => void;
  isAdmin: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const isDispatched = holding.status === 'dispatched';
  const canEdit = !isDispatched || isAdmin; // admin can always edit; staff only pending

  return (
    <div className={`card transition-all ${isDispatched ? 'opacity-60' : ''}`}>
      {/* Header row */}
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm
          ${isDispatched ? 'bg-white/5 border border-white/10 text-white/30' : 'bg-gold/15 border border-gold/25 text-gold'}`}>
          {initials(holding.customerName)}
        </div>

        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-white font-semibold">{holding.customerName}</p>
            {isDispatched ? (
              <span className="flex items-center gap-1 text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                <CheckCircle2 size={9} /> Dispatched
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">
                <Clock size={9} /> Pending
              </span>
            )}
            {holding.customerId && (
              <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full">
                CRM linked
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap text-xs text-white/30">
            <span className="flex items-center gap-1">
              <User size={9} /> {holding.staffName}
            </span>
            <span className="flex items-center gap-1">
              <Calendar size={9} />
              {isDispatched && holding.dispatchedAt
                ? `Dispatched ${fmtDate(holding.dispatchedAt)}`
                : `Set aside ${fmtDate(holding.createdAt)}`}
            </span>
          </div>
        </div>

        {/* Total + expand toggle */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {holding.totalAmount > 0 && (
            <div className="flex items-center gap-0.5 px-2.5 py-1 rounded-xl bg-gold/10 border border-gold/20">
              <IndianRupee size={11} className="text-gold" />
              <span className="text-gold font-bold text-sm">{holding.totalAmount.toLocaleString('en-IN')}</span>
            </div>
          )}
          <button
            onClick={() => setExpanded(e => !e)}
            className="p-1.5 rounded-lg hover:bg-dark-200 text-white/30 hover:text-white transition-colors"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Expanded items list */}
      {expanded && (
        <div className="mt-4 space-y-1.5">
          {/* Column headers */}
          <div className={`grid gap-2 px-3 pb-1 border-b border-white/[0.06] ${canEdit ? 'grid-cols-[1fr_100px_60px_80px]' : 'grid-cols-[1fr_60px_60px_80px]'}`}>
            <span className="text-[10px] text-white/20 font-semibold uppercase tracking-wide">Item</span>
            <span className="text-[10px] text-white/20 font-semibold uppercase tracking-wide text-center">Qty</span>
            <span className="text-[10px] text-white/20 font-semibold uppercase tracking-wide text-center">Unit</span>
            <span className="text-[10px] text-white/20 font-semibold uppercase tracking-wide text-right">Amount</span>
          </div>

          {holding.items.map(item => (
            canEdit ? (
              /* Editable row — inline qty +/- */
              <div
                key={item.id}
                className="grid grid-cols-[1fr_100px_60px_80px] gap-2 px-3 py-1.5 rounded-lg hover:bg-white/[0.03] transition-colors items-center"
              >
                <span className="text-white/80 text-sm font-medium truncate">{item.itemName}</span>
                <div className="flex items-center justify-center gap-1">
                  <button
                    type="button"
                    onClick={() => onQtyChange(item.id, -1)}
                    disabled={item.qty <= 1}
                    className="w-6 h-6 rounded-md bg-dark-200 hover:bg-red-500/20 text-white/40 hover:text-red-400 flex items-center justify-center transition-colors disabled:opacity-25 disabled:cursor-not-allowed flex-shrink-0"
                    title="Deduct 1"
                  >
                    <Minus size={10} />
                  </button>
                  <span className="text-white font-semibold text-sm w-8 text-center tabular-nums">{item.qty}</span>
                  <button
                    type="button"
                    onClick={() => onQtyChange(item.id, +1)}
                    className="w-6 h-6 rounded-md bg-dark-200 hover:bg-emerald-500/20 text-white/40 hover:text-emerald-400 flex items-center justify-center transition-colors flex-shrink-0"
                    title="Add 1"
                  >
                    <Plus size={10} />
                  </button>
                </div>
                <span className="text-white/30 text-xs text-center">{item.unit}</span>
                <span className="text-right text-sm font-medium">
                  {item.amount > 0
                    ? <span className="text-gold/80">{fmtRupees(item.amount)}</span>
                    : <span className="text-white/20">—</span>}
                </span>
              </div>
            ) : (
              /* Read-only row (staff viewing dispatched entry) */
              <div
                key={item.id}
                className="grid grid-cols-[1fr_60px_60px_80px] gap-2 px-3 py-1.5 rounded-lg"
              >
                <span className="text-white/80 text-sm font-medium truncate">{item.itemName}</span>
                <span className="text-white/50 text-sm text-center">{item.qty}</span>
                <span className="text-white/30 text-xs text-center self-center">{item.unit}</span>
                <span className="text-right text-sm font-medium">
                  {item.amount > 0
                    ? <span className="text-gold/80">{fmtRupees(item.amount)}</span>
                    : <span className="text-white/20">—</span>}
                </span>
              </div>
            )
          ))}

          {/* Note */}
          {holding.note && (
            <div className="mt-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
              <p className="text-white/40 text-xs italic">"{holding.note}"</p>
            </div>
          )}

          {/* Actions */}
          {!isDispatched && (
            <div className="flex items-center gap-2 pt-3 mt-2 border-t border-white/[0.06]">
              <button
                onClick={onDelete}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-red-500/10 text-white/40 hover:text-red-400 transition-colors text-xs font-medium"
              >
                <Trash2 size={13} /> Delete
              </button>
              <button
                onClick={onEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-dark-200 text-white/40 hover:text-white transition-colors text-xs font-medium"
              >
                <Edit2 size={13} /> Edit Items
              </button>
              <div className="flex-1" />
              <button
                onClick={onDispatch}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 font-semibold text-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <Send size={13} /> Dispatch Order
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Shelf Inventory Modal (add / edit a shelf item) ───────────────────────────
function ShelfItemModal({
  initial, onClose, onSaved,
}: {
  initial?: ShelfItem;
  onClose: () => void;
  onSaved: (item: ShelfItem) => void;
}) {
  const isEdit = !!initial;
  const [itemName, setItemName] = useState(initial?.itemName ?? '');
  const [qty,      setQty]      = useState(initial ? String(initial.qty) : '');
  const [unit,     setUnit]     = useState(initial?.unit ?? 'pc');
  const [note,     setNote]     = useState(initial?.note ?? '');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const doSubmit = async () => {
    if (!itemName.trim()) { setError('Item name is required'); return; }
    if (!qty || parseInt(qty) < 0) { setError('Enter a valid quantity'); return; }
    setLoading(true); setError('');
    try {
      const payload = {
        itemName: itemName.trim(),
        qty: parseInt(qty) || 0,
        unit,
        note: note.trim() || undefined,
      };
      const result = isEdit
        ? await shelfInventoryAPI.update(initial!.id, payload)
        : await shelfInventoryAPI.create(payload);
      onSaved(result);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save');
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-dark-300 border border-dark-50 rounded-2xl w-full max-w-sm shadow-2xl animate-scale-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-50">
          <h2 className="text-white font-semibold flex items-center gap-2">
            <Layers size={15} className="text-gold" />
            {isEdit ? 'Edit Shelf Item' : 'Add to Shelf'}
          </h2>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-4 py-2.5 text-sm">{error}</div>
          )}
          <div>
            <label className="label">Item Name *</label>
            <input
              className="input" placeholder="e.g. Silk Saree, Gold Bangles…"
              value={itemName} onChange={e => setItemName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Quantity *</label>
              <input
                type="number" min="0" className="input text-center"
                placeholder="0"
                value={qty} onChange={e => setQty(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Unit</label>
              <select className="input" value={unit} onChange={e => setUnit(e.target.value)}>
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Note (optional)</label>
            <input
              className="input" placeholder="e.g. Wedding stock, display only…"
              value={note} onChange={e => setNote(e.target.value)}
            />
          </div>
        </div>

        <div className="px-5 pb-5 flex gap-3">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button onClick={doSubmit} disabled={loading} className="btn-primary flex-1">
            {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Add to Shelf'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Shelf Section ─────────────────────────────────────────────────────────────
function ShelfSection({ isAdmin, staffList }: { isAdmin: boolean; staffList: Staff[] }) {
  const [items,       setItems]       = useState<ShelfItem[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [filterStaff, setFilterStaff] = useState('');
  const [showModal,   setShowModal]   = useState(false);
  const [editing,     setEditing]     = useState<ShelfItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = isAdmin && filterStaff ? { staffId: filterStaff } : undefined;
      const data = await shelfInventoryAPI.list(params);
      setItems(data);
    } finally { setLoading(false); }
  }, [isAdmin, filterStaff]);

  useEffect(() => { load(); }, [load]);

  const handleSaved = (item: ShelfItem) => {
    if (editing) {
      setItems(prev => prev.map(x => x.id === item.id ? item : x).sort((a, b) => a.itemName.localeCompare(b.itemName)));
    } else {
      setItems(prev => [...prev, item].sort((a, b) => a.itemName.localeCompare(b.itemName)));
    }
    setShowModal(false);
    setEditing(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this item from your shelf?')) return;
    await shelfInventoryAPI.delete(id);
    setItems(prev => prev.filter(x => x.id !== id));
  };

  // Group by staff when admin is viewing all
  const grouped: Record<string, ShelfItem[]> = {};
  if (isAdmin && !filterStaff) {
    items.forEach(item => {
      if (!grouped[item.staffId]) grouped[item.staffId] = [];
      grouped[item.staffId].push(item);
    });
  }

  const totalQty = items.reduce((s, i) => s + i.qty, 0);

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-blue-500/15 border border-blue-500/25 flex items-center justify-center flex-shrink-0">
            <Layers size={15} className="text-blue-400" />
          </div>
          <div>
            <h2 className="text-white font-bold text-base">Shelf Inventory</h2>
            <p className="text-white/30 text-xs">
              {isAdmin ? "View each staff's on-shelf stock" : 'Your current stock on shelves'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Admin staff filter */}
          {isAdmin && staffList.length > 0 && (
            <select
              value={filterStaff}
              onChange={e => setFilterStaff(e.target.value)}
              className="input text-sm w-auto pr-8"
            >
              <option value="">All Staff</option>
              {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {/* Staff can add; admin can also add (for their own) */}
          <button
            onClick={() => { setEditing(null); setShowModal(true); }}
            className="btn-primary flex items-center gap-2 text-sm py-2"
          >
            <Plus size={13} /> Add Item
          </button>
        </div>
      </div>

      {/* Quick stat strip */}
      {!loading && items.length > 0 && (
        <div className="flex items-center gap-4 px-4 py-2.5 rounded-xl bg-blue-500/5 border border-blue-500/15">
          <div>
            <p className="text-white/30 text-[10px] uppercase tracking-wide">Items</p>
            <p className="text-white font-bold text-lg leading-none">{items.length}</p>
          </div>
          <div className="w-px h-8 bg-white/[0.07]" />
          <div>
            <p className="text-white/30 text-[10px] uppercase tracking-wide">Total Units</p>
            <p className="text-blue-400 font-bold text-lg leading-none">{totalQty}</p>
          </div>
          {isAdmin && !filterStaff && (
            <>
              <div className="w-px h-8 bg-white/[0.07]" />
              <div>
                <p className="text-white/30 text-[10px] uppercase tracking-wide">Staff</p>
                <p className="text-white font-bold text-lg leading-none">{Object.keys(grouped).length}</p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="space-y-2">
          {Array(3).fill(0).map((_, i) => <div key={i} className="h-12 rounded-xl shimmer" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="card flex flex-col items-center py-10 text-center">
          <Layers size={32} className="text-white/10 mb-3" />
          <p className="text-white/35 font-medium text-sm">
            {isAdmin && filterStaff
              ? 'This staff has no shelf items yet'
              : isAdmin
                ? 'No shelf inventory across any staff'
                : 'Your shelf is empty'}
          </p>
          {!isAdmin && (
            <p className="text-white/20 text-xs mt-1">
              Add the items you currently have in stock on your shelves
            </p>
          )}
          {!isAdmin && (
            <button
              onClick={() => { setEditing(null); setShowModal(true); }}
              className="btn-primary mt-4 text-sm"
            >
              Add First Item
            </button>
          )}
        </div>
      ) : isAdmin && !filterStaff ? (
        /* Admin all-staff view — grouped by staff member */
        <div className="space-y-4">
          {Object.entries(grouped).map(([staffId, staffItems]) => {
            const staffName = staffItems[0]?.staffName || staffId;
            return (
              <div key={staffId} className="card space-y-3">
                {/* Staff sub-header */}
                <div className="flex items-center gap-2 pb-2 border-b border-white/[0.06]">
                  <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center text-[10px] font-bold text-blue-400 flex-shrink-0">
                    {initials(staffName)}
                  </div>
                  <p className="text-white/70 text-sm font-semibold">{staffName}</p>
                  <span className="ml-auto text-white/20 text-xs">{staffItems.length} item{staffItems.length !== 1 ? 's' : ''}</span>
                </div>
                {/* Items table */}
                <div className="space-y-1">
                  {staffItems.map(item => (
                    <div key={item.id} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/[0.03] group transition-colors">
                      <span className="text-white/80 text-sm font-medium flex-1 truncate">{item.itemName}</span>
                      <span className="text-blue-400 font-bold text-sm tabular-nums">{item.qty}</span>
                      <span className="text-white/30 text-xs w-8">{item.unit}</span>
                      {item.note && (
                        <span className="text-white/25 text-xs italic truncate max-w-[120px] hidden sm:block">{item.note}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Staff own view (or admin filtered to one staff) */
        <div className="card">
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_56px_48px_80px] gap-2 px-3 pb-2 mb-1 border-b border-white/[0.06]">
            <span className="text-[10px] text-white/20 font-semibold uppercase tracking-wide">Item</span>
            <span className="text-[10px] text-white/20 font-semibold uppercase tracking-wide text-center">Qty</span>
            <span className="text-[10px] text-white/20 font-semibold uppercase tracking-wide">Unit</span>
            <span className="text-[10px] text-white/20 font-semibold uppercase tracking-wide text-right">Actions</span>
          </div>
          <div className="space-y-0.5">
            {items.map(item => (
              <div
                key={item.id}
                className="grid grid-cols-[1fr_56px_48px_80px] gap-2 px-3 py-2.5 rounded-lg hover:bg-white/[0.04] group transition-colors items-center"
              >
                <div className="min-w-0">
                  <p className="text-white/85 text-sm font-medium truncate">{item.itemName}</p>
                  {item.note && (
                    <p className="text-white/25 text-xs truncate mt-0.5">{item.note}</p>
                  )}
                </div>
                <span className="text-blue-400 font-bold text-sm text-center tabular-nums">{item.qty}</span>
                <span className="text-white/35 text-xs">{item.unit}</span>
                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => { setEditing(item); setShowModal(true); }}
                    className="p-1.5 rounded-lg hover:bg-dark-200 text-white/30 hover:text-white transition-colors"
                    title="Edit"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="p-1.5 rounded-lg hover:bg-red-500/10 text-white/20 hover:text-red-400 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <ShelfItemModal
          initial={editing ?? undefined}
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Stock() {
  const { user, isAdmin } = useAuth();
  const [pending,    setPending]    = useState<HoldingStock[]>([]);
  const [dispatched, setDispatched] = useState<HoldingStock[]>([]);
  const [customers,  setCustomers]  = useState<Customer[]>([]);
  const [staffList,  setStaffList]  = useState<Staff[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [tab,        setTab]        = useState<'pending' | 'dispatched'>('pending');
  const [showModal,  setShowModal]  = useState(false);
  const [editing,    setEditing]    = useState<HoldingStock | null>(null);
  const [confirming, setConfirming] = useState<HoldingStock | null>(null);
  const [search,     setSearch]     = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const base = [
        holdingStockAPI.list({ status: 'pending' }),
        holdingStockAPI.list({ status: 'dispatched' }),
        customersAPI.list(),
      ] as const;
      const extras = isAdmin
        ? import('../lib/api').then(m => m.staffAPI.list())
        : Promise.resolve([] as Staff[]);
      const [[p, d, c], s] = await Promise.all([Promise.all(base), extras]);
      setPending(p);
      setDispatched(d);
      setCustomers(c);
      setStaffList(s);
    } finally { setLoading(false); }
  }, [isAdmin]);

  useEffect(() => { load(); }, [load]);

  const handleSaved = (h: HoldingStock) => {
    if (editing) {
      setPending(prev => prev.map(x => x.id === h.id ? h : x));
    } else {
      setPending(prev => [h, ...prev]);
    }
    setShowModal(false);
    setEditing(null);
  };

  const handleDispatched = (id: string) => {
    const item = pending.find(h => h.id === id);
    if (item) {
      const updated = { ...item, status: 'dispatched' as const, dispatchedAt: new Date().toISOString() };
      setPending(prev => prev.filter(h => h.id !== id));
      setDispatched(prev => [updated, ...prev]);
    }
    setConfirming(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this holding entry?')) return;
    await holdingStockAPI.delete(id);
    setPending(prev => prev.filter(h => h.id !== id));
    setDispatched(prev => prev.filter(h => h.id !== id));
  };

  // Inline +/- qty adjustment on a single item within a holding entry
  const handleQtyChange = async (holdingId: string, itemId: string, delta: number) => {
    const holding = pending.find(h => h.id === holdingId);
    if (!holding) return;
    const updatedItems = holding.items.map(i =>
      i.id === itemId ? { ...i, qty: Math.max(1, i.qty + delta) } : i
    );
    // Optimistic update
    const optimistic = { ...holding, items: updatedItems, totalAmount: updatedItems.reduce((s, i) => s + i.amount, 0) };
    setPending(prev => prev.map(h => h.id === holdingId ? optimistic : h));
    try {
      const updated = await holdingStockAPI.update(holdingId, { items: updatedItems });
      setPending(prev => prev.map(h => h.id === holdingId ? updated : h));
    } catch {
      // Revert on failure
      setPending(prev => prev.map(h => h.id === holdingId ? holding : h));
    }
  };

  const shown = (tab === 'pending' ? pending : dispatched).filter(h =>
    !search || h.customerName.toLowerCase().includes(search.toLowerCase()) ||
    h.items.some(i => i.itemName.toLowerCase().includes(search.toLowerCase()))
  );

  // Quick stats
  const pendingTotal = pending.reduce((s, h) => s + h.totalAmount, 0);
  const pendingItems = pending.reduce((s, h) => s + h.items.reduce((si, i) => si + i.qty, 0), 0);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Package size={24} className="text-gold" /> Dispatch Tracker
          </h1>
          <p className="text-white/30 text-sm mt-1">
            Stock set aside for customers — dispatch when order goes out
          </p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowModal(true); }}
          className="btn-primary flex items-center gap-2 flex-shrink-0"
        >
          <Plus size={14} /> Set Aside
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card py-3 px-4">
          <p className="text-white/30 text-xs mb-1">Pending</p>
          <p className="text-white font-bold text-xl">{pending.length}</p>
          <p className="text-white/20 text-xs mt-0.5">{pending.length === 1 ? 'order' : 'orders'}</p>
        </div>
        <div className="card py-3 px-4">
          <p className="text-white/30 text-xs mb-1">Items Held</p>
          <p className="text-white font-bold text-xl">{pendingItems}</p>
          <p className="text-white/20 text-xs mt-0.5">units total</p>
        </div>
        <div className="card py-3 px-4">
          <p className="text-white/30 text-xs mb-1">Value Held</p>
          <p className="text-gold font-bold text-xl truncate">
            {pendingTotal > 0 ? `₹${Math.round(pendingTotal / 1000) > 0 ? (pendingTotal / 1000).toFixed(1) + 'k' : pendingTotal.toLocaleString('en-IN')}` : '—'}
          </p>
          <p className="text-white/20 text-xs mt-0.5">pending dispatch</p>
        </div>
      </div>

      {/* Tabs + search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex rounded-xl overflow-hidden border border-dark-50">
          <button
            onClick={() => setTab('pending')}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-colors ${
              tab === 'pending' ? 'bg-gold text-white' : 'text-white/40 hover:text-white'
            }`}
          >
            <Clock size={12} /> Pending
            {pending.length > 0 && (
              <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                tab === 'pending' ? 'bg-white/20 text-white' : 'bg-white/10 text-white/50'
              }`}>{pending.length}</span>
            )}
          </button>
          <button
            onClick={() => setTab('dispatched')}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-colors ${
              tab === 'dispatched' ? 'bg-gold text-white' : 'text-white/40 hover:text-white'
            }`}
          >
            <Archive size={12} /> Dispatched
            {dispatched.length > 0 && (
              <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                tab === 'dispatched' ? 'bg-white/20 text-white' : 'bg-white/10 text-white/50'
              }`}>{dispatched.length}</span>
            )}
          </button>
        </div>
        <input
          className="input flex-1 min-w-[160px] max-w-xs"
          placeholder="Search customer or item…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          {Array(3).fill(0).map((_, i) => <div key={i} className="card h-28 shimmer" />)}
        </div>
      ) : shown.length === 0 ? (
        <div className="card flex flex-col items-center py-16 text-center">
          {tab === 'pending' ? (
            <>
              <Package size={40} className="text-white/10 mb-4" />
              <p className="text-white/40 font-medium">No orders pending dispatch</p>
              <p className="text-white/20 text-sm mt-1">
                Use "Set Aside" to hold stock for a customer until it's ready to ship
              </p>
              <button
                onClick={() => { setEditing(null); setShowModal(true); }}
                className="btn-primary mt-4"
              >
                Set Stock Aside
              </button>
            </>
          ) : (
            <>
              <CheckCircle2 size={40} className="text-white/10 mb-4" />
              <p className="text-white/40 font-medium">No dispatched orders yet</p>
              <p className="text-white/20 text-sm mt-1">Dispatched orders will appear here</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map(h => (
            <HoldingCard
              key={h.id}
              holding={h}
              onDispatch={() => setConfirming(h)}
              onEdit={() => { setEditing(h); setShowModal(true); }}
              onDelete={() => handleDelete(h.id)}
              onQtyChange={(itemId, delta) => handleQtyChange(h.id, itemId, delta)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {showModal && (
        <HoldingModal
          initial={editing ?? undefined}
          customers={customers}
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSaved={handleSaved}
        />
      )}
      {confirming && (
        <DispatchConfirm
          holding={confirming}
          onClose={() => setConfirming(null)}
          onDispatched={handleDispatched}
        />
      )}

      {/* ── Divider ── */}
      <div className="relative flex items-center gap-4 py-2">
        <div className="flex-1 h-px bg-white/[0.07]" />
        <span className="text-white/15 text-[10px] font-semibold uppercase tracking-widest flex-shrink-0">Shelf Inventory</span>
        <div className="flex-1 h-px bg-white/[0.07]" />
      </div>

      {/* ── Shelf Inventory ── */}
      <ShelfSection isAdmin={isAdmin} staffList={staffList} />
    </div>
  );
}
