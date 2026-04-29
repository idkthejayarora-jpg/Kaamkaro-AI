import { useEffect, useState } from 'react';
import {
  TrendingUp, Lightbulb, MessageSquare, AlertTriangle,
  RefreshCw, Loader2, BarChart2, Users, Package, Sparkles,
} from 'lucide-react';
import { aiAPI } from '../lib/api';

// ── Types ──────────────────────────────────────────────────────────────────────
interface Trend {
  item: string;
  count: number;
  customers: string[];
  insight?: string;
}
interface Segment {
  segment: string;
  preferredProducts: string[];
  tip: string;
}
interface OutreachTip {
  leadName: string;
  product: string;
  reason: string;
  message: string;
}
interface RestockAlert {
  item: string;
  urgency: 'high' | 'medium';
  reason: string;
}
interface InsightsData {
  trends:        Trend[];
  segments:      Segment[];
  outreachTips:  OutreachTip[];
  restockAlerts: RestockAlert[];
  summary:       string;
  generatedAt:   string;
  rawMode?:      boolean;
}

// ── Section wrapper ────────────────────────────────────────────────────────────
function Section({ icon, title, color, children }: {
  icon: React.ReactNode; title: string; color: string; children: React.ReactNode;
}) {
  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <div className={`p-1.5 rounded-lg ${color}`}>{icon}</div>
        <h2 className="text-white font-semibold text-sm">{title}</h2>
      </div>
      {children}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function SalesInsights() {
  const [data,    setData]    = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await aiAPI.salesInsights();
      setData(result);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error || (err as { message?: string })?.message || 'Unknown error';
      setError(`Failed to generate insights: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const genTime = data?.generatedAt
    ? new Date(data.generatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Sparkles size={22} className="text-gold" />
            Sales Insights
          </h1>
          <p className="text-white/30 text-sm mt-1">
            AI scan of diary entries + CRM lead notes
            {genTime && <span className="ml-2 text-white/20">· Generated at {genTime}</span>}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="btn-primary flex items-center gap-2 flex-shrink-0"
        >
          {loading
            ? <><Loader2 size={14} className="animate-spin" /> Analysing…</>
            : <><RefreshCw size={14} /> Refresh</>
          }
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="card bg-red-500/5 border-red-500/20 text-red-400 text-sm flex items-center gap-2">
          <AlertTriangle size={14} className="flex-shrink-0" />{error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="space-y-3">
          {[1,2,3,4].map(i => <div key={i} className="card h-28 shimmer" />)}
          <p className="text-center text-white/20 text-sm">Reading diary entries and lead notes…</p>
        </div>
      )}

      {data && (
        <>
          {/* Summary banner */}
          {data.summary && (
            <div className="card bg-gold/5 border-gold/15">
              <div className="flex items-start gap-3">
                <Sparkles size={16} className="text-gold mt-0.5 flex-shrink-0" />
                <p className="text-white/70 text-sm leading-relaxed">{data.summary}</p>
              </div>
            </div>
          )}

          {/* Product trends */}
          {data.trends?.length > 0 && (
            <Section icon={<TrendingUp size={14} className="text-blue-400" />} title="Top Product Trends" color="bg-blue-500/10">
              <div className="space-y-2">
                {data.trends.map((t, i) => (
                  <div key={i} className="flex items-start gap-3 py-2 border-b border-dark-50 last:border-0">
                    <div className="w-6 h-6 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-blue-400 text-[10px] font-bold">#{i + 1}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white text-sm font-semibold capitalize">{t.item}</span>
                        {t.count > 0 && (
                          <span className="text-[10px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded-full">
                            {t.count} mention{t.count !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      {t.insight && <p className="text-white/40 text-xs mt-0.5">{t.insight}</p>}
                      {t.customers?.length > 0 && (
                        <p className="text-white/25 text-[10px] mt-1">
                          Linked to: {t.customers.join(', ')}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Customer segments */}
          {data.segments?.length > 0 && (
            <Section icon={<Users size={14} className="text-purple-400" />} title="Customer Segments" color="bg-purple-500/10">
              <div className="space-y-3">
                {data.segments.map((s, i) => (
                  <div key={i} className="bg-dark-300 rounded-xl p-3 space-y-1.5">
                    <p className="text-white text-sm font-semibold">{s.segment}</p>
                    <div className="flex flex-wrap gap-1">
                      {s.preferredProducts.map((p, j) => (
                        <span key={j} className="text-[10px] bg-purple-500/10 text-purple-300 px-2 py-0.5 rounded-full capitalize">{p}</span>
                      ))}
                    </div>
                    <p className="text-white/50 text-xs">{s.tip}</p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Outreach tips */}
          {data.outreachTips?.length > 0 && (
            <Section icon={<MessageSquare size={14} className="text-green-400" />} title="Outreach Tips — Who to Contact & What to Say" color="bg-green-500/10">
              <div className="space-y-3">
                {data.outreachTips.map((tip, i) => (
                  <div key={i} className="bg-dark-300 rounded-xl p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-white text-sm font-semibold">{tip.leadName}</p>
                        <p className="text-gold text-xs">→ Pitch: <span className="capitalize">{tip.product}</span></p>
                      </div>
                      <span className="text-[10px] bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5">Tip</span>
                    </div>
                    <p className="text-white/40 text-xs">{tip.reason}</p>
                    {tip.message && (
                      <div className="bg-dark-400 rounded-lg px-3 py-2 border border-dark-50">
                        <p className="text-[10px] text-white/20 mb-1 uppercase tracking-wide">Suggested message</p>
                        <p className="text-white/60 text-xs leading-relaxed italic">"{tip.message}"</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Restock alerts */}
          {data.restockAlerts?.length > 0 && (
            <Section icon={<Package size={14} className="text-amber-400" />} title="Restock Alerts" color="bg-amber-500/10">
              <div className="space-y-2">
                {data.restockAlerts.map((a, i) => (
                  <div key={i} className={`flex items-start gap-3 p-3 rounded-xl border ${
                    a.urgency === 'high'
                      ? 'bg-red-500/5 border-red-500/20'
                      : 'bg-amber-500/5 border-amber-500/20'
                  }`}>
                    <AlertTriangle size={14} className={a.urgency === 'high' ? 'text-red-400 mt-0.5' : 'text-amber-400 mt-0.5'} />
                    <div>
                      <p className="text-white text-sm font-semibold capitalize">{a.item}
                        <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full ${
                          a.urgency === 'high' ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'
                        }`}>{a.urgency}</span>
                      </p>
                      <p className="text-white/40 text-xs mt-0.5">{a.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* No data state */}
          {!data.trends?.length && !data.outreachTips?.length && (
            <div className="card text-center py-14">
              <BarChart2 size={36} className="text-white/10 mx-auto mb-3" />
              <p className="text-white/40 font-medium">Not enough data yet</p>
              <p className="text-white/20 text-sm mt-1">Add diary entries and CRM lead notes to get insights</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
