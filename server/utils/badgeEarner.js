/**
 * badgeEarner.js — automatic badge checker and awarder.
 *
 * Criteria are stored in the config collection under key 'badgeCriteria'.
 * Admins can edit thresholds via PUT /api/badges/criteria.
 * Falls back to DEFAULT_CRITERIA if no custom config exists.
 *
 * Badge catalogue — 19 badges, 3 tiers:
 *   Tasks:      pehla_qadam · parishramik · karya_ratna
 *   Streak:     niyamit_karyakarta · satat_sevak · atulit_parishram
 *   Deals:      pehli_safalta · vyapar_nipun · shresth_vikreta
 *   Merits:     pratham_samman · vishisht_samman · param_samman
 *   Tenure:     nav_sadasya · niyamit_sadasya · varishth_sadasya
 *   Response:   uttam_pratikriya · sanchar_shresth
 *   Loop tasks: niyamit_sevak · dhara_karyakarta
 */

const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne } = require('./db');
const { broadcast } = require('./sse');

// ── Badge definitions (labels, icons, tiers) ─────────────────────────────────
// These never change — only the numeric thresholds are admin-configurable.

const BADGES = {
  // ── Tasks ─────────────────────────────────────────────────────────────────
  pehla_qadam:        { tier: 'bronze', label: 'Pehla Kadam',        icon: '👣', description: 'Pehla task complete kiya' },
  parishramik:        { tier: 'silver', label: 'Kaam ka Baadshah',   icon: '⚔️',  description: '50 tasks complete kiye' },
  karya_ratna:        { tier: 'gold',   label: 'Kaam ka Legend',     icon: '🏅', description: '100 tasks complete kiye' },

  // ── Diary streak ──────────────────────────────────────────────────────────
  niyamit_karyakarta: { tier: 'bronze', label: 'Chal Pada',          icon: '🔥', description: '7 din ki diary streak' },
  satat_sevak:        { tier: 'silver', label: 'Roz Ka Yodha',       icon: '⚡', description: '30 din ki diary streak' },
  atulit_parishram:   { tier: 'gold',   label: 'Rokna Mushkil Hai',  icon: '💫', description: '100 din ki diary streak' },

  // ── Lead conversions ──────────────────────────────────────────────────────
  pehli_safalta:      { tier: 'bronze', label: 'Pehli Dikki',        icon: '🤝', description: 'Pehla lead close kiya' },
  vyapar_nipun:       { tier: 'silver', label: 'Deal Baaz',          icon: '💼', description: '5 leads close kiye' },
  shresth_vikreta:    { tier: 'gold',   label: 'Badi Dikki',         icon: '🏆', description: '20 leads close kiye' },

  // ── Merit points ──────────────────────────────────────────────────────────
  pratham_samman:     { tier: 'bronze', label: 'Points Starter',     icon: '🌟', description: '50 merit points kamaye' },
  vishisht_samman:    { tier: 'silver', label: 'Points Khiladi',     icon: '💎', description: '200 merit points kamaye' },
  param_samman:       { tier: 'gold',   label: 'Points ka Raja',     icon: '👑', description: '500 merit points kamaye' },

  // ── Tenure ────────────────────────────────────────────────────────────────
  nav_sadasya:        { tier: 'bronze', label: '1 Mahina Hua',       icon: '🌱', description: '30 din team mein' },
  niyamit_sadasya:    { tier: 'silver', label: '3 Mahine Hua',       icon: '🎖️',  description: '90 din team mein' },
  varishth_sadasya:   { tier: 'gold',   label: 'Tena Pana',          icon: '🏛️',  description: '1 saal team mein' },

  // ── Response rate ─────────────────────────────────────────────────────────
  uttam_pratikriya:   { tier: 'bronze', label: 'Call pe Ready',      icon: '📞', description: '90%+ response rate (min 20 calls)' },
  sanchar_shresth:    { tier: 'gold',   label: 'Call Ka King',       icon: '🎯', description: '98%+ response rate (min 30 calls)' },

  // ── Loop tasks ────────────────────────────────────────────────────────────
  niyamit_sevak:      { tier: 'bronze', label: 'Baar Baar Karta',    icon: '🔄', description: '5 loop tasks complete' },
  dhara_karyakarta:   { tier: 'silver', label: 'Loop ka Ustaad',     icon: '♾️',  description: '20 loop tasks complete' },
};

// ── Default criteria thresholds ───────────────────────────────────────────────
// Admin can override any of these via the badge criteria editor.

const DEFAULT_CRITERIA = {
  tasks:    { bronze: 1,   silver: 50,  gold: 100 },
  streak:   { bronze: 7,   silver: 30,  gold: 100 },
  deals:    { bronze: 1,   silver: 5,   gold: 20  },
  merits:   { bronze: 50,  silver: 200, gold: 500 },
  tenure:   { bronze: 30,  silver: 90,  gold: 365 },
  response: {
    bronze: { rate: 90, minInteractions: 20 },
    gold:   { rate: 98, minInteractions: 30 },
  },
  loopTasks: { bronze: 5, silver: 20 },
};

/**
 * Load admin-customised criteria from the config collection.
 * Falls back to DEFAULT_CRITERIA for any missing fields.
 */
async function loadCriteria() {
  try {
    const config = await readDB('config');
    const entry  = config.find(c => c.key === 'badgeCriteria');
    if (!entry) return DEFAULT_CRITERIA;
    const saved = JSON.parse(entry.value);
    // Deep-merge saved over defaults so new criteria added in future code aren't lost
    return {
      tasks:     { ...DEFAULT_CRITERIA.tasks,     ...saved.tasks },
      streak:    { ...DEFAULT_CRITERIA.streak,    ...saved.streak },
      deals:     { ...DEFAULT_CRITERIA.deals,     ...saved.deals },
      merits:    { ...DEFAULT_CRITERIA.merits,    ...saved.merits },
      tenure:    { ...DEFAULT_CRITERIA.tenure,    ...saved.tenure },
      response:  {
        bronze: { ...DEFAULT_CRITERIA.response.bronze, ...(saved.response?.bronze || {}) },
        gold:   { ...DEFAULT_CRITERIA.response.gold,   ...(saved.response?.gold   || {}) },
      },
      loopTasks: { ...DEFAULT_CRITERIA.loopTasks, ...saved.loopTasks },
    };
  } catch {
    return DEFAULT_CRITERIA;
  }
}

// ── Criteria evaluator ────────────────────────────────────────────────────────

async function computeEarnedKeys(staffId) {
  const [[tasks, leads, merits, staffList, interactions], criteria] = await Promise.all([
    Promise.all([
      readDB('tasks').catch(() => []),
      readDB('leads').catch(() => []),
      readDB('merits').catch(() => []),
      readDB('staff').catch(() => []),
      readDB('interactions').catch(() => []),
    ]),
    loadCriteria(),
  ]);

  const staff = staffList.find(s => s.id === staffId);
  if (!staff) return new Set();

  const completedTasks = tasks.filter(t => t.staffId === staffId && t.completed);
  const loopTasks      = completedTasks.filter(t => t.isLoop);
  const taskCount      = completedTasks.length;
  const loopCount      = loopTasks.length;

  const currentStreak  = staff.streakData?.currentStreak || 0;
  const longestStreak  = staff.streakData?.longestStreak  || 0;
  const bestStreak     = Math.max(currentStreak, longestStreak);

  const closedCount    = leads.filter(l => l.staffId === staffId && l.stage === 'won').length;

  const meritTotal     = merits
    .filter(m => m.staffId === staffId)
    .reduce((sum, m) => sum + (m.points || 0), 0);

  const createdAt   = staff.createdAt ? new Date(staff.createdAt) : null;
  const tenureDays  = createdAt ? Math.floor((Date.now() - createdAt.getTime()) / 86400000) : 0;

  const RESPONSE_KEYWORDS = /payment|paid|billed|bill|invoice|parcel|delivery|advance|balance|collected|received|planned|follow.?up/i;
  const staffInteractions  = interactions.filter(i => i.staffId === staffId);
  const responded          = staffInteractions.filter(i => i.responded || (i.notes && RESPONSE_KEYWORDS.test(i.notes))).length;
  const responseRate       = staffInteractions.length > 0
    ? Math.round(responded / staffInteractions.length * 100) : 0;
  const interactionCount   = staffInteractions.length;

  const c = criteria;
  const earned = new Set();

  // Tasks
  if (taskCount >= c.tasks.bronze) earned.add('pehla_qadam');
  if (taskCount >= c.tasks.silver) earned.add('parishramik');
  if (taskCount >= c.tasks.gold)   earned.add('karya_ratna');

  // Streak
  if (bestStreak >= c.streak.bronze) earned.add('niyamit_karyakarta');
  if (bestStreak >= c.streak.silver) earned.add('satat_sevak');
  if (bestStreak >= c.streak.gold)   earned.add('atulit_parishram');

  // Deals
  if (closedCount >= c.deals.bronze) earned.add('pehli_safalta');
  if (closedCount >= c.deals.silver) earned.add('vyapar_nipun');
  if (closedCount >= c.deals.gold)   earned.add('shresth_vikreta');

  // Merits
  if (meritTotal >= c.merits.bronze) earned.add('pratham_samman');
  if (meritTotal >= c.merits.silver) earned.add('vishisht_samman');
  if (meritTotal >= c.merits.gold)   earned.add('param_samman');

  // Tenure
  if (tenureDays >= c.tenure.bronze) earned.add('nav_sadasya');
  if (tenureDays >= c.tenure.silver) earned.add('niyamit_sadasya');
  if (tenureDays >= c.tenure.gold)   earned.add('varishth_sadasya');

  // Response rate
  if (interactionCount >= c.response.bronze.minInteractions && responseRate >= c.response.bronze.rate)
    earned.add('uttam_pratikriya');
  if (interactionCount >= c.response.gold.minInteractions && responseRate >= c.response.gold.rate)
    earned.add('sanchar_shresth');

  // Loop tasks
  if (loopCount >= c.loopTasks.bronze) earned.add('niyamit_sevak');
  if (loopCount >= c.loopTasks.silver) earned.add('dhara_karyakarta');

  return earned;
}

// ── Main export ───────────────────────────────────────────────────────────────

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

    const now      = new Date().toISOString();
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

      broadcast('badge:earned', { staffId, badge: record });
      console.log(`[Badge] 🏅 ${staffName} earned "${meta.label}" (${meta.tier}) — trigger: ${triggerContext.event || 'unknown'}`);
    }

    return newBadges;
  } catch (err) {
    console.error('[Badge] checkAndAwardBadges error:', err.message);
    return [];
  }
}

module.exports = { checkAndAwardBadges, BADGES, DEFAULT_CRITERIA, loadCriteria };
