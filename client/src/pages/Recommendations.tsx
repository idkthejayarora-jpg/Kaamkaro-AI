import { useEffect, useState } from 'react';
import { Sparkles, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, RefreshCw, BarChart3 } from 'lucide-react';
import { aiAPI } from '../lib/api';
import type { Recommendation } from '../types';

function PriorityBadge({ priority }: { priority: Recommendation['priority'] }) {
  const styles = {
    high:   'bg-red-500/15 text-red-400 border border-red-500/20',
    medium: 'bg-gold/15 text-gold border border-gold/20',
    low:    'bg-green-500/15 text-green-400 border border-green-500/20',
  };
  const icons = { high: AlertTriangle, medium: TrendingUp, low: CheckCircle };
  const Icon = icons[priority];
  return (
    <span className={`badge ${styles[priority]} flex items-center gap-1`}>
      <Icon size={10} /> {priority} priority
    </span>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = score >= 70 ? '#4ade80' : score >= 40 ? '#D4AF37' : '#f87171';
  return (
    <div className="relative w-20 h-20 flex-shrink-0">
      <svg width="80" height="80" className="-rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#2A2A2A" strokeWidth="4" />
        <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-white font-bold text-lg">{score}</span>
      </div>
    </div>
  );
}

export default function Recommendations() {
  const [recs, setRecs]               = useState<Recommendation[]>([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [activeTab, setActiveTab]     = useState<'recs' | 'report'>('recs');
  const [report, setReport]           = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  const load = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const data = await aiAPI.recommendations();
      setRecs(data.recommendations || []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadReport = async () => {
    if (report) return; // already loaded
    setReportLoading(true);
    try {
      const data = await aiAPI.weeklyReport();
      setReport(data.report);
    } finally { setReportLoading(false); }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { if (activeTab === 'report') loadReport(); }, [activeTab]);

  if (loading) return (
    <div className="space-y-4">
      <div className="h-8 w-48 shimmer rounded-xl" />
      {Array(3).fill(0).map((_, i) => <div key={i} className="card h-40 shimmer" />)}
    </div>
  );

  const sorted = [...recs].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.priority] - order[b.priority];
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={18} className="text-gold" />
            <h1 className="text-2xl font-bold text-white">AI Insights</h1>
          </div>
          <p className="text-white/40 text-sm">Kamal AI analysis of your team's performance with actionable recommendations.</p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="btn-secondary flex items-center gap-2 flex-shrink-0"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {/* Tab toggle */}
      <div className="flex gap-1 bg-dark-400 border border-dark-50 rounded-xl p-1 w-fit">
        {([['recs', 'Recommendations', Sparkles], ['report', 'Weekly Report', BarChart3]] as const).map(([tab, label, Icon]) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === tab ? 'bg-gold text-dark-500' : 'text-white/40 hover:text-white'}`}>
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      {/* Weekly Report Tab */}
      {activeTab === 'report' && (
        <div className="card">
          {reportLoading ? (
            <div className="flex items-center gap-3 py-4">
              <div className="w-5 h-5 border-2 border-gold border-t-transparent rounded-full animate-spin" />
              <p className="text-white/40 text-sm">Kamal is generating your weekly report…</p>
            </div>
          ) : report ? (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 size={16} className="text-gold" />
                <p className="text-white font-semibold">Weekly Performance Report</p>
                <button onClick={() => { setReport(null); loadReport(); }} className="ml-auto text-white/30 hover:text-white">
                  <RefreshCw size={14} />
                </button>
              </div>
              <div className="bg-dark-200 rounded-xl p-4 border border-dark-50">
                <p className="text-white/70 text-sm leading-relaxed whitespace-pre-line">{report}</p>
              </div>
            </div>
          ) : (
            <p className="text-white/30 text-sm">No report available</p>
          )}
        </div>
      )}

      {activeTab !== 'report' && <>
      {/* Summary pills */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'High Priority',   value: recs.filter(r => r.priority === 'high').length,   color: 'text-red-400',   bg: 'bg-red-500/10' },
          { label: 'Needs Attention', value: recs.filter(r => r.priority === 'medium').length, color: 'text-gold',      bg: 'bg-gold/10' },
          { label: 'Performing Well', value: recs.filter(r => r.priority === 'low').length,    color: 'text-green-400', bg: 'bg-green-500/10' },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className={`${bg} rounded-xl p-4 text-center border border-dark-50`}>
            <p className={`${color} text-2xl font-bold`}>{value}</p>
            <p className="text-white/40 text-xs mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Recommendation cards */}
      <div className="space-y-4">
        {sorted.map(rec => (
          <div key={rec.staffId} className={`card border ${
            rec.priority === 'high' ? 'border-red-500/20' :
            rec.priority === 'medium' ? 'border-gold/20' : 'border-dark-50'
          }`}>
            <div className="flex items-start gap-4">
              <ScoreRing score={rec.performanceScore} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap mb-1">
                  <h3 className="text-white font-bold">{rec.staffName}</h3>
                  <PriorityBadge priority={rec.priority} />
                </div>
                {rec.summary && <p className="text-white/50 text-sm mb-3">{rec.summary}</p>}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Strengths */}
                  {rec.strengths.length > 0 && (
                    <div>
                      <p className="text-green-400 text-[10px] font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1">
                        <CheckCircle size={10} /> Strengths
                      </p>
                      <ul className="space-y-1">
                        {rec.strengths.map((s, i) => (
                          <li key={i} className="text-white/60 text-xs flex items-start gap-1.5">
                            <span className="text-green-400 mt-0.5">•</span> {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Issues */}
                  {rec.issues.length > 0 && (
                    <div>
                      <p className="text-red-400 text-[10px] font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1">
                        <TrendingDown size={10} /> Issues
                      </p>
                      <ul className="space-y-1">
                        {rec.issues.map((s, i) => (
                          <li key={i} className="text-white/60 text-xs flex items-start gap-1.5">
                            <span className="text-red-400 mt-0.5">•</span> {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Actions */}
                  {rec.actions.length > 0 && (
                    <div>
                      <p className="text-gold text-[10px] font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1">
                        <Sparkles size={10} /> Action Items
                      </p>
                      <ul className="space-y-1">
                        {rec.actions.map((a, i) => (
                          <li key={i} className="text-white/60 text-xs flex items-start gap-1.5">
                            <span className="text-gold mt-0.5">{i + 1}.</span> {a}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {recs.length === 0 && (
        <div className="card text-center py-16">
          <Sparkles size={40} className="text-white/10 mx-auto mb-4" />
          <p className="text-white/40 font-medium">No recommendations yet</p>
          <p className="text-white/20 text-sm mt-1">Add staff and log performance data to get AI-powered insights</p>
        </div>
      )}
      </>}
    </div>
  );
}
