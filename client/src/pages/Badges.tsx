/**
 * Badges page
 *
 * Staff view   — earned badge collection + locked badges showing criteria
 * Admin view   — staff filter + badge collection + criteria editor panel
 *
 * Layout:
 *  [Admin only] Criteria Editor — tier-wise numeric thresholds, saveable
 *  Stats bar (total / bronze / silver / gold)
 *  Show-all toggle
 *  Badge grid — earned full-colour, unearned greyed with criteria shown
 */

import { useEffect, useState, useCallback } from 'react';
import { Award, Lock, ChevronDown, ChevronUp, Save, RefreshCw, Settings2, Info } from 'lucide-react';
import { badgesAPI, staffAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import {
  BADGE_META, CRITERIA_META,
  type Badge, type BadgeCriteria, type Staff,
} from '../types';

// ── Tier styling ──────────────────────────────────────────────────────────────
const TIER_CARD: Record<string, string> = {
  bronze: 'from-amber-700/20 to-amber-600/5 border-amber-600/30',
  silver: 'from-slate-400/20 to-slate-300/5 border-slate-400/30',
  gold:   'from-gold/20 to-gold/5 border-gold/30',
};
const TIER_LABEL: Record<string, string> = {
  bronze: 'text-amber-400',
  silver: 'text-slate-300',
  gold:   'text-gold',
};
const TIER_DOT: Record<string, string> = {
  bronze: 'bg-amber-500',
  silver: 'bg-slate-400',
  gold:   'bg-gold',
};
const TIER_BADGE_BG: Record<string, string> = {
  bronze: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  silver: 'bg-slate-400/10 text-slate-300 border-slate-400/30',
  gold:   'bg-gold/10 text-gold border-gold/30',
};

// ── Criteria for display on each badge card ───────────────────────────────────
// Returns a short human-readable string like "1 task" or "7 days streak"
function getCriteriaLabel(badgeKey: string, criteria: BadgeCriteria): string {
  const c = criteria;
  const m: Record<string, string> = {
    pehla_qadam:        `${c.tasks.bronze} task`,
    parishramik:        `${c.tasks.silver} tasks`,
    karya_ratna:        `${c.tasks.gold} tasks`,
    niyamit_karyakarta: `${c.streak.bronze} day streak`,
    satat_sevak:        `${c.streak.silver} day streak`,
    atulit_parishram:   `${c.streak.gold} day streak`,
    pehli_safalta:      `${c.deals.bronze} lead closed`,
    vyapar_nipun:       `${c.deals.silver} leads closed`,
    shresth_vikreta:    `${c.deals.gold} leads closed`,
    pratham_samman:     `${c.merits.bronze} merit pts`,
    vishisht_samman:    `${c.merits.silver} merit pts`,
    param_samman:       `${c.merits.gold} merit pts`,
    nav_sadasya:        `${c.tenure.bronze} days on team`,
    niyamit_sadasya:    `${c.tenure.silver} days on team`,
    varishth_sadasya:   `${c.tenure.gold} days on team`,
    uttam_pratikriya:   `${c.response.bronze.rate}%+ response (min ${c.response.bronze.minInteractions})`,
    sanchar_shresth:    `${c.response.gold.rate}%+ response (min ${c.response.gold.minInteractions})`,
    niyamit_sevak:      `${c.loopTasks.bronze} loop tasks`,
    dhara_karyakarta:   `${c.loopTasks.silver} loop tasks`,
  };
  return m[badgeKey] || '';
}

// ── Default criteria (mirrored from server) ───────────────────────────────────
const DEFAULT_CRITERIA: BadgeCriteria = {
  tasks:     { bronze: 1,   silver: 50,  gold: 100 },
  streak:    { bronze: 7,   silver: 30,  gold: 100 },
  deals:     { bronze: 1,   silver: 5,   gold: 20  },
  merits:    { bronze: 50,  silver: 200, gold: 500 },
  tenure:    { bronze: 30,  silver: 90,  gold: 365 },
  response:  { bronze: { rate: 90, minInteractions: 20 }, gold: { rate: 98, minInteractions: 30 } },
  loopTasks: { bronze: 5,   silver: 20 },
};

// ── Criteria editor (admin only) ──────────────────────────────────────────────
function CriteriaEditor() {
  const [criteria, setCriteria]  = useState<BadgeCriteria>(DEFAULT_CRITERIA);
  const [original, setOriginal]  = useState<BadgeCriteria>(DEFAULT_CRITERIA);
  const [loading,  setLoading]   = useState(true);
  const [saving,   setSaving]    = useState(false);
  const [saved,    setSaved]     = useState(false);
  const [error,    setError]     = useState('');
  const [open,     setOpen]      = useState(false);

  useEffect(() => {
    badgesAPI.getCriteria()
      .then(({ criteria: c }) => { setCriteria(c); setOriginal(c); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const update = (path: string[], val: number) => {
    setCriteria(prev => {
      const next = JSON.parse(JSON.stringify(prev)) as BadgeCriteria;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let obj: any = next;
      for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
      obj[path[path.length - 1]] = val;
      return next;
    });
    setSaved(false);
    setError('');
  };

  const save = async () => {
    setSaving(true); setError('');
    try {
      await badgesAPI.saveCriteria(criteria);
      setOriginal(criteria);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => { setCriteria(original); setError(''); };

  const isDirty = JSON.stringify(criteria) !== JSON.stringify(original);

  return (
    <div className="card border-gold/20 bg-dark-400">
      <button
        onClick={() => setOpen(p => !p)}
        className="w-full flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <Settings2 size={16} className="text-gold" />
          <span className="text-white font-semibold text-sm">Badge Criteria Editor</span>
          <span className="text-white/30 text-xs hidden sm:inline">— adjust thresholds tier-wise</span>
        </div>
        <div className="flex items-center gap-2">
          {isDirty && <span className="w-2 h-2 rounded-full bg-gold animate-pulse" />}
          {open ? <ChevronUp size={16} className="text-white/40" /> : <ChevronDown size={16} className="text-white/40" />}
        </div>
      </button>

      {open && (
        <div className="mt-5 space-y-5">
          {loading ? (
            <p className="text-white/30 text-sm">Loading criteria…</p>
          ) : (
            <>
              {/* ── Simple tier rows ─────────────────────────────────── */}
              {CRITERIA_META.map(row => (
                <div key={row.key} className="space-y-2">
                  <p className="text-white/60 text-xs font-semibold uppercase tracking-wider">{row.label}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {row.tiers.map(({ key: tier, badge }) => {
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      const val = (criteria[row.key as keyof BadgeCriteria] as any)[tier] as number;
                      const meta = BADGE_META[Object.keys(BADGE_META).find(k => BADGE_META[k].label === badge) || ''];
                      return (
                        <div key={tier} className={`flex items-center gap-3 p-3 rounded-xl border bg-gradient-to-b ${TIER_CARD[tier]}`}>
                          <span className="text-2xl flex-shrink-0">{meta?.icon || '🏅'}</span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs font-semibold capitalize ${TIER_LABEL[tier]}`}>{tier}</p>
                            <p className="text-white/50 text-[11px] truncate">{badge}</p>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <input
                              type="number"
                              min={0}
                              step={1}
                              value={val}
                              onChange={e => update([row.key, tier], Number(e.target.value))}
                              className="w-16 bg-dark-200 border border-dark-50 text-white text-sm font-bold text-right rounded-lg px-2 py-1 focus:outline-none focus:border-gold/50"
                            />
                            <span className="text-white/30 text-[10px]">{row.unit}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* ── Response rate (special — rate + min interactions) ── */}
              <div className="space-y-2">
                <p className="text-white/60 text-xs font-semibold uppercase tracking-wider">Response Rate</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(['bronze', 'gold'] as const).map(tier => {
                    const r = criteria.response[tier];
                    const badge = tier === 'bronze' ? 'Uttam Pratikriya' : 'Sanchar Shresth';
                    const meta  = Object.values(BADGE_META).find(m => m.label === badge);
                    return (
                      <div key={tier} className={`p-3 rounded-xl border bg-gradient-to-b ${TIER_CARD[tier]}`}>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-2xl">{meta?.icon || '📞'}</span>
                          <div>
                            <p className={`text-xs font-semibold capitalize ${TIER_LABEL[tier]}`}>{tier}</p>
                            <p className="text-white/50 text-[11px]">{badge}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <p className="text-white/30 text-[10px] mb-1">Min rate %</p>
                            <input
                              type="number" min={0} max={100} step={1}
                              value={r.rate}
                              onChange={e => update(['response', tier, 'rate'], Number(e.target.value))}
                              className="w-full bg-dark-200 border border-dark-50 text-white text-sm font-bold text-right rounded-lg px-2 py-1 focus:outline-none focus:border-gold/50"
                            />
                          </div>
                          <div>
                            <p className="text-white/30 text-[10px] mb-1">Min interactions</p>
                            <input
                              type="number" min={0} step={1}
                              value={r.minInteractions}
                              onChange={e => update(['response', tier, 'minInteractions'], Number(e.target.value))}
                              className="w-full bg-dark-200 border border-dark-50 text-white text-sm font-bold text-right rounded-lg px-2 py-1 focus:outline-none focus:border-gold/50"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── Note ─────────────────────────────────────────────── */}
              <div className="flex items-start gap-2 p-3 rounded-xl bg-dark-300 border border-dark-50/50">
                <Info size={13} className="text-white/30 flex-shrink-0 mt-0.5" />
                <p className="text-white/30 text-xs leading-relaxed">
                  Changes apply to future badge checks. Staff who already meet new thresholds will earn badges on their next qualifying action (task complete, diary submit, etc). Bronze ≤ Silver ≤ Gold ordering is enforced.
                </p>
              </div>

              {/* ── Actions ──────────────────────────────────────────── */}
              {error && <p className="text-red-400 text-xs">{error}</p>}
              <div className="flex items-center gap-2 justify-end">
                {isDirty && (
                  <button onClick={reset} className="flex items-center gap-1.5 px-3 py-1.5 text-white/40 hover:text-white text-xs font-medium transition-colors">
                    <RefreshCw size={12} /> Reset
                  </button>
                )}
                <button
                  onClick={save}
                  disabled={saving || !isDirty}
                  className={`flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-semibold transition-all
                    ${saved ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                      isDirty ? 'bg-gold text-dark-500 hover:bg-gold/90' :
                      'bg-dark-300 text-white/20 border border-dark-50 cursor-default'
                    }`}
                >
                  {saving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
                  {saved ? 'Saved!' : saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Badges page ──────────────────────────────────────────────────────────
export default function Badges() {
  const { isAdmin, user } = useAuth();

  const [earned,       setEarned]       = useState<Badge[]>([]);
  const [staffList,    setStaffList]    = useState<Staff[]>([]);
  const [selectedStaff,setSelectedStaff]= useState<string>('');
  const [criteria,     setCriteria]     = useState<BadgeCriteria>(DEFAULT_CRITERIA);
  const [loading,      setLoading]      = useState(true);
  const [tooltip,      setTooltip]      = useState<string | null>(null);
  const [showAll,      setShowAll]      = useState(false);

  // Load staff list for admin filter
  useEffect(() => {
    if (isAdmin) {
      staffAPI.list().then((s: Staff[]) => setStaffList(s.filter(x => x.active !== false))).catch(() => {});
    }
  }, [isAdmin]);

  // Load criteria (used to show threshold on every badge card)
  useEffect(() => {
    badgesAPI.getCriteria()
      .then(({ criteria: c }) => setCriteria(c))
      .catch(() => {});
  }, []);

  // Load earned badges
  const loadBadges = useCallback(() => {
    setLoading(true);
    const params = isAdmin && selectedStaff ? selectedStaff : undefined;
    badgesAPI.list(params)
      .then(setEarned)
      .catch(() => setEarned([]))
      .finally(() => setLoading(false));
  }, [isAdmin, selectedStaff]);

  useEffect(() => { loadBadges(); }, [loadBadges]);

  const earnedKeys = new Set(earned.map(b => b.badgeKey));
  const bronze = earned.filter(b => b.tier === 'bronze').length;
  const silver = earned.filter(b => b.tier === 'silver').length;
  const gold   = earned.filter(b => b.tier === 'gold').length;

  const ALL_KEYS = Object.keys(BADGE_META);
  const displayedKeys = showAll ? ALL_KEYS : ALL_KEYS.filter(k => earnedKeys.has(k));

  // Sort: earned first (most recent), then unearned (by tier: bronze→silver→gold)
  const TIER_ORDER: Record<string, number> = { bronze: 0, silver: 1, gold: 2 };
  const sortedKeys = [...displayedKeys].sort((a, b) => {
    const aE = earnedKeys.has(a), bE = earnedKeys.has(b);
    if (aE && !bE) return -1;
    if (!aE && bE) return 1;
    if (aE && bE) {
      const aDate = earned.find(e => e.badgeKey === a)?.earnedAt || '';
      const bDate = earned.find(e => e.badgeKey === b)?.earnedAt || '';
      return bDate.localeCompare(aDate);
    }
    return TIER_ORDER[BADGE_META[a]?.tier] - TIER_ORDER[BADGE_META[b]?.tier];
  });

  const displayName = isAdmin && selectedStaff
    ? staffList.find(s => s.id === selectedStaff)?.name || 'Staff'
    : (isAdmin ? 'All Staff' : user?.name || 'You');

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Award size={24} className="text-gold" />
            Badge Collection
          </h1>
          <p className="text-white/40 text-sm mt-1">
            {isAdmin ? `Viewing badges for ${displayName}` : 'Aapki uplabdhiyan — aapke saphal karyakramon ka praman'}
          </p>
        </div>
        {isAdmin && (
          <select
            value={selectedStaff}
            onChange={e => setSelectedStaff(e.target.value)}
            className="bg-dark-300 border border-dark-50 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-gold/50 min-w-[180px]"
          >
            <option value="">All Staff</option>
            {staffList.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* ── Admin criteria editor ─────────────────────────────────────── */}
      {isAdmin && <CriteriaEditor />}

      {/* ── Stats bar ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Kul Badges', value: earned.length, colour: 'text-white' },
          { label: '🥉 Kaansy', value: bronze, colour: 'text-amber-400' },
          { label: '🥈 Rajat',  value: silver, colour: 'text-slate-300' },
          { label: '🥇 Swarn',  value: gold,   colour: 'text-gold' },
        ].map(stat => (
          <div key={stat.label} className="bg-dark-400 border border-dark-50 rounded-2xl p-4 text-center">
            <p className={`text-2xl font-bold ${stat.colour}`}>{stat.value}</p>
            <p className="text-white/40 text-xs mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* ── Show-all toggle ─────────────────────────────────────────────── */}
      <button
        onClick={() => setShowAll(p => !p)}
        className="flex items-center gap-1.5 text-white/40 hover:text-white/70 text-sm transition-colors"
      >
        {showAll ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {showAll ? 'Sirf haasil kiye hue dikhayein' : 'Sabhi badges dikhayein (locked bhi)'}
      </button>

      {/* ── Badge grid ─────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-white/30 text-sm">
          Loading badges…
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {sortedKeys.map(key => {
            const meta    = BADGE_META[key];
            if (!meta) return null;
            const badge   = earned.find(e => e.badgeKey === key);
            const isEarned = !!badge;
            const isOpen  = tooltip === key;
            const criteriaLabel = getCriteriaLabel(key, criteria);

            return (
              <button
                key={key}
                onClick={() => setTooltip(isOpen ? null : key)}
                className={`relative flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all text-center group
                  ${isEarned
                    ? `bg-gradient-to-b ${TIER_CARD[meta.tier]} hover:scale-[1.03] active:scale-[0.97] shadow-lg`
                    : 'bg-dark-400 border-dark-50/30 opacity-45 hover:opacity-65'
                  }`}
              >
                {/* Lock icon */}
                {!isEarned && (
                  <Lock size={10} className="absolute top-2 right-2 text-white/40" />
                )}

                {/* Emoji icon */}
                <span className={`text-3xl leading-none ${!isEarned ? 'grayscale' : ''}`} role="img" aria-label={meta.label}>
                  {meta.icon}
                </span>

                {/* Badge name */}
                <p className={`text-xs font-semibold leading-tight ${isEarned ? 'text-white' : 'text-white/50'}`}>
                  {meta.label}
                </p>

                {/* Tier */}
                <div className="flex items-center gap-1">
                  <div className={`w-1.5 h-1.5 rounded-full ${isEarned ? TIER_DOT[meta.tier] : 'bg-white/20'}`} />
                  <span className={`text-[10px] capitalize ${isEarned ? TIER_LABEL[meta.tier] : 'text-white/30'}`}>
                    {meta.tier === 'bronze' ? 'Kaansy' : meta.tier === 'silver' ? 'Rajat' : 'Swarn'}
                  </span>
                </div>

                {/* Criteria threshold pill */}
                {criteriaLabel && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-medium leading-none
                    ${isEarned ? TIER_BADGE_BG[meta.tier] : 'border-white/10 text-white/20 bg-transparent'}`}>
                    {criteriaLabel}
                  </span>
                )}

                {/* Tooltip card */}
                {isOpen && (
                  <div
                    className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-dark-200 border border-dark-50 rounded-xl shadow-2xl p-3 z-20 text-left pointer-events-none"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xl">{meta.icon}</span>
                      <p className="text-white font-semibold text-xs">{meta.label}</p>
                    </div>
                    <p className="text-white/50 text-[11px] leading-relaxed mb-2">{meta.description}</p>
                    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${TIER_BADGE_BG[meta.tier]}`}>
                      {criteriaLabel}
                    </div>
                    {isEarned && badge && (
                      <p className="text-gold text-[10px] mt-2">
                        ✓ Prapt: {new Date(badge.earnedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    )}
                    {!isEarned && (
                      <p className="text-white/25 text-[10px] mt-2">Abhi tak prapt nahi hua</p>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────────── */}
      {!loading && earned.length === 0 && !showAll && (
        <div className="text-center py-12">
          <Award size={40} className="text-white/10 mx-auto mb-3" />
          <p className="text-white/30 text-sm">Abhi tak koi badge prapt nahi hua.</p>
          <p className="text-white/20 text-xs mt-1">Tasks complete karein, diary likhein, aur leads close karein.</p>
          <button
            onClick={() => setShowAll(true)}
            className="mt-4 text-gold/60 hover:text-gold text-xs underline underline-offset-2 transition-colors"
          >
            Sabhi uplabdh badges dekhein
          </button>
        </div>
      )}
    </div>
  );
}
