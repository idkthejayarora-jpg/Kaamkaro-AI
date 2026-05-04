/**
 * badgeEarner.js — automatic badge checker and awarder.
 *
 * Call checkAndAwardBadges(staffId, triggerContext) after any qualifying event.
 * Already-earned badges are skipped (idempotent).
 * Newly earned badges are persisted and broadcast over SSE.
 *
 * Badge catalogue — 19 badges across bronze / silver / gold tiers:
 *
 *   Tasks:      first_steps (1), task_warrior (50), task_legend (100)
 *   Streak:     on_a_roll (7d), streak_master (30d), unstoppable (100d)
 *   Deals:      first_deal (1), deal_maker (5), closer (20)
 *   Merits:     merit_rookie (50), merit_pro (200), merit_elite (500)
 *   Tenure:     old_timer (30d), veteran (90d), pillar (365d)
 *   Response:   sharp_responder (≥90%, min 20), call_champion (≥98%, min 30)
 *   Loop tasks: loop_closer (5), loop_master (20)
 */

const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne } = require('./db');
const { broadcast } = require('./sse');

// ── Badge definitions ─────────────────────────────────────────────────────────

const BADGES = {
  // ── Tasks ──
  first_steps:    { tier: 'bronze', label: 'First Steps',       icon: '✅', description: 'Completed your first task' },
  task_warrior:   { tier: 'silver', label: 'Task Warrior',      icon: '⚔️',  description: '50 tasks completed' },
  task_legend:    { tier: 'gold',   label: 'Task Legend',       icon: '🏅', description: '100 tasks completed' },

  // ── Diary streak ──
  on_a_roll:      { tier: 'bronze', label: 'On a Roll',         icon: '🔥', description: '7-day diary streak' },
  streak_master:  { tier: 'silver', label: 'Streak Master',     icon: '⚡', description: '30-day diary streak' },
  unstoppable:    { tier: 'gold',   label: 'Unstoppable',       icon: '💫', description: '100-day diary streak' },

  // ── Lead conversions ──
  first_deal:     { tier: 'bronze', label: 'First Deal',        icon: '🤝', description: 'Closed your first lead' },
  deal_maker:     { tier: 'silver', label: 'Deal Maker',        icon: '💼', description: '5 leads closed' },
  closer:         { tier: 'gold',   label: 'Closer',            icon: '🏆', description: '20 leads closed' },

  // ── Merit points ──
  merit_rookie:   { tier: 'bronze', label: 'Merit Rookie',      icon: '🌟', description: 'Earned 50 merit points' },
  merit_pro:      { tier: 'silver', label: 'Merit Pro',         icon: '💎', description: 'Earned 200 merit points' },
  merit_elite:    { tier: 'gold',   label: 'Merit Elite',       icon: '👑', description: 'Earned 500 merit points' },

  // ── Tenure ──
  old_timer:      { tier: 'bronze', label: 'Old Timer',         icon: '📅', description: '30 days on the team' },
  veteran:        { tier: 'silver', label: 'Veteran',           icon: '🎖️',  description: '90 days on the team' },
  pillar:         { tier: 'gold',   label: 'Pillar',            icon: '🏛️',  description: '365 days on the team' },

  // ── Response rate ──
  sharp_responder:{ tier: 'bronze', label: 'Sharp Responder',   icon: '📞', description: '90%+ response rate (min 20 interactions)' },
  call_champion:  { tier: 'gold',   label: 'Call Champion',     icon: '🎯', description: '98%+ response rate (min 30 interactions)' },

  // ── Loop tasks ──
  loop_closer:    { tier: 'bronze', label: 'Loop Closer',       icon: '🔄', description: '5 loop tasks completed' },
  loop_master:    { tier: 'silver', label: 'Loop Master',       icon: '♾️',  description: '20 loop tasks completed' },
};

// ── Criteria evaluator ────────────────────────────────────────────────────────

/**
 * Returns the set of badge keys that this staff member has earned.
 * Reads from all relevant collections — called once per check.
 */
async function computeEarnedKeys(staffId) {
  const [tasks, leads, merits, staffList, interactions] = await Promise.all([
    readDB('tasks').catch(() => []),
    readDB('leads').catch(() => []),
    readDB('merits').catch(() => []),
    readDB('staff').catch(() => []),
    readDB('interactions').catch(() => []),
  ]);

  const staff = staffList.find(s => s.id === staffId);
  if (!staff) return new Set();

  // ── Tasks ──
  const completedTasks = tasks.filter(t => t.staffId === staffId && t.completed);
  const loopTasks      = completedTasks.filter(t => t.isLoop);
  const taskCount      = completedTasks.length;
  const loopCount      = loopTasks.length;

  // ── Diary streak (from staff.streakData set by streak.js) ──
  const currentStreak = staff.streakData?.currentStreak || 0;
  const longestStreak = staff.streakData?.longestStreak  || 0;
  const bestStreak    = Math.max(currentStreak, longestStreak);

  // ── Leads closed ──
  const closedLeads = leads.filter(l => l.staffId === staffId && l.stage === 'won');
  const closedCount = closedLeads.length;

  // ── Merit total (only positive points count) ──
  const ownMerits  = merits.filter(m => m.staffId === staffId);
  const meritTotal = ownMerits.reduce((sum, m) => sum + (m.points || 0), 0);

  // ── Tenure ──
  const createdAt  = staff.createdAt ? new Date(staff.createdAt) : null;
  const tenureDays = createdAt ? Math.floor((Date.now() - createdAt.getTime()) / 86400000) : 0;

  // ── Response rate (all-time, same keyword logic as leaderboard) ──
  const RESPONSE_KEYWORDS = /payment|paid|billed|bill|invoice|parcel|delivery|advance|balance|collected|received|planned|follow.?up/i;
  const staffInteractions = interactions.filter(i => i.staffId === staffId);
  const responded         = staffInteractions.filter(i => i.responded || (i.notes && RESPONSE_KEYWORDS.test(i.notes))).length;
  const responseRate      = staffInteractions.length > 0
    ? Math.round(responded / staffInteractions.length * 100) : 0;
  const interactionCount  = staffInteractions.length;

  // ── Evaluate ──
  const earned = new Set();

  if (taskCount >= 1)   earned.add('first_steps');
  if (taskCount >= 50)  earned.add('task_warrior');
  if (taskCount >= 100) earned.add('task_legend');

  if (bestStreak >= 7)   earned.add('on_a_roll');
  if (bestStreak >= 30)  earned.add('streak_master');
  if (bestStreak >= 100) earned.add('unstoppable');

  if (closedCount >= 1)  earned.add('first_deal');
  if (closedCount >= 5)  earned.add('deal_maker');
  if (closedCount >= 20) earned.add('closer');

  if (meritTotal >= 50)  earned.add('merit_rookie');
  if (meritTotal >= 200) earned.add('merit_pro');
  if (meritTotal >= 500) earned.add('merit_elite');

  if (tenureDays >= 30)  earned.add('old_timer');
  if (tenureDays >= 90)  earned.add('veteran');
  if (tenureDays >= 365) earned.add('pillar');

  if (interactionCount >= 20 && responseRate >= 90) earned.add('sharp_responder');
  if (interactionCount >= 30 && responseRate >= 98) earned.add('call_champion');

  if (loopCount >= 5)  earned.add('loop_closer');
  if (loopCount >= 20) earned.add('loop_master');

  return earned;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Check all badge criteria for a staff member and award any newly-earned badges.
 * Safe to call on every qualifying event — duplicate awards are skipped.
 *
 * @param {string} staffId
 * @param {{ event: string }} triggerContext  — for logging only
 * @returns {Promise<Array>} newly awarded badge records
 */
async function checkAndAwardBadges(staffId, triggerContext = {}) {
  try {
    const [earnedKeys, existingBadges] = await Promise.all([
      computeEarnedKeys(staffId),
      readDB('badges').catch(() => []),
    ]);

    const alreadyHave = new Set(
      existingBadges.filter(b => b.staffId === staffId).map(b => b.badgeKey)
    );

    const newKeys = [...earnedKeys].filter(k => !alreadyHave.has(k));
    if (newKeys.length === 0) return [];

    const staffList = await readDB('staff').catch(() => []);
    const staff     = staffList.find(s => s.id === staffId);
    const staffName = staff?.name || 'Staff';

    const now = new Date().toISOString();
    const newBadges = [];

    for (const key of newKeys) {
      const meta = BADGES[key];
      if (!meta) continue;

      const record = {
        id:        uuidv4(),
        staffId,
        staffName,
        badgeKey:  key,
        label:     meta.label,
        icon:      meta.icon,
        tier:      meta.tier,
        earnedAt:  now,
      };

      await insertOne('badges', record);
      newBadges.push(record);

      // SSE — only the staff member who earned it sees the toast
      broadcast('badge:earned', { staffId, badge: record });

      console.log(`[Badge] 🏅 ${staffName} earned "${meta.label}" (${meta.tier}) — trigger: ${triggerContext.event || 'unknown'}`);
    }

    return newBadges;
  } catch (err) {
    // Non-fatal — badge checks should never crash the main request
    console.error('[Badge] checkAndAwardBadges error:', err.message);
    return [];
  }
}

module.exports = { checkAndAwardBadges, BADGES };
