/**
 * Working-day rules for attendance & payroll.
 *
 *   • Sundays are OFF by default (weekly holiday).
 *   • Admin/manager can declare extra holidays (holidays collection, type 'holiday').
 *   • Admin/manager can OPEN an off-day for a special occasion / high season
 *     (type 'working') — this forces that date to be a working day.
 *
 * A day-off is never counted as "absent" and never deducts pay.
 */
const { readDB } = require('./db');

// Build the predicate from an already-loaded holidays array.
function makeDayOff(holidays) {
  const offDates  = new Set((holidays || []).filter(h => h.type !== 'working').map(h => h.date));
  const workDates = new Set((holidays || []).filter(h => h.type === 'working').map(h => h.date));
  return function isDayOff(dateStr /* 'YYYY-MM-DD' */) {
    if (workDates.has(dateStr)) return false;   // explicitly opened (special occasion)
    if (offDates.has(dateStr))  return true;    // declared holiday
    // 0 = Sunday. Parse as UTC so the weekday is deterministic regardless of server TZ.
    return new Date(`${dateStr}T00:00:00Z`).getUTCDay() === 0;
  };
}

// Convenience: load holidays from the DB and return the predicate.
async function loadDayOff() {
  const holidays = await readDB('holidays').catch(() => []);
  return makeDayOff(holidays);
}

module.exports = { makeDayOff, loadDayOff };
