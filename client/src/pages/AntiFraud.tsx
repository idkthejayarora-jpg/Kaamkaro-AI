import { useEffect, useState, useCallback } from 'react';
import { TabBar, AnimatedTabPanel } from '../components/TabBar';
import {
  AlertTriangle, ShieldOff, RefreshCw, Loader2,
  ChevronDown, Zap, Clock, ToggleLeft, TrendingUp,
  Award, Copy, BookOpen, CheckCircle2, Gavel,
  Eye, EyeOff, History, User, type LucideIcon,
} from 'lucide-react';
import { fraudAPI } from '../lib/api';
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
interface FraudRecord {
  id: string; staffId: string; staffName?: string;
  fraudType: string; alertTitle: string; notes: string;
  action: 'fine' | 'dismiss'; points?: number;
  week: string; issuedAt: string;
}

// ── Config ─────────────────────────────────────────────────────────────────────
const TYPE_META: Record<string, { label: string; icon: LucideIcon }> = {
  task_speed:             { label: 'Speed Farming',     icon: Zap         },
  task_burst:             { label: 'Task Burst',        icon: Clock       },
  task_toggle:            { label: 'Toggle Abuse',      icon: ToggleLeft  },
  merit_haul:             { label: 'Merit Haul',        icon: TrendingUp  },
  merit_repeat:           { label: 'Manual Repeat',     icon: Award       },
  merit_duplicate_reason: { label: 'Repeat Reason',     icon: Copy        },
  loop_abuse:             { label: 'Loop Abuse',        icon: RefreshCw   },
  diary_spam:             { label: 'Diary Spam',        icon: BookOpen    },
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
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm">
      <div className="card w-full max-w-sm space-y-4 shadow-2xl">
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

// ── Main page ──────────────────────────────────────────────────────────────────
export default function AntiFraud() {
  const navigate = useNavigate();
  const [alerts,    setAlerts]    = useState<FraudAlert[]>([]);
  const [records,   setRecords]   = useState<FraudRecord[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [scannedAt, setScannedAt] = useState('');
  const [tab,       setTab]       = useState<'live' | 'history'>('live');
  const [fineModal, setFineModal] = useState<FraudAlert | null>(null);
  const [fineLoading, setFineLoading] = useState(false);
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

  // Group alerts by staff
  const byStaff: Record<string, { name: string; alerts: FraudAlert[] }> = {};
  for (const a of alerts) {
    if (!byStaff[a.staffId]) byStaff[a.staffId] = { name: a.staffName, alerts: [] };
    byStaff[a.staffId].alerts.push(a);
  }
  const staffGroups = Object.entries(byStaff).sort((a, b) => {
    const aHasRepeat = a[1].alerts.some(x => x.isRepeat);
    const bHasRepeat = b[1].alerts.some(x => x.isRepeat);
    if (aHasRepeat !== bHasRepeat) return bHasRepeat ? 1 : -1;
    const aHigh = a[1].alerts.filter(x => x.severity === 'high').length;
    const bHigh = b[1].alerts.filter(x => x.severity === 'high').length;
    return bHigh - aHigh;
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
      // Reload records silently
      fraudAPI.records().then(r => setRecords(r)).catch(() => {});
    } catch { /* ignore */ }
    setFineLoading(false);
  }

  async function handleDismiss(alert: FraudAlert) {
    try {
      await fraudAPI.dismiss({
        staffId:    alert.staffId,
        fraudType:  alert.type,
        alertTitle: alert.title,
      });
      setActionState(prev => ({ ...prev, [alert.id]: 'dismissed' }));
    } catch { /* ignore */ }
  }

  const liveCount    = alerts.filter(a => (actionState[a.id] || 'idle') === 'idle').length;
  const scannedTime  = scannedAt ? new Date(scannedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Fine confirm modal */}
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
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <ShieldOff size={22} className="text-red-400" />
            Anti-Fraud Monitor
          </h1>
          <p className="text-white/30 text-sm mt-1">
            Scans tasks, merits & diary for farming patterns
            {scannedTime && <span className="ml-2 text-white/20">· Last scan {scannedTime}</span>}
          </p>
        </div>
        <button onClick={load} disabled={loading} className="btn-primary flex items-center gap-2 flex-shrink-0">
          {loading ? <><Loader2 size={14} className="animate-spin" /> Scanning…</> : <><RefreshCw size={14} /> Re-scan</>}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="card bg-red-500/5 border-red-500/20 text-red-400 text-sm flex items-center gap-2">
          <AlertTriangle size={14} className="flex-shrink-0" />{error}
        </div>
      )}

      {/* KPI strip */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total alerts',    value: alerts.length,  color: 'text-white' },
            { label: 'High severity',   value: highCount,      color: 'text-red-400' },
            { label: 'Repeat offenders',value: repeatCount,    color: repeatCount > 0 ? 'text-red-400' : 'text-white/30' },
            { label: 'Staff flagged',   value: staffGroups.length, color: 'text-amber-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="card py-3 px-4 text-center">
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
              <p className="text-white/40 text-xs mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <TabBar
        tabs={[
          { id: 'live',    label: 'Live Alerts',    icon: AlertTriangle, count: liveCount      },
          { id: 'history', label: 'Action History', icon: History,       count: records.length },
        ]}
        active={tab}
        onChange={id => setTab(id as 'live' | 'history')}
        variant="pill-dark"
        className="w-fit"
      />

      <AnimatedTabPanel key={tab} className="space-y-4">

      {/* ── Live alerts tab ─────────────────────────────────────────────────── */}
      {tab === 'live' && (
        <>
          {loading && (
            <div className="space-y-3">
              {[1,2,3].map(i => <div key={i} className="card h-20 shimmer" />)}
            </div>
          )}

          {!loading && staffGroups.length === 0 && (
            <div className="card text-center py-16">
              <CheckCircle2 size={36} className="text-green-400/30 mx-auto mb-3" />
              <p className="text-white/40 font-medium">No fraud patterns detected</p>
              <p className="text-white/20 text-sm mt-1">All staff activity looks normal</p>
            </div>
          )}

          {/* Pattern legend */}
          {staffGroups.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(TYPE_META).map(([key, { label, icon: Icon }]) => (
                <span key={key} className="flex items-center gap-1 text-[10px] bg-dark-300 text-white/30 px-2 py-1 rounded-full">
                  <Icon size={9} />{label}
                </span>
              ))}
            </div>
          )}

          {/* Staff groups */}
          {staffGroups.map(([staffId, group]) => {
            const repeatAlerts = group.alerts.filter(a => a.isRepeat);
            const isOffender   = repeatAlerts.length > 0;
            const activeCount  = group.alerts.filter(a => (actionState[a.id] || 'idle') === 'idle').length;
            return (
              <div key={staffId} className={`card space-y-3 ${isOffender ? 'border-red-500/25' : ''}`}>
                {/* Staff header */}
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${isOffender ? 'bg-red-500/15' : 'bg-dark-300'}`}>
                    <User size={16} className={isOffender ? 'text-red-400' : 'text-white/30'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-white font-semibold">{group.name}</p>
                      {isOffender && (
                        <span className="text-[10px] bg-red-500/15 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full font-semibold">
                          REPEAT OFFENDER
                        </span>
                      )}
                      <span className="text-[10px] bg-dark-300 text-white/30 px-1.5 py-0.5 rounded-full">
                        {activeCount} active alert{activeCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {/* Severity summary */}
                    <div className="flex gap-2 mt-0.5">
                      {(['high', 'medium', 'low'] as const).map(sev => {
                        const n = group.alerts.filter(a => a.severity === sev).length;
                        return n > 0 ? (
                          <span key={sev} className={`text-[10px] ${sev === 'high' ? 'text-red-400' : sev === 'medium' ? 'text-amber-400' : 'text-blue-400'}`}>
                            {n} {sev}
                          </span>
                        ) : null;
                      })}
                    </div>
                  </div>
                  <button
                    onClick={() => navigate(`/staff/${staffId}`)}
                    className="btn-ghost text-xs text-white/30 flex-shrink-0"
                  >
                    <Eye size={12} />
                  </button>
                </div>

                {/* Alerts */}
                <div className="space-y-2">
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
              </div>
            );
          })}
        </>
      )}

      {/* ── History tab ─────────────────────────────────────────────────────── */}
      {tab === 'history' && (
        <div className="card space-y-3">
          {records.length === 0 && (
            <div className="text-center py-10">
              <History size={28} className="text-white/10 mx-auto mb-2" />
              <p className="text-white/30 text-sm">No actions taken yet</p>
            </div>
          )}
          {records.map(r => (
            <div key={r.id} className={`flex items-start gap-3 p-3 rounded-xl border ${r.action === 'fine' ? 'bg-red-500/5 border-red-500/15' : 'bg-dark-300 border-dark-50'}`}>
              <div className={`p-1.5 rounded-lg flex-shrink-0 ${r.action === 'fine' ? 'bg-red-500/10' : 'bg-dark-400'}`}>
                {r.action === 'fine' ? <Gavel size={13} className="text-red-400" /> : <EyeOff size={13} className="text-white/30" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white text-sm font-medium">{r.staffName || r.staffId}</span>
                  {r.action === 'fine'
                    ? <span className="text-[10px] bg-red-500/15 text-red-400 px-1.5 py-0.5 rounded-full">−10 pts fine</span>
                    : <span className="text-[10px] bg-dark-400 text-white/30 px-1.5 py-0.5 rounded-full">dismissed</span>
                  }
                  <span className="text-[10px] text-white/20">{r.week}</span>
                </div>
                <p className="text-white/40 text-xs mt-0.5">{r.alertTitle}</p>
                {r.notes && <p className="text-white/25 text-xs mt-0.5 italic">"{r.notes}"</p>}
                <p className="text-white/20 text-[10px] mt-1">
                  {new Date(r.issuedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              {r.action === 'fine' && (
                <span className="text-red-400 text-sm font-bold flex-shrink-0">−10</span>
              )}
            </div>
          ))}
        </div>
      )}

      </AnimatedTabPanel>
    </div>
  );
}
