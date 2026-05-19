import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { TabBar, AnimatedTabPanel } from '../components/TabBar';
import {
  BarChart, Bar, AreaChart, Area, ComposedChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
  PieChart, Pie, Legend,
} from 'recharts';
import {
  Clock, AlertTriangle, Phone, ChevronRight, Sparkles,
  Users, TrendingUp, TrendingDown, Ghost, ShoppingBag,
  CreditCard, Flame, CheckCircle, X, Brain, Activity,
  AlertCircle, Shield, BarChart2, MessageSquare, BookOpen,
  ExternalLink, CheckCircle2, Calendar,
} from 'lucide-react';
import { insightsAPI, interactionsAPI, diaryAPI } from '../lib/api';
import Portal from '../components/Portal';
import { useAuth } from '../contexts/AuthContext';
import type { Interaction, CustomerInsight, StaffBehavior, InsightsTrends, DiaryEntry } from '../types';

const GOLD = '#D4AF37';
const DIM  = '#1e1e1e';

// ── Priority configs ──────────────────────────────────────────────────────────

const PRIORITY_CFG = {
  urgent: { label: 'Urgent',  color: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/25',    dot: 'bg-red-500 animate-pulse' },
  high:   { label: 'High',    color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/25', dot: 'bg-orange-400' },
  medium: { label: 'Medium',  color: 'text-gold',       bg: 'bg-gold/10',       border: 'border-gold/25',       dot: 'bg-gold' },
  low:    { label: 'Low',     color: 'text-white/35',   bg: 'bg-white/5',       border: 'border-dark-50',       dot: 'bg-white/20' },
} as const;

const PIPELINE_COLORS: Record<string, string> = {
  lead: '#666', contacted: '#60a5fa', interested: GOLD,
  negotiating: '#f97316', closed: '#4ade80', churned: '#f87171',
};

// ── Pattern signal chips ──────────────────────────────────────────────────────

function PatternChips({ patterns, metrics }: { patterns: CustomerInsight['patterns']; metrics: CustomerInsight['metrics'] }) {
  const chips: { icon: React.ElementType; label: string; color: string }[] = [];

  if (patterns.responsiveness === 'ghosting')
    chips.push({ icon: Ghost,        label: 'Ghosting',       color: 'text-red-400' });
  else if (patterns.responsiveness === 'ignoring')
    chips.push({ icon: AlertCircle,  label: 'Ignoring',       color: 'text-orange-400' });
  else if (patterns.responsiveness === 'slow')
    chips.push({ icon: Clock,        label: 'Slow respond',   color: 'text-yellow-400' });
  else
    chips.push({ icon: CheckCircle,  label: 'Responsive',     color: 'text-green-400' });

  if (patterns.orderFrequency === 'frequent')
    chips.push({ icon: ShoppingBag,  label: 'Frequent orders', color: 'text-gold' });
  else if (patterns.orderFrequency === 'occasional')
    chips.push({ icon: ShoppingBag,  label: 'Occasional orders', color: 'text-white/40' });

  if (patterns.hasPaymentDelay)
    chips.push({ icon: CreditCard,   label: 'Payment delay',  color: 'text-orange-400' });

  if (patterns.sentimentTrend === 'improving')
    chips.push({ icon: TrendingUp,   label: 'Improving',      color: 'text-green-400' });
  else if (patterns.sentimentTrend === 'declining')
    chips.push({ icon: TrendingDown, label: 'Declining',      color: 'text-red-400' });

  if (patterns.staffConcern)
    chips.push({ icon: AlertTriangle, label: 'Staff concern', color: 'text-red-400' });

  if (patterns.avgOrderCycleDays)
    chips.push({ icon: Activity,     label: `~${patterns.avgOrderCycleDays}d cycle`, color: 'text-white/40' });

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {chips.map(({ icon: Icon, label, color }, i) => (
        <span key={i} className={`inline-flex items-center gap-1 text-[10px] ${color} bg-white/5 border border-white/8 rounded-full px-2 py-0.5`}>
          <Icon size={9} /> {label}
        </span>
      ))}
      {metrics.totalInteractions > 0 && (
        <span className="inline-flex items-center gap-1 text-[10px] text-white/25 bg-white/5 border border-white/8 rounded-full px-2 py-0.5">
          <MessageSquare size={9} /> {metrics.totalInteractions} interactions
        </span>
      )}
    </div>
  );
}

// ── Customer detail panel (slide-in from right) ───────────────────────────────

const INTERACTION_TYPE_COLORS: Record<string, string> = {
  call: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  message: 'text-green-400 bg-green-500/10 border-green-500/20',
  email: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  meeting: 'text-gold bg-gold/10 border-gold/20',
  diary: 'text-white/50 bg-white/5 border-white/10',
};

function CustomerDetailPanel({ item, onClose, onLog, onNavigate }: {
  item: CustomerInsight;
  onClose: () => void;
  onLog: (item: CustomerInsight) => void;
  onNavigate: (id: string) => void;
}) {
  const [interactions,  setInteractions]  = useState<Interaction[]>([]);
  const [diaryEntries,  setDiaryEntries]  = useState<DiaryEntry[]>([]);
  const [loadingLogs,   setLoadingLogs]   = useState(true);
  const cfg = PRIORITY_CFG[item.priority];

  useEffect(() => {
    setLoadingLogs(true);
    Promise.all([
      interactionsAPI.list({ customerId: item.customerId })
        .then((d: Interaction[]) => setInteractions(d))
        .catch(() => {}),
      diaryAPI.list()
        .then((entries: DiaryEntry[]) => {
          // Keep only diary entries that mention this customer
          const relevant = entries.filter(e =>
            Array.isArray(e.aiEntries) &&
            e.aiEntries.some(ae => ae.customerId === item.customerId || ae.matchedCustomerName === item.customerName)
          );
          setDiaryEntries(relevant);
        })
        .catch(() => {}),
    ]).finally(() => setLoadingLogs(false));
  }, [item.customerId, item.customerName]);

  return (
    <Portal>
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 animate-fade-in"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-dark-300 border-l border-dark-50 z-50 flex flex-col shadow-2xl animate-slide-in-right overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-dark-50 flex-shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-white font-bold text-base truncate">{item.customerName}</span>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color} border-current/20`}>
                {cfg.label}
              </span>
              <span className="text-[10px] capitalize text-white/30 bg-white/5 border border-white/8 rounded-full px-2 py-0.5">
                {item.status}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {item.phone && <span className="text-white/30 text-xs">{item.phone}</span>}
              <span className={`text-[11px] font-medium ${
                item.lastContactDays === null ? 'text-red-400' :
                item.lastContactDays > 14    ? 'text-red-400' :
                item.lastContactDays > 7     ? 'text-orange-400' : 'text-white/40'
              }`}>
                {item.lastContactDays === null ? '⚠ Never contacted' :
                 item.lastContactDays === 0   ? '✓ Today' :
                 `${item.lastContactDays}d ago`}
              </span>
            </div>
            {/* Pattern chips */}
            <PatternChips patterns={item.patterns} metrics={item.metrics} />
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white transition-colors flex-shrink-0 p-1">
            <X size={18} />
          </button>
        </div>

        {/* AI insight strip */}
        {(item.insight || item.nextAction) && (
          <div className="px-5 py-3 bg-gold/4 border-b border-gold/10 flex-shrink-0 space-y-1">
            {item.insight && (
              <div className="flex items-start gap-2 text-[11px] text-white/55 leading-relaxed">
                <Brain size={11} className="text-gold/60 flex-shrink-0 mt-0.5" />
                <span>{item.insight}</span>
              </div>
            )}
            {item.nextAction && (
              <div className="flex items-start gap-2 text-[11px]">
                <Sparkles size={11} className="text-gold flex-shrink-0 mt-0.5" />
                <span className="text-gold/80 font-medium">{item.nextAction}</span>
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 px-5 py-3 border-b border-dark-50 flex-shrink-0">
          <button
            onClick={() => onLog(item)}
            className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm"
          >
            <Phone size={13} /> Log Interaction
          </button>
          <button
            onClick={() => { onNavigate(item.customerId); onClose(); }}
            className="btn-ghost flex items-center gap-1.5 px-4 text-sm"
          >
            <ExternalLink size={13} /> Full CRM
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {loadingLogs ? (
            <div className="space-y-3">
              {Array(4).fill(0).map((_, i) => (
                <div key={i} className="h-16 bg-dark-200 rounded-xl shimmer" />
              ))}
            </div>
          ) : (
            <>
              {/* Interaction logs */}
              <div>
                <h3 className="text-white/50 text-xs font-semibold uppercase tracking-widest mb-3 flex items-center gap-2">
                  <MessageSquare size={11} className="text-gold/60" />
                  Interaction History
                  <span className="text-white/20 normal-case tracking-normal font-normal">
                    ({interactions.length})
                  </span>
                </h3>

                {interactions.length === 0 ? (
                  <p className="text-white/20 text-sm text-center py-6">No interactions logged yet.</p>
                ) : (
                  <div className="space-y-2">
                    {interactions.map(int => (
                      <div key={int.id} className="bg-dark-200 rounded-xl p-3 space-y-1.5">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border capitalize ${
                              INTERACTION_TYPE_COLORS[int.type] ?? INTERACTION_TYPE_COLORS.diary
                            }`}>
                              {int.type}
                            </span>
                            <span className={`text-[10px] font-medium ${int.responded ? 'text-green-400' : 'text-red-400/70'}`}>
                              {int.responded ? '✓ Responded' : '✗ No response'}
                            </span>
                          </div>
                          <span className="text-white/20 text-[10px]">
                            {new Date(int.createdAt).toLocaleDateString('en-IN', {
                              day: 'numeric', month: 'short',
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                        </div>
                        {int.notes && (
                          <p className="text-white/50 text-xs leading-relaxed">{int.notes}</p>
                        )}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-white/20 text-[10px]">by {int.staffName}</span>
                          {int.followUpDate && (
                            <span className="text-[10px] text-gold/60 flex items-center gap-1">
                              <Calendar size={9} /> Follow-up: {new Date(int.followUpDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Diary entries mentioning this customer */}
              <div>
                <h3 className="text-white/50 text-xs font-semibold uppercase tracking-widest mb-3 flex items-center gap-2">
                  <BookOpen size={11} className="text-gold/60" />
                  Diary Mentions
                  <span className="text-white/20 normal-case tracking-normal font-normal">
                    ({diaryEntries.length})
                  </span>
                </h3>

                {diaryEntries.length === 0 ? (
                  <p className="text-white/20 text-sm text-center py-6">No diary entries mention this customer.</p>
                ) : (
                  <div className="space-y-2">
                    {diaryEntries.map(entry => {
                      // Find the specific AI entry for this customer
                      const mention = entry.aiEntries.find(ae =>
                        ae.customerId === item.customerId ||
                        ae.matchedCustomerName === item.customerName
                      );
                      return (
                        <div key={entry.id} className="bg-dark-200 rounded-xl p-3 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-white/25 text-[10px]">
                              {new Date(entry.createdAt).toLocaleDateString('en-IN', {
                                day: 'numeric', month: 'short', year: 'numeric',
                              })}
                            </span>
                            {mention?.sentiment && (
                              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                                mention.sentiment === 'positive' ? 'text-green-400 bg-green-500/10 border-green-500/20' :
                                mention.sentiment === 'negative' ? 'text-red-400 bg-red-500/10 border-red-500/20' :
                                'text-white/30 bg-white/5 border-white/10'
                              }`}>
                                {mention.sentiment}
                              </span>
                            )}
                          </div>
                          {mention?.notes && (
                            <p className="text-white/55 text-xs leading-relaxed">{mention.notes}</p>
                          )}
                          {mention?.actionItems && mention.actionItems.length > 0 && (
                            <div className="flex gap-1 flex-wrap pt-0.5">
                              {mention.actionItems.map((a, i) => (
                                <span key={i} className="text-[10px] text-gold/60 bg-gold/8 border border-gold/15 rounded-full px-2 py-0.5">
                                  → {a}
                                </span>
                              ))}
                            </div>
                          )}
                          {entry.staffName && (
                            <span className="text-white/20 text-[10px]">by {entry.staffName}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
    </Portal>
  );
}

// ── Customer queue card ───────────────────────────────────────────────────────

function QueueCard({
  item, isAdmin, onLog, onNavigate, onDetail,
}: {
  item: CustomerInsight;
  isAdmin: boolean;
  onLog: (item: CustomerInsight) => void;
  onNavigate: (id: string) => void;
  onDetail: (item: CustomerInsight) => void;
}) {
  const cfg = PRIORITY_CFG[item.priority];

  return (
    <div className={`card border ${cfg.border} transition-all hover:border-opacity-60`}>
      <div className="flex items-start gap-3">
        {/* Priority dot */}
        <div className="flex-shrink-0 pt-1">
          <div
            className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`}
            style={
              item.priority === 'urgent' ? { boxShadow: '0 0 8px rgba(239,68,68,0.85)' } :
              item.priority === 'high'   ? { boxShadow: '0 0 7px rgba(251,146,60,0.7)' } :
              item.priority === 'medium' ? { boxShadow: '0 0 7px rgba(212,175,55,0.6)' } : undefined
            }
          />
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => onDetail(item)}
              className="text-white font-semibold text-sm hover:text-gold transition-colors text-left"
            >
              {item.customerName}
            </button>
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color} border-current/20`}>
              {cfg.label}
            </span>
            <span className="text-[10px] capitalize text-white/30 bg-white/5 border border-white/8 rounded-full px-2 py-0.5">
              {item.status}
            </span>
          </div>

          {/* Sub-row: staff + phone + last contact */}
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {isAdmin && (
              <span className="text-gold/50 text-xs flex items-center gap-1">
                <div className="w-4 h-4 rounded-full bg-gold/15 border border-gold/25 flex items-center justify-center text-[8px] font-bold text-gold">
                  {item.assignedStaffAvatar}
                </div>
                {item.assignedStaffName}
              </span>
            )}
            {item.phone && <span className="text-white/25 text-[11px]">{item.phone}</span>}
            <span className={`text-[11px] font-medium ${
              item.lastContactDays === null ? 'text-red-400' :
              item.lastContactDays > 14    ? 'text-red-400' :
              item.lastContactDays > 7     ? 'text-orange-400' : 'text-white/40'
            }`}>
              {item.lastContactDays === null ? '⚠ Never contacted' :
               item.lastContactDays === 0   ? '✓ Contacted today' :
               `${item.lastContactDays}d since contact`}
            </span>
          </div>

          {/* Pattern chips */}
          <PatternChips patterns={item.patterns} metrics={item.metrics} />

          {/* AI insight */}
          {(item.insight || item.nextAction) && (
            <div className="mt-3 space-y-1.5">
              {item.insight && (
                <div className="flex items-start gap-2 text-[11px] text-white/55 leading-relaxed">
                  <Brain size={11} className="text-gold/70 flex-shrink-0 mt-0.5 drop-shadow-[0_0_8px_rgba(212,175,55,0.65)]" />
                  <span>{item.insight}</span>
                </div>
              )}
              {item.nextAction && (
                <div className="flex items-start gap-2 text-[11px] leading-relaxed">
                  <Sparkles size={11} className="text-gold flex-shrink-0 mt-0.5" />
                  <span className="text-gold/80 font-medium">{item.nextAction}</span>
                </div>
              )}
            </div>
          )}

          {/* Score bar */}
          <div className="flex items-center gap-2 mt-3">
            <div className="flex-1 h-1 bg-dark-200 rounded-full">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${item.priorityScore}%`,
                  background: item.priorityScore >= 80 ? '#f87171' :
                              item.priorityScore >= 60 ? '#f97316' : GOLD,
                  boxShadow: item.priorityScore >= 80 ? '0 0 6px rgba(248,113,113,0.6)' :
                             item.priorityScore >= 60 ? '0 0 6px rgba(249,115,22,0.6)' : '0 0 5px rgba(212,175,55,0.5)',
                }}
              />
            </div>
            <span className="text-white/20 text-[10px] flex-shrink-0">{item.priorityScore}/100</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 flex-shrink-0">
          <button
            onClick={() => onLog(item)}
            className="btn-secondary text-[11px] py-1.5 px-2.5 flex items-center gap-1"
          >
            <Phone size={11} /> Log
          </button>
          <button
            onClick={() => onDetail(item)}
            className="text-white/25 hover:text-gold transition-colors py-1.5 px-2.5 flex items-center gap-1 text-[11px]"
          >
            Logs <ChevronRight size={10} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Staff behavior tab ────────────────────────────────────────────────────────

function StaffBehaviorTab() {
  const [data, setData]     = useState<StaffBehavior[]>([]);
  const [loading, setLoad]  = useState(true);

  useEffect(() => {
    insightsAPI.staffBehavior()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoad(false));
  }, []);

  if (loading) return <div className="space-y-3">{Array(4).fill(0).map((_, i) => <div key={i} className="card h-28 shimmer" />)}</div>;
  if (data.length === 0) return <p className="text-white/30 text-sm text-center py-12">No staff data available.</p>;

  const qualityCfg = {
    excellent:       { label: 'Excellent',       color: 'text-green-400',  bg: 'bg-green-500/10',  border: 'border-green-500/20' },
    good:            { label: 'Good',            color: 'text-gold',       bg: 'bg-gold/10',       border: 'border-gold/20' },
    needs_attention: { label: 'Needs Attention', color: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20' },
  } as const;

  return (
    <div className="space-y-3">
      {data.map(s => {
        const cfg = qualityCfg[s.qualityLabel];
        return (
          <div key={s.staffId} className={`card border ${cfg.border}`}>
            <div className="flex items-start gap-4">
              {/* Avatar + name */}
              <div className="flex flex-col items-center gap-1 flex-shrink-0 w-16">
                <div className="w-10 h-10 rounded-full bg-gold/15 border border-gold/25 flex items-center justify-center">
                  <span className="text-gold font-bold text-sm">{s.avatar}</span>
                </div>
                <span className="text-white/60 text-[11px] text-center leading-tight">{s.staffName.split(' ')[0]}</span>
                <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
                  {cfg.label}
                </span>
              </div>

              {/* Stats */}
              <div className="flex-1 min-w-0">
                {/* Quality score bar */}
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex-1 h-2 bg-dark-200 rounded-full">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${s.qualityScore}%`,
                        background: s.qualityScore >= 70 ? '#4ade80' : s.qualityScore >= 50 ? GOLD : '#f87171',
                      }}
                    />
                  </div>
                  <span className={`text-xs font-bold ${cfg.color}`}>{s.qualityScore}/100</span>
                </div>

                {/* Metrics grid */}
                <div className="grid grid-cols-3 gap-2 text-center mb-3">
                  {[
                    { label: 'Coverage',      value: `${s.coverage}%`,      sub: `${s.avgInteractions ?? '—'}× avg/customer` },
                    { label: 'Response Rate', value: `${s.responseRate}%`,   sub: 'customers' },
                    { label: 'Sentiment',     value: `${s.sentimentScore}%`, sub: 'positive' },
                  ].map(m => (
                    <div key={m.label} className="bg-dark-200 rounded-xl p-2">
                      <p className="text-white font-semibold text-sm">{m.value}</p>
                      <p className="text-white/30 text-[10px]">{m.label}</p>
                      <p className="text-white/20 text-[9px]">{m.sub}</p>
                    </div>
                  ))}
                </div>

                {/* Stats row */}
                <div className="flex items-center gap-3 flex-wrap text-[11px]">
                  <span className="text-white/40">
                    <span className="text-white font-medium">{s.customersAssigned}</span> customers
                  </span>
                  <span className="text-white/40">
                    <span className="text-white font-medium">{s.recentInteractions}</span> this week
                  </span>
                  {s.streak > 0 && (
                    <span className="flex items-center gap-1 text-gold">
                      <Flame size={10} /> {s.streak}d streak
                    </span>
                  )}
                  {s.overdueCount > 0 && (
                    <span className="text-orange-400">
                      {s.overdueCount} overdue
                    </span>
                  )}
                </div>

                {/* Concerned customers */}
                {s.concernedCustomers.length > 0 && (
                  <div className="mt-2.5 pt-2.5 border-t border-dark-50">
                    <p className="text-red-400/70 text-[10px] mb-1.5 flex items-center gap-1">
                      <AlertTriangle size={9} /> Negative trend detected with:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {s.concernedCustomers.map(c => (
                        <span key={c.id} className="text-[10px] text-red-300/70 bg-red-500/10 border border-red-500/15 rounded-full px-2 py-0.5">
                          {c.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Trends tab ────────────────────────────────────────────────────────────────

const STAGE_ORDER = ['lead', 'contacted', 'interested', 'negotiating', 'closed', 'churned'];
const TYPE_COLORS: Record<string, string> = {
  call: '#60a5fa', message: '#c084fc', email: '#34d399',
  meeting: GOLD, diary: '#f97316', delivery: '#4ade80', other: '#6b7280',
};

function TrendsTab() {
  const [data, setData]    = useState<InsightsTrends | null>(null);
  const [loading, setLoad] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    insightsAPI.trends()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoad(false));
  }, []);

  if (loading) return <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{Array(4).fill(0).map((_, i) => <div key={i} className="card h-52 shimmer" />)}</div>;
  if (!data)   return <p className="text-white/30 text-sm text-center py-12">Could not load trends.</p>;

  const pipelineData = STAGE_ORDER
    .filter(s => data.pipelineBreakdown[s] != null)
    .map(status => ({
      status,
      count: data.pipelineBreakdown[status] || 0,
      pct: data.totalCustomers > 0
        ? Math.round(((data.pipelineBreakdown[status] || 0) / data.totalCustomers) * 100)
        : 0,
    }));

  // Win rate
  const closedCount = data.pipelineBreakdown['closed'] || 0;
  const churnedCount = data.pipelineBreakdown['churned'] || 0;
  const winRate = (closedCount + churnedCount) > 0
    ? Math.round((closedCount / (closedCount + churnedCount)) * 100)
    : null;

  return (
    <div className="space-y-4">
      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Customers',    value: data.totalCustomers,    sub: 'in pipeline',   color: 'text-white' },
          { label: 'Total Interactions', value: data.totalInteractions, sub: 'all time',       color: 'text-white' },
          { label: 'Closed',             value: closedCount,            sub: 'deals won',      color: 'text-emerald-400' },
          { label: 'Win Rate',           value: winRate !== null ? `${winRate}%` : '—',        sub: 'closed vs churned', color: winRate !== null && winRate >= 50 ? 'text-emerald-400' : 'text-red-400' },
        ].map(s => (
          <div key={s.label} className="card text-center py-3">
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-white/40 text-xs mt-0.5">{s.label}</p>
            <p className="text-white/20 text-[10px]">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Weekly Activity — bars (volume) + line (response rate) ── */}
      {data.sentimentByWeek.length > 0 && (
        <div className="card">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                <TrendingUp size={14} className="text-gold" /> Weekly Activity
              </h3>
              <p className="text-white/30 text-xs mt-0.5">Interactions logged per week · response rate %</p>
            </div>
            <div className="text-right">
              <p className="text-white font-bold text-lg">{data.sentimentByWeek[data.sentimentByWeek.length - 1]?.total ?? 0}</p>
              <p className="text-white/30 text-[10px]">this week</p>
            </div>
          </div>
          <div className="mt-3">
            <ResponsiveContainer width="100%" height={180}>
              <ComposedChart data={data.sentimentByWeek} barSize={22}>
                <CartesianGrid vertical={false} stroke={DIM} />
                <XAxis dataKey="week" tick={{ fill: '#555', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="count" tick={{ fill: '#555', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="rate" orientation="right" domain={[0, 100]} tick={{ fill: '#555', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const bar  = payload.find(p => p.dataKey === 'total');
                    const line = payload.find(p => p.dataKey === 'responseRate');
                    return (
                      <div className="bg-dark-200 border border-dark-50 rounded-xl p-3 text-xs shadow-xl">
                        <p className="text-white/50 mb-1.5 font-medium">{label}</p>
                        {bar  && <p className="text-gold font-semibold">{bar.value} interactions logged</p>}
                        {line && <p className="text-blue-400 font-semibold">{line.value}% customers responded</p>}
                      </div>
                    );
                  }}
                  cursor={{ fill: 'rgba(212,175,55,0.04)' }}
                />
                <Bar yAxisId="count" dataKey="total" radius={[3, 3, 0, 0]} fill={GOLD} fillOpacity={0.25}>
                  {data.sentimentByWeek.map((_, i) => (
                    <Cell key={i} fill={i === data.sentimentByWeek.length - 1 ? GOLD : GOLD} fillOpacity={i === data.sentimentByWeek.length - 1 ? 0.8 : 0.25} />
                  ))}
                </Bar>
                <Line yAxisId="rate" type="monotone" dataKey="responseRate" stroke="#60a5fa" strokeWidth={2} dot={{ fill: '#60a5fa', r: 3, strokeWidth: 0 }} />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-4 mt-1 justify-end">
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-gold/70" /><span className="text-white/30 text-[10px]">Interactions</span></div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-1.5 rounded-full bg-blue-400" /><span className="text-white/30 text-[10px]">Response %</span></div>
            </div>
          </div>
        </div>
      )}

      {/* ── Pipeline funnel + Interaction types ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Pipeline — ordered funnel with % and deal value */}
        <div className="card">
          <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
            <BarChart2 size={14} className="text-gold" /> Pipeline Funnel
          </h3>
          <div className="space-y-2">
            {pipelineData.map(d => (
              <div key={d.status} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="capitalize font-medium" style={{ color: PIPELINE_COLORS[d.status] || '#666' }}>{d.status}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-white/60 font-semibold">{d.count}</span>
                    <span className="text-white/25 text-[10px] w-8 text-right">{d.pct}%</span>
                  </div>
                </div>
                <div className="h-2 bg-dark-200 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${d.pct}%`,
                      background: PIPELINE_COLORS[d.status] || '#666',
                      opacity: 0.8,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Interaction type breakdown */}
        <div className="card">
          <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
            <Activity size={14} className="text-gold" /> How You Contact
          </h3>
          {data.interactionTypeBreakdown?.length > 0 ? (
            <div className="space-y-2.5">
              {data.interactionTypeBreakdown.slice(0, 6).map(t => (
                <div key={t.type} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="capitalize font-medium" style={{ color: TYPE_COLORS[t.type] || '#666' }}>{t.type}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-white/25 text-[10px]">{t.responseRate}% responded</span>
                      <span className="text-white/60 font-semibold">{t.count}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-dark-200 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.round((t.count / (data.interactionTypeBreakdown[0]?.count || 1)) * 100)}%`,
                        background: TYPE_COLORS[t.type] || '#666',
                        opacity: 0.75,
                      }}
                    />
                  </div>
                </div>
              ))}
              <p className="text-white/20 text-[10px] pt-1">Total: {data.totalInteractions} contacts logged</p>
            </div>
          ) : (
            <p className="text-white/25 text-sm text-center py-8">No interaction data yet</p>
          )}
        </div>
      </div>

      {/* ── Most Engaged Customers ── */}
      <div className="card">
        <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
          <Activity size={14} className="text-gold" /> Most Engaged Customers
          <span className="text-white/20 text-xs font-normal ml-1">by interaction count</span>
        </h3>
        <div className="space-y-2">
          {data.topCustomers.slice(0, 8).map((c, i) => (
            <div
              key={c.id}
              className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/[0.03] transition-colors cursor-pointer group"
              onClick={() => navigate(`/crm?search=${encodeURIComponent(c.name)}`)}
            >
              <span className="text-white/20 text-xs w-5 text-right flex-shrink-0">#{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-white text-sm font-medium truncate group-hover:text-gold transition-colors">{c.name}</p>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-white/50 text-xs font-semibold">{c.interactions}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1 bg-dark-200 rounded-full">
                    <div
                      className="h-full rounded-full bg-gold"
                      style={{ width: `${Math.round((c.interactions / (data.topCustomers[0]?.interactions || 1)) * 100)}%`, opacity: 0.7 }}
                    />
                  </div>
                  <span className="capitalize text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ color: PIPELINE_COLORS[c.status] || '#666', background: `${PIPELINE_COLORS[c.status] || '#666'}18` }}>
                    {c.status}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Ghost customers ── */}
      {data.ghostCustomers.length > 0 && (
        <div className="card border-red-500/15">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-red-400 font-semibold text-sm flex items-center gap-2">
              <Ghost size={14} /> Ghost Customers
              <span className="text-[10px] bg-red-500/15 text-red-300 rounded-full px-2 py-0.5">{data.ghostCustomers.length}</span>
            </h3>
            <button onClick={() => navigate('/crm')} className="text-red-400/60 text-xs hover:text-red-400 flex items-center gap-1">
              View in CRM <ChevronRight size={11} />
            </button>
          </div>
          <p className="text-white/30 text-xs mb-3">Active pipeline customers with zero contact in 30+ days — they may go cold</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {data.ghostCustomers.map(c => (
              <div key={c.id} className="flex items-center justify-between gap-2 text-[11px] text-red-300/80 bg-red-500/5 border border-red-500/15 rounded-lg px-2.5 py-2">
                <span className="truncate">{c.name}</span>
                <span className="text-red-400/50 flex-shrink-0 font-semibold">{c.daysSince === null ? 'never' : `${c.daysSince}d`}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top tags */}
      {data.topTags.length > 0 && (
        <div className="card">
          <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
            <Shield size={14} className="text-gold" /> Customer Tags
          </h3>
          <div className="flex flex-wrap gap-2">
            {data.topTags.map(({ tag, count }) => (
              <span key={tag} className="inline-flex items-center gap-1.5 text-xs text-gold/70 bg-gold/8 border border-gold/20 rounded-full px-3 py-1">
                {tag} <span className="text-gold/40 font-semibold">{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Quick log modal ───────────────────────────────────────────────────────────

const TYPE_ICON: Record<string, React.ElementType> = {
  call: Phone, message: MessageSquare, email: Activity, meeting: Clock,
};

function QuickLogModal({ customer, onClose, onLogged }: {
  customer: CustomerInsight; onClose: () => void; onLogged: () => void;
}) {
  const [type, setType]         = useState<Interaction['type']>('call');
  const [responded, setResp]    = useState(false);
  const [notes, setNotes]       = useState('');
  const [followUp, setFollowUp] = useState('');
  const [saving, setSaving]     = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await interactionsAPI.create({
        customerId: customer.customerId, type, responded, notes,
        followUpDate: followUp || null,
      });
      onLogged();
    } finally { setSaving(false); }
  };

  return (
    <Portal>
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="bg-dark-300 border border-dark-50 rounded-t-2xl sm:rounded-2xl w-full max-w-sm shadow-2xl animate-slide-up sm:animate-scale-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-50">
          <div>
            <p className="text-white font-semibold text-sm">Log Interaction</p>
            <p className="text-white/30 text-xs">{customer.customerName}</p>
          </div>
          <button type="button" onClick={onClose} className="text-white/30 hover:text-white transition-colors"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-4 gap-2">
            {(['call', 'message', 'email', 'meeting'] as const).map(t => {
              const Icon = TYPE_ICON[t] || Phone;
              return (
                <button type="button" key={t} onClick={() => setType(t)}
                  className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                    type === t ? 'border-gold bg-gold/10 text-gold' : 'border-dark-50 text-white/40 hover:text-white'
                  }`}
                >
                  <Icon size={13} /> {t}
                </button>
              );
            })}
          </div>
          <div className="flex gap-3">
            {[{ v: true, l: 'Responded ✓' }, { v: false, l: 'No response ✗' }].map(({ v, l }) => (
              <button type="button" key={String(v)} onClick={() => setResp(v)}
                className={`flex-1 py-2 rounded-xl border text-sm font-medium transition-all ${
                  responded === v
                    ? v ? 'border-green-500/50 bg-green-500/10 text-green-400' : 'border-red-500/50 bg-red-500/10 text-red-400'
                    : 'border-dark-50 text-white/40 hover:text-white'
                }`}>{l}</button>
            ))}
          </div>
          <textarea className="input resize-none" rows={2} placeholder="Notes (optional)"
            value={notes} onChange={e => setNotes(e.target.value)} />
          <input type="date" className="input" value={followUp}
            min={new Date().toISOString().split('T')[0]}
            onChange={e => setFollowUp(e.target.value)} />
        </div>
        <div className="px-5 pb-5 flex gap-3">
          <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button type="button" onClick={submit} disabled={saving} className="btn-primary flex-1">
            {saving ? 'Logging...' : 'Log Interaction'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = 'queue' | 'staff' | 'trends';

export default function FollowupQueue() {
  const [tab, setTab]                 = useState<Tab>('queue');
  const [queue, setQueue]             = useState<CustomerInsight[]>([]);
  const [loading, setLoading]         = useState(true);
  const [priorityFilter, setPriority] = useState<CustomerInsight['priority'] | 'all'>('all');
  const [staffFilter, setStaffFilter] = useState('all');
  const [logging, setLogging]         = useState<CustomerInsight | null>(null);
  const [detailCustomer, setDetail]   = useState<CustomerInsight | null>(null);
  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const data = await insightsAPI.queue();
      setQueue(Array.isArray(data) ? data : []);
    } catch { /* show empty */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  const filtered = queue.filter(item => {
    const matchP = priorityFilter === 'all' || item.priority === priorityFilter;
    const matchS = staffFilter === 'all' || item.assignedTo === staffFilter;
    return matchP && matchS;
  });

  const counts = {
    urgent: queue.filter(q => q.priority === 'urgent').length,
    high:   queue.filter(q => q.priority === 'high').length,
    medium: queue.filter(q => q.priority === 'medium').length,
    low:    queue.filter(q => q.priority === 'low').length,
  };

  // Collect unique staff from queue for filter
  const queueStaff = [...new Map(
    queue.filter(q => q.assignedTo).map(q => [q.assignedTo, { id: q.assignedTo!, name: q.assignedStaffName }])
  ).values()];

  const tabs: { id: Tab; label: string; icon: React.ElementType; adminOnly?: boolean }[] = [
    { id: 'queue',  label: 'Priority Queue',   icon: Clock },
    { id: 'staff',  label: 'Staff Behavior',   icon: Users, adminOnly: true },
    { id: 'trends', label: 'Trends',           icon: TrendingUp },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Brain size={24} className="text-gold" />
          Follow-up Queue & Insights
        </h1>
        <p className="text-white/30 text-sm mt-1">
          AI-prioritized customer queue · behavioral pattern analysis
        </p>
      </div>

      {/* ── Tab bar ────────────────────────────────────────────────────── */}
      <TabBar
        tabs={tabs.filter(t => !t.adminOnly || isAdmin)}
        active={tab}
        onChange={id => setTab(id as Tab)}
        variant="pill-gold"
      />

      {/* ── Tab content — keyed so AnimatedTabPanel remounts on switch ── */}
      <AnimatedTabPanel key={tab} className="space-y-6">

      {/* ── Queue tab ──────────────────────────────────────────────────── */}
      {tab === 'queue' && (
        <>
          {/* Priority summary tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(['urgent', 'high', 'medium', 'low'] as const).map(p => {
              const cfg = PRIORITY_CFG[p];
              return (
                <button
                  key={p}
                  onClick={() => setPriority(priorityFilter === p ? 'all' : p)}
                  className={`card text-left transition-all ${priorityFilter === p ? `${cfg.border} ${cfg.bg}` : ''}`}
                >
                  <p className={`text-2xl font-black ${cfg.color}`}>{counts[p]}</p>
                  <p className="text-white/30 text-xs capitalize mt-0.5">{cfg.label}</p>
                </button>
              );
            })}
          </div>

          {/* Filters */}
          {(isAdmin && queueStaff.length > 0) && (
            <div className="flex gap-3 flex-wrap">
              <select className="input flex-shrink-0 w-auto" value={staffFilter}
                onChange={e => setStaffFilter(e.target.value)}>
                <option value="all">All Staff</option>
                {queueStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}

          {/* AI note */}
          {!loading && queue.some(q => q.insight) && (
            <div className="flex items-center gap-2 text-xs text-white/30 bg-gold/5 border border-gold/15 rounded-xl px-3 py-2">
              <Sparkles size={12} className="text-gold flex-shrink-0" />
              <span>AI insights generated for top customers · patterns computed from diary entries and interactions</span>
            </div>
          )}

          {/* List */}
          {loading ? (
            <div className="space-y-3">
              {Array(6).fill(0).map((_, i) => <div key={i} className="card h-24 shimmer" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="card flex flex-col items-center py-16 text-center">
              <CheckCircle size={36} className="text-white/10 mb-4" />
              <p className="text-white/40 font-medium">All clear!</p>
              <p className="text-white/20 text-sm mt-1">No customers match the current filter</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filtered.map(item => (
                <QueueCard
                  key={item.customerId}
                  item={item}
                  isAdmin={isAdmin}
                  onLog={setLogging}
                  onNavigate={id => navigate(`/customers?highlight=${id}`)}
                  onDetail={setDetail}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Staff behavior tab ─────────────────────────────────────────── */}
      {tab === 'staff' && isAdmin && <StaffBehaviorTab />}

      {/* ── Trends tab ─────────────────────────────────────────────────── */}
      {tab === 'trends' && <TrendsTab />}

      </AnimatedTabPanel>

      {/* ── Log modal ──────────────────────────────────────────────────── */}
      {logging && (
        <QuickLogModal
          customer={logging}
          onClose={() => setLogging(null)}
          onLogged={() => { setLogging(null); loadQueue(); }}
        />
      )}

      {/* ── Customer detail panel ──────────────────────────────────────── */}
      {detailCustomer && (
        <CustomerDetailPanel
          item={detailCustomer}
          onClose={() => setDetail(null)}
          onLog={c => { setDetail(null); setLogging(c); }}
          onNavigate={id => navigate(`/customers?highlight=${id}`)}
        />
      )}
    </div>
  );
}
