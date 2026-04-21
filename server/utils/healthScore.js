/**
 * Customer Health Score (0–100)
 * Factors:
 *   - Recency (days since last contact): 30 pts
 *   - Interaction frequency (last 30 days): 25 pts
 *   - Response rate (last 10 interactions): 25 pts
 *   - Pipeline stage bonus: 20 pts
 */
function calcHealthScore(customer, interactions = []) {
  const now = Date.now();
  let score = 0;

  // 1. Recency (0–30 pts)
  if (customer.lastContact) {
    const daysSince = (now - new Date(customer.lastContact).getTime()) / 86400000;
    if (daysSince <= 1)       score += 30;
    else if (daysSince <= 3)  score += 25;
    else if (daysSince <= 7)  score += 18;
    else if (daysSince <= 14) score += 10;
    else if (daysSince <= 30) score += 5;
    // > 30 days = 0
  }

  // 2. Interaction frequency in last 30 days (0–25 pts)
  const custInteractions = interactions.filter(
    i => i.customerId === customer.id && new Date(i.createdAt).getTime() > now - 30 * 86400000
  );
  const freq = custInteractions.length;
  if (freq >= 8)      score += 25;
  else if (freq >= 5) score += 20;
  else if (freq >= 3) score += 14;
  else if (freq >= 1) score += 8;

  // 3. Response rate on last 10 interactions (0–25 pts)
  const custAll = interactions
    .filter(i => i.customerId === customer.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 10);
  if (custAll.length > 0) {
    const responded = custAll.filter(i => i.responded).length;
    const rate = responded / custAll.length;
    score += Math.round(rate * 25);
  }

  // 4. Pipeline stage bonus (0–20 pts)
  const stageBonus = {
    lead:        0,
    contacted:   5,
    interested:  12,
    negotiating: 18,
    closed:      20,
    churned:     0,
  };
  score += stageBonus[customer.status] || 0;

  return Math.min(100, Math.max(0, score));
}

function healthLabel(score) {
  if (score >= 75) return { label: 'Healthy',  color: 'green' };
  if (score >= 45) return { label: 'Moderate', color: 'gold' };
  if (score >= 20) return { label: 'At Risk',  color: 'orange' };
  return             { label: 'Critical',  color: 'red' };
}

module.exports = { calcHealthScore, healthLabel };
