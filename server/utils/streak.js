const { v4: uuidv4 } = require('uuid');
const { readDB, updateOne, insertOne } = require('./db');
const { awardMerit } = require('./merits');

function getCurrentWeek() {
  const d = new Date();
  const startOfYear = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((d - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function toDateStr(date = new Date()) {
  return new Date(date).toISOString().split('T')[0];
}

/**
 * Call after any staff activity (interaction logged, diary entry saved).
 * Increments streak if first activity today, resets if gap detected.
 * Also recalculates weekly response rate and contact count.
 */
async function updateStaffStreak(staffId) {
  const today = toDateStr();
  const yesterday = toDateStr(new Date(Date.now() - 86400000));

  const staffList = await readDB('staff');
  const s = staffList.find(x => x.id === staffId);
  if (!s) return;

  const streakData = s.streakData || { currentStreak: 0, lastActivityDate: null, longestStreak: 0 };

  if (streakData.lastActivityDate === today) return; // Already counted today

  const previousStreak = streakData.currentStreak;

  if (streakData.lastActivityDate === yesterday) {
    streakData.currentStreak += 1;
    // +2 merit for every streak day maintained
    await awardMerit(staffId, s.name, 2,
      `Streak day ${streakData.currentStreak}: activity logged`, 'streak', null);
  } else {
    // Streak broken — penalise if they had a streak going
    if (previousStreak > 0) {
      await awardMerit(staffId, s.name, -2,
        `Streak lost (was ${previousStreak}d)`, 'streak', null);
    }
    streakData.currentStreak = 1; // Gap — reset to 1 for today
  }

  streakData.lastActivityDate = today;
  streakData.longestStreak = Math.max(streakData.longestStreak, streakData.currentStreak);

  await updateOne('staff', staffId, { streakData });
  await syncWeeklyPerformance(staffId, streakData.currentStreak);
}

/**
 * Recalculates response rate and contact count for the current week,
 * then writes to the performance collection.
 */
async function syncWeeklyPerformance(staffId, streak) {
  const week = getCurrentWeek();
  const weekStart = getWeekStart(week);
  const weekEnd   = new Date(weekStart.getTime() + 7 * 86400000);

  const interactions = await readDB('interactions');
  const weekInteractions = interactions.filter(i =>
    i.staffId === staffId &&
    new Date(i.createdAt) >= weekStart &&
    new Date(i.createdAt) < weekEnd
  );

  const total     = weekInteractions.length;
  const responded = weekInteractions.filter(i => i.responded).length;
  const rate      = total > 0 ? Math.round((responded / total) * 100) : 0;

  const staffList = await readDB('staff');
  const s = staffList.find(x => x.id === staffId);
  const currentStreak = streak !== undefined ? streak : (s?.streakData?.currentStreak || 0);

  const performance = await readDB('performance');
  const existing = performance.find(p => p.staffId === staffId && p.week === week);

  if (existing) {
    await updateOne('performance', existing.id, {
      customersContacted: total,
      responseRate: rate,
      streak: currentStreak,
    });
  } else {
    await insertOne('performance', {
      id: uuidv4(),
      staffId,
      week,
      customersContacted: total,
      responseRate: rate,
      streak: currentStreak,
      entriesLogged: 0,
      targets: 20,
      achieved: responded,
      createdAt: new Date().toISOString(),
    });
  }
}

function getWeekStart(weekStr) {
  const [year, weekNum] = weekStr.split('-W').map(Number);
  const jan1 = new Date(year, 0, 1);
  const daysToFirstMonday = (8 - jan1.getDay()) % 7;
  const firstMonday = new Date(jan1.getTime() + daysToFirstMonday * 86400000);
  return new Date(firstMonday.getTime() + (weekNum - 1) * 7 * 86400000);
}

module.exports = { updateStaffStreak, syncWeeklyPerformance, getCurrentWeek };
