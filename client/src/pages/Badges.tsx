/**
 * Badges page — staff see their own collection; admins see all staff with filters.
 *
 * Layout:
 *  - Header with total earned / tier breakdown
 *  - Staff filter (admin only)
 *  - Badge grid: earned badges full-colour, unearned badges greyed + locked
 *  - Clicking any badge shows description + earned date
 */

import { useEffect, useState } from 'react';
import { Award, Lock, ChevronDown, ChevronUp } from 'lucide-react';
import { badgesAPI, staffAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { BADGE_META, type Badge, type Staff } from '../types';

const TIER_ORDER: Record<string, number> = { bronze: 0, silver: 1, gold: 2 };
const TIER_COLOUR: Record<string, string> = {
  bronze: 'from-amber-700/20 to-amber-600/10 border-amber-600/30 text-amber-400',
  silver: 'from-slate-400/20 to-slate-300/10 border-slate-400/30 text-slate-300',
  gold:   'from-gold/20 to-gold/10 border-gold/30 text-gold',
};
const TIER_LABEL_COLOUR: Record<string, string> = {
  bronze: 'text-amber-400',
  silver: 'text-slate-300',
  gold:   'text-gold',
};
const TIER_DOT: Record<string, string> = {
  bronze: 'bg-amber-500',
  silver: 'bg-slate-400',
  gold:   'bg-gold',
};

const ALL_BADGE_KEYS = Object.keys(BADGE_META);

export default function Badges() {
  const { isAdmin, user } = useAuth();

  const [earned, setEarned]       = useState<Badge[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<string>('');
  const [loading, setLoading]     = useState(true);
  const [tooltip, setTooltip]     = useState<string | null>(null); // badgeKey
  const [showAll, setShowAll]     = useState(false); // show unearned too

  // Load staff list for admin filter
  useEffect(() => {
    if (isAdmin) {
      staffAPI.list().then((s: Staff[]) => setStaffList(s.filter(x => x.active !== false))).catch(() => {});
    }
  }, [isAdmin]);

  // Load badges
  useEffect(() => {
    setLoading(true);
    const params = isAdmin && selectedStaff ? selectedStaff : undefined;
    badgesAPI.list(params)
      .then(setEarned)
      .catch(() => setEarned([]))
      .finally(() => setLoading(false));
  }, [isAdmin, selectedStaff]);

  const earnedKeys = new Set(earned.map(b => b.badgeKey));

  // Group earned by tier for header stats
  const bronze = earned.filter(b => b.tier === 'bronze').length;
  const silver = earned.filter(b => b.tier === 'silver').length;
  const gold   = earned.filter(b => b.tier === 'gold').length;

  // Sort: earned first (by earnedAt desc), then unearned alphabetically
  const displayedBadges = showAll ? ALL_BADGE_KEYS : ALL_BADGE_KEYS.filter(k => earnedKeys.has(k));
  const sortedKeys = [...displayedBadges].sort((a, b) => {
    const aEarned = earnedKeys.has(a);
    const bEarned = earnedKeys.has(b);
    if (aEarned && !bEarned) return -1;
    if (!aEarned && bEarned) return 1;
    if (aEarned && bEarned) {
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
            {isAdmin ? `Viewing badges for ${displayName}` : 'Your earned achievements'}
          </p>
        </div>

        {/* Admin staff selector */}
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

      {/* ── Stats bar ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Earned', value: earned.length, colour: 'text-white' },
          { label: '🥉 Bronze', value: bronze, colour: 'text-amber-400' },
          { label: '🥈 Silver', value: silver, colour: 'text-slate-300' },
          { label: '🥇 Gold',   value: gold,   colour: 'text-gold' },
        ].map(stat => (
          <div key={stat.label} className="bg-dark-400 border border-dark-50 rounded-2xl p-4 text-center">
            <p className={`text-2xl font-bold ${stat.colour}`}>{stat.value}</p>
            <p className="text-white/40 text-xs mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* ── Show all toggle ─────────────────────────────────────────────── */}
      <button
        onClick={() => setShowAll(p => !p)}
        className="flex items-center gap-1.5 text-white/40 hover:text-white/70 text-sm transition-colors"
      >
        {showAll ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {showAll ? 'Hide unearned badges' : 'Show all badges (including locked)'}
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

            return (
              <button
                key={key}
                onClick={() => setTooltip(isOpen ? null : key)}
                className={`relative flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all text-center
                  ${isEarned
                    ? `bg-gradient-to-b ${TIER_COLOUR[meta.tier]} hover:scale-[1.03] active:scale-[0.97]`
                    : 'bg-dark-400 border-dark-50/30 opacity-40 hover:opacity-60'
                  }`}
              >
                {/* Lock overlay for unearned */}
                {!isEarned && (
                  <Lock size={10} className="absolute top-2 right-2 text-white/40" />
                )}

                {/* Icon */}
                <span className={`text-3xl ${!isEarned ? 'grayscale' : ''}`} role="img" aria-label={meta.label}>
                  {meta.icon}
                </span>

                {/* Label */}
                <p className={`text-xs font-semibold leading-tight ${isEarned ? 'text-white' : 'text-white/50'}`}>
                  {meta.label}
                </p>

                {/* Tier dot */}
                <div className="flex items-center gap-1">
                  <div className={`w-1.5 h-1.5 rounded-full ${isEarned ? TIER_DOT[meta.tier] : 'bg-white/20'}`} />
                  <span className={`text-[10px] capitalize ${isEarned ? TIER_LABEL_COLOUR[meta.tier] : 'text-white/30'}`}>
                    {meta.tier}
                  </span>
                </div>

                {/* Tooltip card */}
                {isOpen && (
                  <div
                    className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-dark-200 border border-dark-50 rounded-xl shadow-2xl p-3 z-10 text-left pointer-events-none"
                    onClick={e => e.stopPropagation()}
                  >
                    <p className="text-white font-semibold text-xs mb-1">{meta.label}</p>
                    <p className="text-white/50 text-[11px] leading-relaxed mb-1">{meta.description}</p>
                    {isEarned && badge && (
                      <p className="text-gold text-[10px]">
                        Earned {new Date(badge.earnedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    )}
                    {!isEarned && (
                      <p className="text-white/30 text-[10px]">Not yet earned</p>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {!loading && earned.length === 0 && !showAll && (
        <div className="text-center py-12">
          <Award size={40} className="text-white/10 mx-auto mb-3" />
          <p className="text-white/30 text-sm">No badges earned yet.</p>
          <p className="text-white/20 text-xs mt-1">Complete tasks, log diary entries, and close leads to earn badges.</p>
          <button
            onClick={() => setShowAll(true)}
            className="mt-4 text-gold/60 hover:text-gold text-xs underline underline-offset-2 transition-colors"
          >
            See all available badges
          </button>
        </div>
      )}
    </div>
  );
}
