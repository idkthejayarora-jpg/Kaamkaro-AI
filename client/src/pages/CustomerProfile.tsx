import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Phone, Mail, Package, MessageSquare, BookOpen,
  Send, Tag, Clock, Calendar, TrendingUp, TrendingDown, Minus,
  CheckCircle2, IndianRupee, User, StickyNote, Loader2,
  ShoppingBag, ChevronRight, Activity,
} from 'lucide-react';
import { customersAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { Customer, Interaction, HoldingStock, Lead, TagDef } from '../types';
import type { PipelineStatus } from '../types';

// ── Types returned by the profile endpoint ────────────────────────────────────
interface StockHistoryGroup {
  itemName: string;
  staffName: string;
  unit: string;
  entries: { id: string; date: string; qty: number; note: string | null }[];
}

interface DiaryMention {
  diaryId: string;
  date: string;
  staffName: string;
  staffId: string;
  note: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  actionItems: string[];
}

interface ProfileData {
  customer: Customer & { healthScore?: number; healthLabel?: string; healthColor?: string };
  interactions: Interaction[];
  holdings: HoldingStock[];
  stockHistory: StockHistoryGroup[];
  leads: Lead[];
  diaryMentions: DiaryMention[];
  tagDefs: TagDef[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}
function initials(name: string) {
  return name.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}
function getAvatarGradient(name: string): [string, string] {
  const palettes: [string, string][] = [
    ['#7c3aed', '#a855f7'], ['#2563eb', '#60a5fa'], ['#059669', '#34d399'],
    ['#d97706', '#fbbf24'], ['#dc2626', '#f87171'], ['#0891b2', '#22d3ee'],
    ['#be185d', '#f472b6'], ['#4338ca', '#818cf8'],
  ];
  const idx = (name.charCodeAt(0) + (name.charCodeAt(1) || 0)) % palettes.length;
  return palettes[idx];
}
function daysSince(iso: string | null) {
  if (!iso) return null;
  return Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
}

const STAGE_CONFIG: Record<PipelineStatus, { label: string; color: string; bg: string }> = {
  lead:        { label: 'Lead',        color: 'text-white/50',   bg: 'bg-white/5' },
  contacted:   { label: 'Contacted',   color: 'text-blue-400',   bg: 'bg-blue-500/10' },
  interested:  { label: 'Interested',  color: 'text-gold',       bg: 'bg-gold/10' },
  negotiating: { label: 'Negotiating', color: 'text-orange-400', bg: 'bg-orange-500/10' },
  closed:      { label: 'Closed',      color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  churned:     { label: 'Churned',     color: 'text-red-400',    bg: 'bg-red-500/10' },
};

const INTERACTION_ICONS: Record<string, string> = {
  call: '📞', message: '💬', meeting: '🤝', email: '📧', diary: '📖', delivery: '📦',
};
const SENTIMENT_CONFIG = {
  positive: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', icon: TrendingUp },
  neutral:  { color: 'text-white/50',    bg: 'bg-white/5',        border: 'border-white/10',        icon: Minus },
  negative: { color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/20',      icon: TrendingDown },
};

const LEAD_STAGE_LABELS: Record<string, string> = {
  new: 'New', contacted: 'Contacted', interested: 'Interested', catalogue_sent: 'Catalogue Sent',
  follow_up: 'Follow Up', visit_scheduled: 'Visit Scheduled', won: 'Won', lost: 'Lost',
};

// ── Analytics Section ─────────────────────────────────────────────────────────
// ── CRM stage config ──────────────────────────────────────────────────────────
const CRM_STAGE: Record<string, { label: string; color: string; bg: string; bar: string }> = {
  new:              { label: 'New',             color: 'text-white/50',    bg: 'bg-white/5',         bar: 'bg-white/20' },
  contacted:        { label: 'Contacted',        color: 'text-blue-400',    bg: 'bg-blue-500/10',     bar: 'bg-blue-400' },
  interested:       { label: 'Interested',       color: 'text-gold',        bg: 'bg-gold/10',         bar: 'bg-gold' },
  catalogue_sent:   { label: 'Catalogue Sent',   color: 'text-violet-400',  bg: 'bg-violet-500/10',   bar: 'bg-violet-400' },
  follow_up:        { label: 'Follow Up',        color: 'text-amber-400',   bg: 'bg-amber-500/10',    bar: 'bg-amber-400' },
  visit_scheduled:  { label: 'Visit Scheduled',  color: 'text-cyan-400',    bg: 'bg-cyan-500/10',     bar: 'bg-cyan-400' },
  won:              { label: 'Won',              color: 'text-emerald-400', bg: 'bg-emerald-500/10',  bar: 'bg-emerald-400' },
  lost:             { label: 'Lost',             color: 'text-red-400',     bg: 'bg-red-500/10',      bar: 'bg-red-400' },
};
const STAGE_ORDER = ['new','contacted','interested','catalogue_sent','follow_up','visit_scheduled','won','lost'];

const SOURCE_LABELS: Record<string, string> = {
  walk_in: '🚶 Walk-in', referral: '🤝 Referral', phone: '📞 Phone',
  instagram: '📸 Instagram', whatsapp: '💬 WhatsApp', other: '🔗 Other',
};

function CrmAnalyticsSection({ leads }: { leads: Lead[] }) {
  if (leads.length === 0) return null;
  const lead = leads[0];
  const cfg  = CRM_STAGE[lead.stage] ?? CRM_STAGE['new'];

  const leadAgeDays   = Math.round((Date.now() - new Date(lead.createdAt).getTime()) / 86400000);
  const updatedDays   = Math.round((Date.now() - new Date(lead.updatedAt).getTime()) / 86400000);
  const stageIdx      = STAGE_ORDER.indexOf(lead.stage);
  const progressPct   = stageIdx < 0 ? 0 : Math.round(((stageIdx + 1) / (STAGE_ORDER.length - 2)) * 100);

  // Follow-up status
  let followUpStatus: { label: string; color: string } | null = null;
  if (lead.nextFollowUp) {
    const diff = Math.round((new Date(lead.nextFollowUp).getTime() - Date.now()) / 86400000);
    if (diff < 0)       followUpStatus = { label: `${Math.abs(diff)}d overdue`, color: 'text-red-400' };
    else if (diff === 0) followUpStatus = { label: 'Due today',                  color: 'text-amber-400' };
    else                 followUpStatus = { label: `In ${diff}d`,                color: 'text-emerald-400' };
  }

  return (
    <div className="card space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-gold" />
          <h3 className="text-white font-semibold text-sm">CRM Overview</h3>
        </div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.color} ${cfg.bg}`}>
          {cfg.label}
        </span>
      </div>

      {/* Pipeline progress bar */}
      {lead.stage !== 'won' && lead.stage !== 'lost' && (
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-white/30 text-[10px]">Pipeline Progress</span>
            <span className="text-white/40 text-[10px] tabular-nums">{Math.min(progressPct, 100)}%</span>
          </div>
          <div className="h-1.5 bg-white/8 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${cfg.bar}`}
              style={{ width: `${Math.min(progressPct, 100)}%` }}
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-white/20 text-[10px]">New</span>
            <span className="text-white/20 text-[10px]">Won</span>
          </div>
        </div>
      )}
      {(lead.stage === 'won' || lead.stage === 'lost') && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${cfg.bg} border border-current/10`}>
          <span className={`text-lg ${lead.stage === 'won' ? '' : ''}`}>{lead.stage === 'won' ? '🏆' : '❌'}</span>
          <span className={`text-sm font-semibold ${cfg.color}`}>
            {lead.stage === 'won' ? 'Deal Closed' : 'Lead Lost'}
          </span>
          <span className="text-white/30 text-xs ml-auto">{updatedDays}d ago</span>
        </div>
      )}

      {/* Stat grid */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-dark-400 rounded-xl p-2.5 text-center">
          <p className="text-white font-bold text-lg leading-none">{leadAgeDays}</p>
          <p className="text-white/30 text-[10px] mt-1">Lead Age</p>
          <p className="text-white/20 text-[10px]">days</p>
        </div>
        <div className="bg-dark-400 rounded-xl p-2.5 text-center">
          <p className={`font-bold text-lg leading-none ${lead.noPickupCount > 2 ? 'text-red-400' : lead.noPickupCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {lead.noPickupCount}
          </p>
          <p className="text-white/30 text-[10px] mt-1">No Pickup</p>
          <p className="text-white/20 text-[10px]">times</p>
        </div>
        <div className="bg-dark-400 rounded-xl p-2.5 text-center">
          <p className="text-white font-bold text-lg leading-none">{lead.notes.length}</p>
          <p className="text-white/30 text-[10px] mt-1">Notes</p>
          <p className="text-white/20 text-[10px]">logged</p>
        </div>
      </div>

      {/* Follow-up + Source row */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-dark-400 rounded-xl px-3 py-2.5">
          <p className="text-white/30 text-[10px] mb-1">Next Follow-up</p>
          {followUpStatus ? (
            <p className={`text-xs font-semibold ${followUpStatus.color}`}>{followUpStatus.label}</p>
          ) : (
            <p className="text-white/20 text-xs">Not set</p>
          )}
          {lead.nextFollowUp && (
            <p className="text-white/25 text-[10px] mt-0.5">{fmtDate(lead.nextFollowUp)}</p>
          )}
        </div>
        <div className="bg-dark-400 rounded-xl px-3 py-2.5">
          <p className="text-white/30 text-[10px] mb-1">Lead Source</p>
          <p className="text-white/70 text-xs font-medium">{SOURCE_LABELS[lead.source] ?? lead.source}</p>
          {lead.visitDate && (
            <p className="text-white/25 text-[10px] mt-0.5">Visit: {fmtDate(lead.visitDate)}</p>
          )}
        </div>
      </div>

      {/* Tags */}
      {lead.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {lead.tags.map(tag => (
            <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-white/8 text-white/50 border border-white/10">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Section tab ───────────────────────────────────────────────────────────────
type Tab = 'purchases' | 'interactions' | 'diary' | 'notes';

// ── Main component ────────────────────────────────────────────────────────────
export default function CustomerProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  const [data,    setData]    = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [tab,     setTab]     = useState<Tab>('purchases');

  useEffect(() => {
    if (!id) return;
    customersAPI.profile(id)
      .then(setData)
      .catch(() => setError('Failed to load customer profile'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div className="flex items-center justify-center py-32">
      <Loader2 size={24} className="text-gold animate-spin" />
    </div>
  );

  if (error || !data) return (
    <div className="card text-center py-16">
      <p className="text-red-400 font-medium">{error || 'Customer not found'}</p>
      <button onClick={() => navigate('/customers')} className="btn-ghost mt-4">
        ← Back to Customers
      </button>
    </div>
  );

  const { customer: c, interactions, holdings, stockHistory, leads, diaryMentions, tagDefs } = data;

  // Derived stats
  const dispatchedHoldings = holdings.filter(h => h.status === 'dispatched');
  const pendingHoldings    = holdings.filter(h => h.status === 'pending');
  const totalSpend         = dispatchedHoldings.reduce((s, h) => s + h.totalAmount, 0);
  const days               = daysSince(c.lastContact);
  const [c1, c2]           = getAvatarGradient(c.name);
  const stageCfg           = STAGE_CONFIG[c.status] || STAGE_CONFIG.lead;

  // All purchases: dispatched holdings + stock history entries, sorted by date
  const purchaseItems: {
    kind: 'dispatch' | 'stock';
    date: string;
    label: string;
    detail: string;
    amount?: number;
    staff: string;
    status?: string;
  }[] = [
    ...dispatchedHoldings.map(h => ({
      kind: 'dispatch' as const,
      date: h.dispatchedAt || h.createdAt,
      label: h.items.map(i => `${i.itemName} ×${i.qty}`).join(', '),
      detail: h.items.map(i => `${i.qty} ${i.unit} ${i.itemName}${i.amount > 0 ? ` (₹${i.amount.toLocaleString('en-IN')})` : ''}`).join(' · '),
      amount: h.totalAmount,
      staff: h.staffName,
      status: 'dispatched',
    })),
    ...stockHistory.flatMap(g =>
      g.entries.map(e => ({
        kind: 'stock' as const,
        date: e.date,
        label: `${g.itemName}`,
        detail: `${e.qty} ${g.unit}${e.note ? ` — ${e.note}` : ''}`,
        staff: g.staffName,
      }))
    ),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Pending holdings shown separately at top of purchases
  const FILTER_TAGS = ['crm-lead', 'bulk-import', 'diary-import'];
  const visibleTags = (c.tags || []).filter(t => !FILTER_TAGS.includes(t));

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'purchases',    label: 'Purchases',    count: purchaseItems.length + pendingHoldings.length },
    { key: 'interactions', label: 'Interactions', count: interactions.length },
    { key: 'diary',        label: 'Diary',        count: diaryMentions.length },
    { key: 'notes',        label: 'Notes',        count: (c.notesList || []).length },
  ];

  return (
    <div className="max-w-2xl mx-auto animate-fade-in space-y-5">

      {/* Back header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/customers')}
          className="p-2 rounded-xl hover:bg-dark-200 text-white/40 hover:text-white transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-white">Customer Profile</h1>
          <p className="text-white/30 text-xs mt-0.5">Full history &amp; purchase record</p>
        </div>
      </div>

      {/* Profile header card */}
      <div className="card space-y-4">
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0 font-bold text-xl text-white shadow-lg"
            style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
          >
            {initials(c.name)}
          </div>

          {/* Name + meta */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-white font-bold text-xl">{c.name}</h2>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium border border-current/20 ${stageCfg.color} ${stageCfg.bg}`}>
                {stageCfg.label}
              </span>
              {leads.length > 0 && (
                <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full">
                  CRM Lead
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {c.phone && (
                <a href={`tel:${c.phone}`} className="flex items-center gap-1 text-white/50 text-sm hover:text-gold transition-colors">
                  <Phone size={12} /> {c.phone}
                </a>
              )}
              {c.email && (
                <span className="flex items-center gap-1 text-white/30 text-xs">
                  <Mail size={11} /> {c.email}
                </span>
              )}
            </div>

            {/* Tags */}
            {visibleTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {visibleTags.map(t => {
                  const def = tagDefs.find(d => d.name === t);
                  return def ? (
                    <span
                      key={t}
                      className="text-[11px] px-2.5 py-0.5 rounded-full border font-medium"
                      style={{ color: def.color, background: `${def.color}18`, borderColor: `${def.color}40` }}
                    >{t}</span>
                  ) : (
                    <span key={t} className="text-[11px] px-2.5 py-0.5 rounded-full bg-white/5 text-white/40 border border-white/10">{t}</span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Health + last contact */}
          <div className="text-right flex-shrink-0">
            {c.healthLabel && (
              <div
                className="text-xs font-bold px-2.5 py-1 rounded-xl mb-1"
                style={{ color: c.healthColor, background: `${c.healthColor}18`, border: `1px solid ${c.healthColor}40` }}
              >
                {c.healthLabel}
              </div>
            )}
            <p className={`text-xs font-semibold ${days === null ? 'text-white/20' : days === 0 ? 'text-emerald-400' : days <= 7 ? 'text-amber-400' : 'text-red-400'}`}>
              {days === null ? 'Never contacted' : days === 0 ? 'Today' : `${days}d ago`}
            </p>
            <p className="text-white/20 text-[10px]">last contact</p>
          </div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-4 gap-2 pt-3 border-t border-white/[0.06]">
          <div className="text-center">
            <p className="text-gold font-bold text-lg">
              {totalSpend > 0 ? `₹${totalSpend >= 1000 ? (totalSpend / 1000).toFixed(1) + 'k' : totalSpend.toLocaleString('en-IN')}` : '—'}
            </p>
            <p className="text-white/25 text-[10px] mt-0.5">Total Spent</p>
          </div>
          <div className="text-center">
            <p className="text-white font-bold text-lg">{dispatchedHoldings.length}</p>
            <p className="text-white/25 text-[10px] mt-0.5">Orders</p>
          </div>
          <div className="text-center">
            <p className="text-white font-bold text-lg">{interactions.length}</p>
            <p className="text-white/25 text-[10px] mt-0.5">Interactions</p>
          </div>
          <div className="text-center">
            <p className="text-white font-bold text-lg">{diaryMentions.length}</p>
            <p className="text-white/25 text-[10px] mt-0.5">Diary Mentions</p>
          </div>
        </div>

        {/* Assigned staff (admin) */}
        {isAdmin && (() => {
          const staffIds = c.assignedStaff?.length ? c.assignedStaff : (c.assignedTo ? [c.assignedTo] : []);
          if (!staffIds.length) return null;
          return (
            <div className="flex items-center gap-2 pt-2 border-t border-white/[0.06]">
              <User size={12} className="text-white/25 flex-shrink-0" />
              <p className="text-white/30 text-xs">Handled by:</p>
              <div className="flex flex-wrap gap-1.5">
                {staffIds.map(sid => (
                  <span key={sid} className="text-xs bg-dark-200 text-white/60 px-2 py-0.5 rounded-full">
                    {sid}
                  </span>
                ))}
              </div>
            </div>
          );
        })()}
      </div>

      {/* CRM Lead banner (if linked) */}
      {leads.length > 0 && (
        <div className="card py-3 px-4 border-l-4 border-l-blue-500/50">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-white/50 text-[10px] uppercase tracking-wide font-semibold mb-0.5">CRM Lead</p>
              <p className="text-white text-sm font-medium">{LEAD_STAGE_LABELS[leads[0].stage] || leads[0].stage}</p>
              {leads[0].nextFollowUp && (
                <p className="text-amber-400/70 text-xs mt-0.5 flex items-center gap-1">
                  <Calendar size={10} /> Follow-up: {fmtDate(leads[0].nextFollowUp)}
                </p>
              )}
            </div>
            <button
              onClick={() => navigate(`/crm/${leads[0].id}`)}
              className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors flex-shrink-0"
            >
              View Lead <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}

      {/* CRM Analytics */}
      <CrmAnalyticsSection leads={leads} />

      {/* Tabs */}
      <div className="flex gap-1 bg-dark-300 p-1 rounded-xl border border-dark-50">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
              tab === t.key
                ? 'bg-gold/15 text-gold'
                : 'text-white/30 hover:text-white'
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className={`text-[10px] px-1.5 rounded-full font-bold ${tab === t.key ? 'bg-gold/20 text-gold' : 'bg-white/10 text-white/30'}`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Purchases tab ─────────────────────────────────────────────────── */}
      {tab === 'purchases' && (
        <div className="space-y-3">
          {/* Pending orders */}
          {pendingHoldings.length > 0 && (
            <div>
              <p className="text-white/30 text-[10px] uppercase tracking-widest font-semibold mb-2 px-1">
                Pending Orders ({pendingHoldings.length})
              </p>
              {pendingHoldings.map(h => (
                <div key={h.id} className="card border-l-4 border-l-amber-500/50 mb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <Package size={13} className="text-amber-400 flex-shrink-0" />
                        <span className="text-amber-400 text-xs font-semibold">Pending Dispatch</span>
                        <span className="text-white/20 text-xs">{fmtDate(h.createdAt)}</span>
                      </div>
                      <div className="space-y-1">
                        {h.items.map(i => (
                          <div key={i.id} className="flex items-center justify-between text-sm">
                            <span className="text-white/80 font-medium">{i.itemName}</span>
                            <span className="text-white/40 text-xs">
                              {i.qty} {i.unit}
                              {i.amount > 0 && <span className="text-gold/70 ml-2">₹{i.amount.toLocaleString('en-IN')}</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                      {h.note && <p className="text-white/30 text-xs italic mt-2">"{h.note}"</p>}
                    </div>
                    {h.totalAmount > 0 && (
                      <div className="flex items-center gap-0.5 px-2.5 py-1.5 rounded-xl bg-gold/10 border border-gold/20 flex-shrink-0">
                        <IndianRupee size={11} className="text-gold" />
                        <span className="text-gold font-bold text-sm">{h.totalAmount.toLocaleString('en-IN')}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-2 pt-2 border-t border-white/[0.06]">
                    <User size={9} className="text-white/20" />
                    <span className="text-white/25 text-[10px]">{h.staffName}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Past purchases timeline */}
          {purchaseItems.length === 0 && pendingHoldings.length === 0 ? (
            <div className="card flex flex-col items-center py-12 text-center">
              <ShoppingBag size={36} className="text-white/10 mb-3" />
              <p className="text-white/40 font-medium">No purchases yet</p>
              <p className="text-white/20 text-sm mt-1">Dispatch entries and diary-recorded sales will appear here</p>
            </div>
          ) : purchaseItems.length > 0 && (
            <div>
              <p className="text-white/30 text-[10px] uppercase tracking-widest font-semibold mb-2 px-1">
                Purchase History ({purchaseItems.length})
              </p>
              <div className="space-y-2">
                {purchaseItems.map((p, idx) => (
                  <div
                    key={idx}
                    className={`card py-3 px-4 border-l-4 ${
                      p.kind === 'dispatch' ? 'border-l-emerald-500/50' : 'border-l-blue-500/30'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {p.kind === 'dispatch'
                            ? <CheckCircle2 size={11} className="text-emerald-400 flex-shrink-0" />
                            : <Activity size={11} className="text-blue-400/70 flex-shrink-0" />
                          }
                          <span className="text-white font-semibold text-sm truncate">{p.label}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                            p.kind === 'dispatch'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-blue-500/10 text-blue-400/70 border border-blue-500/20'
                          }`}>
                            {p.kind === 'dispatch' ? 'Dispatched' : 'Recorded sale'}
                          </span>
                        </div>
                        <p className="text-white/40 text-xs">{p.detail}</p>
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="text-white/20 text-[10px] flex items-center gap-1">
                            <Calendar size={9} />{fmtDate(p.date)}
                          </span>
                          <span className="text-white/20 text-[10px] flex items-center gap-1">
                            <User size={9} />{p.staff}
                          </span>
                        </div>
                      </div>
                      {p.amount && p.amount > 0 ? (
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          <IndianRupee size={10} className="text-gold/70" />
                          <span className="text-gold font-bold text-sm">{p.amount.toLocaleString('en-IN')}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Interactions tab ──────────────────────────────────────────────── */}
      {tab === 'interactions' && (
        <div className="space-y-2">
          {interactions.length === 0 ? (
            <div className="card flex flex-col items-center py-12 text-center">
              <MessageSquare size={36} className="text-white/10 mb-3" />
              <p className="text-white/40 font-medium">No interactions logged yet</p>
              <p className="text-white/20 text-sm mt-1">Log a call, message, or meeting from the Customers page</p>
            </div>
          ) : interactions.map(i => (
            <div key={i.id} className="card py-3 px-4">
              <div className="flex items-start gap-3">
                <span className="text-lg flex-shrink-0 mt-0.5">
                  {INTERACTION_ICONS[i.type] || '💬'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-medium text-sm capitalize">{i.type}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                      i.responded
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : 'bg-red-500/10 text-red-400 border-red-500/20'
                    }`}>
                      {i.responded ? 'Responded' : 'No response'}
                    </span>
                  </div>
                  {i.notes && <p className="text-white/60 text-sm mt-1">{i.notes}</p>}
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-white/25 text-[10px] flex items-center gap-1">
                      <Clock size={9} />{fmtDateTime(i.createdAt)}
                    </span>
                    <span className="text-white/25 text-[10px] flex items-center gap-1">
                      <User size={9} />{i.staffName}
                    </span>
                  </div>
                  {i.followUpDate && (
                    <p className="text-amber-400/70 text-xs mt-1 flex items-center gap-1">
                      <Calendar size={9} /> Follow-up: {fmtDate(i.followUpDate)}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Diary tab ─────────────────────────────────────────────────────── */}
      {tab === 'diary' && (
        <div className="space-y-2">
          {diaryMentions.length === 0 ? (
            <div className="card flex flex-col items-center py-12 text-center">
              <BookOpen size={36} className="text-white/10 mb-3" />
              <p className="text-white/40 font-medium">Not mentioned in any diary</p>
              <p className="text-white/20 text-sm mt-1">Diary entries that mention this customer will appear here</p>
            </div>
          ) : diaryMentions.map((m, idx) => {
            const sentCfg = SENTIMENT_CONFIG[m.sentiment] || SENTIMENT_CONFIG.neutral;
            const SentIcon = sentCfg.icon;
            return (
              <div key={idx} className={`card py-3 px-4 border-l-4 ${
                m.sentiment === 'positive' ? 'border-l-emerald-500/40' :
                m.sentiment === 'negative' ? 'border-l-red-500/40' : 'border-l-white/10'
              }`}>
                <div className="flex items-start gap-3">
                  <div className={`flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0 ${sentCfg.bg} border ${sentCfg.border}`}>
                    <SentIcon size={12} className={sentCfg.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white/80 text-sm">{m.note}</p>
                    {m.actionItems.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {m.actionItems.map((a, ai) => (
                          <li key={ai} className="text-xs text-gold/60 flex items-center gap-1.5">
                            <span className="w-1 h-1 rounded-full bg-gold/40 flex-shrink-0" /> {a}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-white/25 text-[10px] flex items-center gap-1">
                        <Calendar size={9} />{fmtDate(m.date)}
                      </span>
                      <span className="text-white/25 text-[10px] flex items-center gap-1">
                        <User size={9} />{m.staffName}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Notes tab ─────────────────────────────────────────────────────── */}
      {tab === 'notes' && (
        <div className="space-y-2">
          {/* Legacy notes field */}
          {c.notes && (
            <div className="card py-3 px-4 border-l-4 border-l-gold/30">
              <p className="text-white/50 text-[10px] uppercase tracking-wide font-semibold mb-1">General Note</p>
              <p className="text-white/70 text-sm">{c.notes}</p>
            </div>
          )}
          {/* Timestamped notes */}
          {(c.notesList || []).length === 0 && !c.notes ? (
            <div className="card flex flex-col items-center py-12 text-center">
              <StickyNote size={36} className="text-white/10 mb-3" />
              <p className="text-white/40 font-medium">No notes yet</p>
              <p className="text-white/20 text-sm mt-1">Add notes from the Customers list view</p>
            </div>
          ) : (c.notesList || []).map(n => (
            <div key={n.id} className="card py-3 px-4">
              <p className="text-white/80 text-sm">{n.text}</p>
              <div className="flex items-center gap-3 mt-1.5">
                <span className="text-white/25 text-[10px] flex items-center gap-1">
                  <Clock size={9} />{fmtDateTime(n.createdAt)}
                </span>
                <span className="text-white/25 text-[10px] flex items-center gap-1">
                  <User size={9} />{n.createdBy}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
