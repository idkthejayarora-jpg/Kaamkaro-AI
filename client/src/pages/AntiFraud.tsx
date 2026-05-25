import { useEffect, useState, useCallback, useRef } from 'react';
import { TabBar, AnimatedTabPanel } from '../components/TabBar';
import {
  AlertTriangle, ShieldOff, RefreshCw, Loader2,
  ChevronDown, Zap, Clock, ToggleLeft, TrendingUp,
  Award, Copy, BookOpen, CheckCircle2, Gavel,
  Eye, EyeOff, History, User, Clipboard, Users, type LucideIcon,
  TextSearch, Trash2, ExternalLink, Sparkles, Check,
} from 'lucide-react';
import { fraudAPI } from '../lib/api';
import Portal from '../components/Portal';
import { useNavigate } from 'react-router-dom';

// ── Types ──────────────────────────────────────────────────────────────────────
interface FraudAlert {
  id: string; staffId: string; staffName: string;
  type: string; severity: 'high' | 'medium' | 'low';
  title: string; detail: string; evidence: string;
  taskId?: string; taskTitle?: string; taskTitles?: string[];
  isRepeat: boolean; weekCount: number; pastWeeks: string[];
  detectedAt: string;
}
interface SuspiciousCustomer {
  id: string; name: string; reason: string;
  staffId: string | null; staffName: string;
  createdAt: string; phone: string | null;
}

interface FraudRecord {
  id: string; staffId: string; staffName?: string;
  fraudType: string; alertTitle: string; notes: string;
  action: 'fine' | 'dismiss'; points?: number;
  week: string; issuedAt: string;
}

// ── Config ─────────────────────────────────────────────────────────────────────
const TYPE_META: Record<string, { label: string; icon: LucideIcon }> = {
  // Task checks
  task_speed:             { label: 'Lightning Completion', icon: Zap         },
  task_burst:             { label: 'Hollow Task Burst',    icon: Clock       },
  task_toggle:            { label: 'Toggle Abuse',         icon: ToggleLeft  },
  // Merit checks
  merit_haul:             { label: 'Merit Haul',           icon: TrendingUp  },
  merit_repeat:           { label: 'Manual Repeat',        icon: Award       },
  merit_duplicate_reason: { label: 'Repeat Reason',        icon: Copy        },
  loop_abuse:             { label: 'Loop Abuse',           icon: RefreshCw   },
  // Diary content-quality checks (replaced diary_spam)
  thin_diary_burst:       { label: 'Hollow Diary Burst',   icon: BookOpen    },
  copy_paste_diary:       { label: 'Copy-Paste Diary',     icon: Clipboard   },
  all_general_bulk:       { label: 'No Customer Matches',  icon: Users       },
  // Legacy (may appear in old records)
  diary_spam:             { label: 'Diary Spam (legacy)',  icon: BookOpen    },
};
const SEV_COLOR: Record<string, string> = {
  high:   'bg-red-500/15    text-red-400    border-red-500/25',
  medium: 'bg-amber-500/15  text-amber-400  border-amber-500/25',
  low:    'bg-blue-500/10   text-blue-400   border-blue-500/20',
};
const SEV_DOT: Record<string, string> = {
  high:   'bg-red-500',
  medium: 'bg-amber-400',
  low:    'bg-blue-400',
};

// ── Confirm modal ──────────────────────────────────────────────────────────────
function ConfirmModal({
  staffName, alertTitle, onConfirm, onCancel, loading,
}: {
  staffName: string; alertTitle: string;
  onConfirm: (notes: string) => void; onCancel: () => void; loading: boolean;
}) {
  const [notes, setNotes] = useState('');
  return (
    <Portal>
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:px-4 bg-black/60 backdrop-blur-sm">
      <div className="card w-full max-w-sm space-y-4 shadow-2xl rounded-t-2xl sm:rounded-2xl">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-red-500/10 flex-shrink-0">
            <Gavel size={18} className="text-red-400" />
          </div>
          <div>
            <p className="text-white font-semibold">Issue −10 Merit Fine</p>
            <p className="text-white/40 text-xs mt-0.5">
              This will deduct 10 points from <span className="text-white/70">{staffName}</span>'s merit score and log the action permanently.
            </p>
          </div>
        </div>

        <div className="bg-dark-300 rounded-xl p-3 text-xs text-white/50 border border-dark-50">
          <span className="text-white/25 uppercase tracking-wide text-[10px]">Alert</span>
          <p className="mt-0.5 text-white/70">{alertTitle}</p>
        </div>

        <div>
          <label className="label mb-1.5 block">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            className="input w-full resize-none text-sm"
            placeholder="Reason for fine, warnings given, etc…"
          />
        </div>

        <div className="flex gap-2">
          <button onClick={onCancel} disabled={loading} className="btn-ghost flex-1 text-sm">Cancel</button>
          <button
            onClick={() => onConfirm(notes)}
            disabled={loading}
            className="flex-1 bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/20 rounded-xl py-2 text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Gavel size={14} />}
            {loading ? 'Fining…' : 'Confirm Fine'}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

// ── Alert card ─────────────────────────────────────────────────────────────────
function AlertCard({
  alert, onFine, onDismiss, actionState,
}: {
  alert: FraudAlert;
  onFine: (alert: FraudAlert) => void;
  onDismiss: (alert: FraudAlert) => void;
  actionState: 'idle' | 'fined' | 'dismissed';
}) {
  const [expanded, setExpanded] = useState(false);
  const meta  = TYPE_META[alert.type] || { label: alert.type, icon: AlertTriangle };
  const Icon  = meta.icon;
  const isTaskRelated = alert.taskId || (alert.taskTitles && alert.taskTitles.length > 0);

  if (actionState !== 'idle') {
    return (
      <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${actionState === 'fined' ? 'bg-red-500/5 border-red-500/15' : 'bg-dark-300 border-dark-50 opacity-50'}`}>
        <CheckCircle2 size={14} className={actionState === 'fined' ? 'text-red-400' : 'text-white/30'} />
        <span className={`text-xs ${actionState === 'fined' ? 'text-red-400' : 'text-white/30'}`}>
          {actionState === 'fined' ? `−10 pts fine issued to ${alert.staffName}` : `Alert dismissed`}
        </span>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border overflow-hidden ${alert.isRepeat ? 'border-red-500/30' : 'border-dark-50'}`}>
      {/* Repeat offender banner */}
      {alert.isRepeat && (
        <div className="bg-red-500/10 border-b border-red-500/20 px-3 py-1.5 flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-red-400 text-[10px] font-semibold uppercase tracking-wide">
            Repeat Offender — Week {alert.weekCount} · Previously fined {alert.weekCount - 1}×
          </span>
        </div>
      )}

      {/* Main row */}
      <div className="bg-dark-300">
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full flex items-start gap-3 px-3 py-3 text-left hover:bg-white/2 transition-colors"
        >
          {/* Severity dot */}
          <div className="mt-1 flex-shrink-0">
            <div className={`w-2 h-2 rounded-full ${SEV_DOT[alert.severity]}`} />
          </div>

          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-white text-sm font-semibold">{alert.title}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${SEV_COLOR[alert.severity]}`}>
                {alert.severity.toUpperCase()}
              </span>
              <span className="text-[10px] bg-dark-400 text-white/30 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                <Icon size={9} />{meta.label}
              </span>
            </div>
            <p className="text-white/40 text-xs leading-relaxed line-clamp-2">{alert.detail}</p>
          </div>

          <ChevronDown size={14} className={`text-white/20 flex-shrink-0 mt-1 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>

        {/* Expanded */}
        {expanded && (
          <div className="px-3 pb-3 space-y-3 border-t border-dark-50 pt-3">
            {/* Full detail */}
            <p className="text-white/60 text-sm leading-relaxed">{alert.detail}</p>

            {/* Task highlight — the specific tasks flagged */}
            {isTaskRelated && (
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 space-y-1.5">
                <p className="text-amber-400 text-[10px] uppercase tracking-wide font-semibold flex items-center gap-1.5">
                  <AlertTriangle size={10} /> Flagged Task{alert.taskTitles && alert.taskTitles.length > 1 ? 's' : ''}
                </p>
                {alert.taskTitle && !alert.taskTitles && (
                  <p className="text-white/80 text-sm font-medium">"{alert.taskTitle}"</p>
                )}
                {alert.taskTitles && alert.taskTitles.map((t, i) => (
                  <p key={i} className="text-white/70 text-xs font-medium">· "{t}"</p>
                ))}
              </div>
            )}

            {/* Evidence */}
            <div className="bg-dark-400 rounded-xl p-3 border border-dark-50">
              <p className="text-white/25 text-[10px] uppercase tracking-wide mb-1">Evidence</p>
              <p className="text-white/55 text-xs font-mono leading-relaxed">{alert.evidence}</p>
            </div>

            {/* Past fines for repeat */}
            {alert.isRepeat && alert.pastWeeks.length > 0 && (
              <div className="bg-red-500/5 border border-red-500/15 rounded-xl p-3">
                <p className="text-red-400 text-[10px] uppercase tracking-wide mb-1.5">Previously fined</p>
                <div className="flex flex-wrap gap-1.5">
                  {alert.pastWeeks.map((w, i) => (
                    <span key={i} className="text-[10px] bg-red-500/10 text-red-300 px-2 py-0.5 rounded-full">{w}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => onFine(alert)}
                className="flex items-center gap-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-xl px-3 py-2 text-xs font-medium transition-colors"
              >
                <Gavel size={12} />
                {alert.isRepeat ? 'Fine Again −10 pts' : 'Fine −10 pts'}
              </button>
              <button
                onClick={() => onDismiss(alert)}
                className="flex items-center gap-1.5 btn-ghost text-white/30 text-xs"
              >
                <EyeOff size={12} />
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Staff initials avatar (consistent gradient per name) ──────────────────────
function StaffAvatar({ name, size = 40, isOffender }: { name: string; size?: number; isOffender: boolean }) {
  const GRADIENTS = [
    ['#7c3aed', '#a855f7'], ['#dc2626', '#f87171'], ['#0891b2', '#22d3ee'],
    ['#b45309', '#fbbf24'], ['#065f46', '#34d399'], ['#1d4ed8', '#60a5fa'],
    ['#be185d', '#f472b6'], ['#4338ca', '#818cf8'],
  ];
  const idx = (name.charCodeAt(0) + (name.charCodeAt(1) || 0)) % GRADIENTS.length;
  const [c1, c2] = GRADIENTS[idx];
  return (
    <div
      className="rounded-xl flex items-center justify-center font-bold text-white flex-shrink-0"
      style={{
        width: size, height: size, fontSize: size * 0.38,
        background: `linear-gradient(135deg, ${c1}, ${c2})`,
        boxShadow: isOffender ? '0 0 0 2px rgba(239,68,68,0.4)' : 'none',
      }}
    >
      {name[0]?.toUpperCase()}
    </div>
  );
}

// ── Severity bar — visual breakdown of alert mix ──────────────────────────────
function SeverityBar({ alerts }: { alerts: FraudAlert[] }) {
  const high   = alerts.filter(a => a.severity === 'high').length;
  const medium = alerts.filter(a => a.severity === 'medium').length;
  const low    = alerts.filter(a => a.severity === 'low').length;
  const total  = alerts.length || 1;
  return (
    <div className="flex gap-0.5 h-1.5 rounded-full overflow-hidden w-24">
      {high   > 0 && <div className="bg-red-500"    style={{ width: `${(high   / total) * 100}%` }} />}
      {medium > 0 && <div className="bg-amber-400"  style={{ width: `${(medium / total) * 100}%` }} />}
      {low    > 0 && <div className="bg-blue-400"   style={{ width: `${(low    / total) * 100}%` }} />}
    </div>
  );
}

// ── SwipeCard — swipe left to delete, swipe right to learn/whitelist ──────────
function SwipeCard({
  customer,
  onDelete,
  onLearn,
  onView,
}: {
  customer: SuspiciousCustomer;
  onDelete: () => void;
  onLearn:  () => void;
  onView:   () => void;
}) {
  const [dx, setDx]           = useState(0);
  const [dragging, setDrag]   = useState(false);
  const [dismissed, setDism]  = useState(false);
  const startX                = useRef(0);
  const startY                = useRef(0);
  const isSwipe               = useRef(false);
  const THRESHOLD             = 90;

  const onTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    isSwipe.current = false;
    setDrag(true);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const distX = e.touches[0].clientX - startX.current;
    const distY = Math.abs(e.touches[0].clientY - startY.current);
    if (!isSwipe.current && distY > 8) { setDrag(false); return; } // vertical scroll
    if (Math.abs(distX) > 6) isSwipe.current = true;
    if (isSwipe.current) { e.preventDefault(); setDx(distX); }
  };
  const onTouchEnd = () => {
    setDrag(false);
    if (dx < -THRESHOLD) {
      // Swipe left → delete
      setDism(true);
      setTimeout(onDelete, 320);
    } else if (dx > THRESHOLD) {
      // Swipe right → learn
      setDism(true);
      setTimeout(onLearn, 320);
    } else {
      setDx(0);
    }
  };

  const reasonColor =
    customer.reason.includes('phrase') || customer.reason.includes('Hindi action') || customer.reason.includes('Sentence')
      ? { pill: 'bg-red-500/15 text-red-400 border-red-500/20', dot: '#f87171' }
      : customer.reason.includes('product') || customer.reason.includes('Quantity')
      ? { pill: 'bg-orange-500/15 text-orange-400 border-orange-500/20', dot: '#fb923c' }
      : customer.reason.includes('pronoun') || customer.reason.includes('placeholder') || customer.reason.includes('Number')
      ? { pill: 'bg-amber-500/12 text-amber-400 border-amber-500/18', dot: '#fbbf24' }
      : { pill: 'bg-white/8 text-white/40 border-white/10', dot: '#666' };

  const clampedDx  = Math.max(-160, Math.min(160, dx));
  const swipeLeft  = clampedDx < -20;
  const swipeRight = clampedDx > 20;
  const opacity    = dismissed ? 0 : 1;
  const maxH       = dismissed ? 0 : 80;

  return (
    <div
      style={{ overflow: 'hidden', transition: dismissed ? 'max-height 0.32s ease, opacity 0.28s ease' : '', maxHeight: maxH, opacity }}
    >
      <div className="relative mx-0" style={{ touchAction: 'pan-y' }}>
        {/* Left reveal — delete (red) */}
        <div className="absolute inset-y-0 right-0 flex items-center justify-end pr-5 rounded-r-2xl"
          style={{ background: 'rgba(239,68,68,0.18)', width: '100%', opacity: swipeLeft ? Math.min(1, Math.abs(clampedDx) / THRESHOLD) : 0, transition: dragging ? 'none' : 'opacity 0.2s' }}>
          <div className="flex flex-col items-center gap-1">
            <Trash2 size={18} className="text-red-400" />
            <span className="text-red-400 text-[10px] font-bold uppercase tracking-wide">Delete</span>
          </div>
        </div>

        {/* Right reveal — learn (green) */}
        <div className="absolute inset-y-0 left-0 flex items-center justify-start pl-5 rounded-l-2xl"
          style={{ background: 'rgba(52,211,153,0.18)', width: '100%', opacity: swipeRight ? Math.min(1, clampedDx / THRESHOLD) : 0, transition: dragging ? 'none' : 'opacity 0.2s' }}>
          <div className="flex flex-col items-center gap-1">
            <Sparkles size={18} className="text-emerald-400" />
            <span className="text-emerald-400 text-[10px] font-bold uppercase tracking-wide">Learn</span>
          </div>
        </div>

        {/* Card */}
        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={{
            transform: `translateX(${clampedDx}px)`,
            transition: dragging ? 'none' : 'transform 0.35s cubic-bezier(0.16,1,0.3,1)',
          }}
          className="relative bg-dark-300 border border-dark-50 rounded-2xl px-4 py-3 flex items-center gap-3 select-none"
        >
          {/* Colour dot */}
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: reasonColor.dot, boxShadow: `0 0 6px ${reasonColor.dot}80` }} />

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-white text-sm font-semibold">{customer.name}</p>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${reasonColor.pill}`}>
                {customer.reason}
              </span>
            </div>
            <p className="text-white/25 text-[11px] mt-0.5">
              {customer.staffName}
              {customer.phone ? ` · ${customer.phone}` : ''}
              {' · '}
              {new Date(customer.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </p>
          </div>

          {/* Desktop action buttons (hidden on touch) */}
          <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
            <button onClick={onView}   className="p-1.5 rounded-lg text-white/25 hover:text-gold hover:bg-gold/10 transition-colors" title="View">
              <ExternalLink size={13} />
            </button>
            <button onClick={onLearn}  className="p-1.5 rounded-lg text-white/25 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors" title="Mark as valid name — teach the model">
              <Check size={13} />
            </button>
            <button onClick={onDelete} className="p-1.5 rounded-lg text-white/25 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Delete customer">
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function AntiFraud() {
  const navigate = useNavigate();
  const [alerts,      setAlerts]      = useState<FraudAlert[]>([]);
  const [records,     setRecords]     = useState<FraudRecord[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [scannedAt,   setScannedAt]   = useState('');
  const [tab,         setTab]         = useState<'live' | 'history' | 'odd-names'>('live');
  const [suspNames,       setSuspNames]       = useState<SuspiciousCustomer[]>([]);
  const [suspNamesLoading, setSuspNamesLoading] = useState(false);
  const [fineModal,   setFineModal]   = useState<FraudAlert | null>(null);
  const [fineLoading, setFineLoading] = useState(false);
  const [expandedStaff, setExpandedStaff] = useState<Set<string>>(new Set());
  const [showLegend,    setShowLegend]    = useState(false);
  // per-alert action state: 'idle' | 'fined' | 'dismissed'
  const [actionState, setActionState] = useState<Record<string, 'idle' | 'fined' | 'dismissed'>>({});

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [det, recs] = await Promise.all([
        fraudAPI.detect().catch(() => ({ alerts: [], scannedAt: '' })),
        fraudAPI.records().catch(() => []),
      ]);
      setAlerts(det.alerts || []);
      setScannedAt(det.scannedAt || '');
      setRecords(recs);
    } catch (e: unknown) {
      setError((e as { message?: string })?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Group alerts by staff, sort worst first
  const byStaff: Record<string, { name: string; alerts: FraudAlert[] }> = {};
  for (const a of alerts) {
    if (!byStaff[a.staffId]) byStaff[a.staffId] = { name: a.staffName, alerts: [] };
    byStaff[a.staffId].alerts.push(a);
  }
  const staffGroups = Object.entries(byStaff).sort((a, b) => {
    const aRepeat = a[1].alerts.some(x => x.isRepeat);
    const bRepeat = b[1].alerts.some(x => x.isRepeat);
    if (aRepeat !== bRepeat) return bRepeat ? 1 : -1;
    const aHigh = a[1].alerts.filter(x => x.severity === 'high').length;
    const bHigh = b[1].alerts.filter(x => x.severity === 'high').length;
    return bHigh - aHigh;
  });

  // Auto-expand the worst offender when results arrive
  useEffect(() => {
    if (staffGroups.length > 0 && expandedStaff.size === 0) {
      setExpandedStaff(new Set([staffGroups[0][0]]));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffGroups.length]);

  const toggleStaff = (id: string) =>
    setExpandedStaff(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const highCount   = alerts.filter(a => a.severity === 'high').length;
  const repeatCount = alerts.filter(a => a.isRepeat).length;

  async function handleFine(notes: string) {
    if (!fineModal) return;
    setFineLoading(true);
    try {
      await fraudAPI.fine({
        staffId:    fineModal.staffId,
        fraudType:  fineModal.type,
        alertTitle: fineModal.title,
        notes,
      });
      setActionState(prev => ({ ...prev, [fineModal.id]: 'fined' }));
      setFineModal(null);
      fraudAPI.records().then(r => setRecords(r)).catch(() => {});
    } catch { /* ignore */ }
    setFineLoading(false);
  }

  async function handleDismiss(alert: FraudAlert) {
    try {
      await fraudAPI.dismiss({ staffId: alert.staffId, fraudType: alert.type, alertTitle: alert.title });
      setActionState(prev => ({ ...prev, [alert.id]: 'dismissed' }));
    } catch { /* ignore */ }
  }

  const liveCount   = alerts.filter(a => (actionState[a.id] || 'idle') === 'idle').length;
  const scannedTime = scannedAt ? new Date(scannedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div className="space-y-5 animate-fade-in">
      {fineModal && (
        <ConfirmModal
          staffName={fineModal.staffName}
          alertTitle={fineModal.title}
          onConfirm={handleFine}
          onCancel={() => setFineModal(null)}
          loading={fineLoading}
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-3">
            <ShieldOff size={20} className="text-red-400" />
            Anti-Fraud Monitor
          </h1>
          <p className="text-white/30 text-sm mt-1">
            Content-quality detection — timing is not a crime, hollow content is
            {scannedTime && <span className="ml-2 text-white/20">· Scanned {scannedTime}</span>}
          </p>
        </div>
        <button onClick={load} disabled={loading} className="btn-primary flex items-center gap-2 flex-shrink-0">
          {loading ? <><Loader2 size={14} className="animate-spin" /> Scanning…</> : <><RefreshCw size={14} /> Re-scan</>}
        </button>
      </div>

      {error && (
        <div className="card bg-red-500/5 border-red-500/20 text-red-400 text-sm flex items-center gap-2">
          <AlertTriangle size={14} className="flex-shrink-0" />{error}
        </div>
      )}

      {/* KPI strip */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          {[
            { label: 'Total alerts',     value: alerts.length,       color: 'text-white',                                  sub: 'across all staff' },
            { label: 'High severity',    value: highCount,           color: highCount > 0 ? 'text-red-400' : 'text-white/30', sub: 'need action now' },
            { label: 'Repeat offenders', value: repeatCount,         color: repeatCount > 0 ? 'text-red-400' : 'text-white/30', sub: 'fined before' },
            { label: 'Staff flagged',    value: staffGroups.length,  color: staffGroups.length > 0 ? 'text-amber-400' : 'text-white/30', sub: 'members' },
          ].map(({ label, value, color, sub }) => (
            <div key={label} className="card py-3 px-4 text-center">
              <p className={`text-2xl sm:text-3xl font-black ${color}`}>{value}</p>
              <p className="text-white/50 text-xs font-medium mt-0.5">{label}</p>
              <p className="text-white/20 text-[9px] mt-0.5">{sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <TabBar
        tabs={[
          { id: 'live',      label: 'Staff Alerts',   icon: AlertTriangle, count: liveCount      },
          { id: 'history',   label: 'Action History', icon: History,       count: records.length },
          { id: 'odd-names', label: 'Odd Names',      icon: TextSearch,    count: suspNames.length || undefined },
        ]}
        active={tab}
        onChange={id => {
          setTab(id as 'live' | 'history' | 'odd-names');
          if (id === 'odd-names' && suspNames.length === 0) {
            setSuspNamesLoading(true);
            fraudAPI.suspiciousNames()
              .then((r: { customers: SuspiciousCustomer[] }) => setSuspNames(r.customers || []))
              .catch(() => {})
              .finally(() => setSuspNamesLoading(false));
          }
        }}
        variant="pill-dark"
        className="w-fit"
      />

      <AnimatedTabPanel key={tab} className="space-y-3">

      {/* ── Live alerts tab ─────────────────────────────────────────────────── */}
      {tab === 'live' && (
        <>
          {loading && (
            <div className="space-y-3">
              {[1,2,3].map(i => <div key={i} className="card h-24 shimmer" />)}
            </div>
          )}

          {!loading && staffGroups.length === 0 && (
            <div className="card text-center py-16">
              <CheckCircle2 size={40} className="text-green-400/30 mx-auto mb-3" />
              <p className="text-white/40 font-semibold text-lg">All clear</p>
              <p className="text-white/20 text-sm mt-1">No suspicious patterns detected across any staff member</p>
            </div>
          )}

          {/* Collapsible legend */}
          {staffGroups.length > 0 && (
            <div className="rounded-xl border border-dark-50 overflow-hidden">
              <button
                onClick={() => setShowLegend(l => !l)}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-dark-400 hover:bg-dark-300 transition-colors"
              >
                <span className="text-white/40 text-xs font-medium uppercase tracking-wider">Detection patterns ({Object.keys(TYPE_META).length - 1})</span>
                <ChevronDown size={13} className={`text-white/30 transition-transform ${showLegend ? 'rotate-180' : ''}`} />
              </button>
              {showLegend && (
                <div className="px-4 py-3 bg-dark-300 flex flex-wrap gap-2 border-t border-dark-50">
                  {Object.entries(TYPE_META).filter(([k]) => k !== 'diary_spam').map(([key, { label, icon: Icon }]) => (
                    <span key={key} className="flex items-center gap-1.5 text-[10px] bg-dark-400 text-white/40 border border-dark-50 px-2.5 py-1 rounded-full">
                      <Icon size={9} className="text-white/30" />{label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Staff accordion ── */}
          {staffGroups.map(([staffId, group], idx) => {
            const isOffender  = group.alerts.some(a => a.isRepeat);
            const highAlerts  = group.alerts.filter(a => a.severity === 'high').length;
            const medAlerts   = group.alerts.filter(a => a.severity === 'medium').length;
            const lowAlerts   = group.alerts.filter(a => a.severity === 'low').length;
            const activeCount = group.alerts.filter(a => (actionState[a.id] || 'idle') === 'idle').length;
            const allDone     = activeCount === 0;
            const isOpen      = expandedStaff.has(staffId);

            return (
              <div
                key={staffId}
                className={`rounded-2xl border overflow-hidden transition-all ${
                  isOffender ? 'border-red-500/30' : allDone ? 'border-dark-50/40 opacity-60' : 'border-dark-50'
                }`}
              >
                {/* Severity strip at top of card */}
                <div className="h-1 w-full flex">
                  {highAlerts  > 0 && <div className="bg-red-500"   style={{ flex: highAlerts  }} />}
                  {medAlerts   > 0 && <div className="bg-amber-400" style={{ flex: medAlerts   }} />}
                  {lowAlerts   > 0 && <div className="bg-blue-400"  style={{ flex: lowAlerts   }} />}
                </div>

                {/* Staff accordion header — click to expand/collapse */}
                <button
                  onClick={() => toggleStaff(staffId)}
                  className="w-full flex items-center gap-4 px-4 py-3.5 bg-dark-400 hover:bg-dark-300 transition-colors text-left"
                >
                  {/* Avatar with initials */}
                  <StaffAvatar name={group.name} size={44} isOffender={isOffender} />

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-bold text-base">{group.name}</span>
                      {isOffender && (
                        <span className="text-[9px] bg-red-500/15 text-red-400 border border-red-500/25 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide animate-pulse">
                          Repeat
                        </span>
                      )}
                      {allDone && (
                        <span className="text-[9px] bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full font-medium">
                          resolved
                        </span>
                      )}
                    </div>

                    {/* Severity summary chips + bar */}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {highAlerts  > 0 && <span className="text-[10px] text-red-400    font-semibold">{highAlerts}  high</span>}
                      {medAlerts   > 0 && <span className="text-[10px] text-amber-400  font-semibold">{medAlerts}  medium</span>}
                      {lowAlerts   > 0 && <span className="text-[10px] text-blue-400   font-semibold">{lowAlerts}  low</span>}
                      <SeverityBar alerts={group.alerts} />
                    </div>
                  </div>

                  {/* Right: alert count + staff profile link + chevron */}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className={`text-xs font-bold tabular-nums px-2 py-1 rounded-lg ${
                      allDone ? 'bg-green-500/10 text-green-400' : 'bg-dark-300 text-white/50'
                    }`}>
                      {allDone ? '✓' : activeCount} {!allDone && `alert${activeCount !== 1 ? 's' : ''}`}
                    </span>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={e => { e.stopPropagation(); navigate(`/staff/${staffId}`); }}
                      onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); navigate(`/staff/${staffId}`); } }}
                      className="p-1.5 rounded-lg text-white/20 hover:text-gold hover:bg-gold/10 transition-colors"
                      title="View staff profile"
                    >
                      <Eye size={14} />
                    </div>
                    <ChevronDown
                      size={16}
                      className={`text-white/30 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                    />
                  </div>
                </button>

                {/* Alert list — shown when expanded */}
                {isOpen && (
                  <div className="bg-dark-300 border-t border-dark-50 px-4 py-3 space-y-2 animate-fade-in">
                    {/* Rank badge for worst offender */}
                    {idx === 0 && isOffender && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/8 border border-red-500/15 mb-3">
                        <AlertTriangle size={13} className="text-red-400 flex-shrink-0" />
                        <p className="text-red-400 text-xs font-medium">
                          Highest risk — repeat offender with {highAlerts > 0 ? `${highAlerts} high-severity` : 'multiple'} active alert{highAlerts !== 1 ? 's' : ''}
                        </p>
                      </div>
                    )}
                    {group.alerts.map(alert => (
                      <AlertCard
                        key={alert.id}
                        alert={alert}
                        onFine={a => setFineModal(a)}
                        onDismiss={handleDismiss}
                        actionState={actionState[alert.id] || 'idle'}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* ── History tab ─────────────────────────────────────────────────────── */}
      {tab === 'history' && (
        <>
          {records.length === 0 && (
            <div className="card text-center py-12">
              <History size={28} className="text-white/10 mx-auto mb-2" />
              <p className="text-white/30 text-sm">No actions taken yet</p>
            </div>
          )}

          {/* Group history by staff */}
          {(() => {
            const byStaffHistory: Record<string, { name: string; recs: FraudRecord[] }> = {};
            for (const r of records) {
              if (!byStaffHistory[r.staffId]) byStaffHistory[r.staffId] = { name: r.staffName || r.staffId, recs: [] };
              byStaffHistory[r.staffId].recs.push(r);
            }
            return Object.entries(byStaffHistory).map(([sid, g]) => {
              const fineCount = g.recs.filter(r => r.action === 'fine').length;
              const totalPts  = fineCount * -10;
              return (
                <div key={sid} className="rounded-2xl border border-dark-50 overflow-hidden">
                  {/* Staff header */}
                  <div className="flex items-center gap-3 px-4 py-3 bg-dark-400 border-b border-dark-50">
                    <StaffAvatar name={g.name} size={36} isOffender={fineCount > 1} />
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-semibold text-sm">{g.name}</p>
                      <p className="text-white/30 text-xs">{g.recs.length} action{g.recs.length !== 1 ? 's' : ''}</p>
                    </div>
                    {fineCount > 0 && (
                      <div className="text-right flex-shrink-0">
                        <p className="text-red-400 font-bold text-sm">{totalPts} pts</p>
                        <p className="text-white/25 text-[10px]">{fineCount} fine{fineCount !== 1 ? 's' : ''}</p>
                      </div>
                    )}
                  </div>

                  {/* Records */}
                  <div className="bg-dark-300 divide-y divide-dark-50/30">
                    {g.recs.map(r => (
                      <div key={r.id} className={`flex items-start gap-3 px-4 py-3 ${r.action === 'fine' ? 'bg-red-500/3' : ''}`}>
                        <div className={`p-1.5 rounded-lg flex-shrink-0 mt-0.5 ${r.action === 'fine' ? 'bg-red-500/10' : 'bg-dark-400'}`}>
                          {r.action === 'fine'
                            ? <Gavel size={12} className="text-red-400" />
                            : <EyeOff size={12} className="text-white/30" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {r.action === 'fine'
                              ? <span className="text-[10px] bg-red-500/15 text-red-400 px-1.5 py-0.5 rounded-full font-semibold">−10 pts fine</span>
                              : <span className="text-[10px] bg-dark-400 text-white/30 px-1.5 py-0.5 rounded-full">dismissed</span>
                            }
                            <span className="text-[10px] text-white/20 font-mono">{r.week}</span>
                          </div>
                          <p className="text-white/60 text-xs mt-0.5">{r.alertTitle}</p>
                          {r.notes && <p className="text-white/30 text-xs mt-0.5 italic">"{r.notes}"</p>}
                          <p className="text-white/20 text-[10px] mt-1">
                            {new Date(r.issuedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                        {r.action === 'fine' && (
                          <span className="text-red-400 font-black text-base flex-shrink-0">−10</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            });
          })()}
        </>
      )}

      {/* ── Odd Names tab ───────────────────────────────────────────────────── */}
      {tab === 'odd-names' && (
        <>
          {/* Header row */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white font-semibold text-sm">Suspicious Customer Names</p>
              <p className="text-white/30 text-xs mt-0.5">
                Names that look like products, pronouns, or placeholders — likely created by AI mistake
              </p>
            </div>
            <button
              onClick={() => {
                setSuspNamesLoading(true);
                fraudAPI.suspiciousNames()
                  .then((r: { customers: SuspiciousCustomer[] }) => setSuspNames(r.customers || []))
                  .catch(() => {})
                  .finally(() => setSuspNamesLoading(false));
              }}
              className="p-2 rounded-xl hover:bg-dark-200 text-white/30 hover:text-white transition-colors"
              title="Refresh"
            >
              <RefreshCw size={15} className={suspNamesLoading ? 'animate-spin' : ''} />
            </button>
          </div>

          {suspNamesLoading && (
            <div className="space-y-2">
              {[1,2,3].map(i => <div key={i} className="card h-16 shimmer" />)}
            </div>
          )}

          {!suspNamesLoading && suspNames.length === 0 && (
            <div className="card text-center py-14">
              <CheckCircle2 size={28} className="text-green-400/40 mx-auto mb-2" />
              <p className="text-white/40 text-sm font-medium">No suspicious names found</p>
              <p className="text-white/20 text-xs mt-1">All customer names look valid</p>
            </div>
          )}

          {!suspNamesLoading && suspNames.length > 0 && (
            <div className="rounded-2xl border border-dark-50 overflow-hidden">
              <div className="bg-dark-400 border-b border-dark-50 px-4 py-2.5 flex items-center gap-2">
                <TextSearch size={13} className="text-amber-400" />
                <span className="text-white/50 text-xs font-semibold uppercase tracking-wider">
                  {suspNames.length} flagged name{suspNames.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="bg-dark-300 divide-y divide-dark-50/30">
                {suspNames.map(c => {
                  const reasonColor =
                    c.reason.includes('pronoun') || c.reason.includes('interrogative')
                      ? 'bg-red-500/15 text-red-400 border-red-500/20'
                      : c.reason.includes('product') || c.reason.includes('Jewellery')
                      ? 'bg-orange-500/15 text-orange-400 border-orange-500/20'
                      : 'bg-amber-500/12 text-amber-400 border-amber-500/18';
                  return (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-dark-200/40 transition-colors">
                      {/* Avatar */}
                      <div className="w-8 h-8 rounded-xl bg-dark-200 border border-dark-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-white/40 text-xs font-bold">{c.name[0]?.toUpperCase() ?? '?'}</span>
                      </div>

                      {/* Name + meta */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-white text-sm font-semibold">{c.name}</p>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${reasonColor}`}>
                            {c.reason}
                          </span>
                        </div>
                        <p className="text-white/25 text-[11px] mt-0.5">
                          {c.staffName}
                          {c.phone ? ` · ${c.phone}` : ''}
                          {' · '}
                          {new Date(c.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => navigate(`/customers/${c.id}`)}
                          title="View profile"
                          className="p-1.5 rounded-lg text-white/25 hover:text-gold hover:bg-gold/10 transition-colors"
                        >
                          <ExternalLink size={13} />
                        </button>
                        <button
                          onClick={async () => {
                            await fraudAPI.deleteCustomer(c.id);
                            setSuspNames(prev => prev.filter(x => x.id !== c.id));
                          }}
                          title="Delete customer"
                          className="p-1.5 rounded-lg text-white/25 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      </AnimatedTabPanel>
    </div>
  );
}
