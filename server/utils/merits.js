/**
 * Merit point helper — call from any route to award or deduct points.
 *
 * Rules:
 *  +1  task completed on time
 *  +2  streak day (incremented)
 *  +5  positive customer conversion (closed / payment / revived)
 *  -1  task completed late / overdue completion
 *  -2  streak broken (gap in activity)
 *
 * Each event is persisted to the 'merits' collection so it is fully auditable
 * and the admin dashboard can show history.
 */

const { v4: uuidv4 } = require('uuid');
const { insertOne } = require('./db');

/**
 * @param {string} staffId
 * @param {string} staffName
 * @param {number} points   positive = reward, negative = penalty
 * @param {string} reason   human-readable label shown in the UI
 * @param {'task'|'streak'|'conversion'|'overdue'|'manual'} category
 * @param {string|null} relatedId  taskId / customerId / etc.
 */
async function awardMerit(staffId, staffName, points, reason, category, relatedId = null) {
  try {
    const event = {
      id:        uuidv4(),
      staffId,
      staffName,
      points,
      reason,
      category,
      relatedId,
      createdAt: new Date().toISOString(),
    };
    await insertOne('merits', event);
    console.log(`[Merit] ${points > 0 ? '+' : ''}${points} → ${staffName}: ${reason}`);
    return event;
  } catch (e) {
    console.error('[Merit] Award failed:', e.message);
  }
}

module.exports = { awardMerit };
