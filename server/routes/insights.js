const express = require('express');
const { readDB } = require('../utils/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ── Helpers ────────────────────────────────────────────────────────────────────

function daysSince(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function hasKeywords(text, keywords) {
  const lower = (text || '').toLowerCase();
  return keywords.some(k => lower.includes(k));
}

const PAYMENT_DELAY_WORDS = [
  'delay', 'baad mein', 'abhi nahi', 'payment pending', 'paise nahi',
  'wait kar', 'kal denge', 'next week', 'thoda time', 'agle mahine',
  'not paid', 'due', 'pending payment', 'late payment', 'waiting for payment',
];

const ORDER_WORDS = [
  'order', 'dispatch', 'mal', 'design', 'piece', 'quantity',
  'khep', 'parcel', 'shipment', 'booking', 'supply', 'item',
];

// ── Core computation ───────────────────────────────────────────────────────────

function computeCustomerInsight(customer, interactions, diaryEntries, staffMap) {
  const ixs = interactions.filter(i => i.customerId === customer.id);

  // Collect all diary mentions of this customer via aiEntries
  const diaryMentions = [];
  for (const entry of diaryEntries) {
    for (const ae of (entry.aiEntries || [])) {
      if (ae.customerId === customer.id) {
        diaryMentions.push({
          ...ae,
          entryDate: entry.date || entry.createdAt,
          staffId:   entry.staffId,
          staffName: entry.staffName,
        });
      }
    }
  }

  const allText = [
    ...ixs.map(i => i.notes || ''),
    ...diaryMentions.map(m => (m.notes || '') + ' ' + (m.originalNotes || '')),
    customer.notes || '',
  ].join(' ');

  const lastContactDays = daysSince(customer.lastContact);

  // ── Sentiments ────────────────────────────────────────────────────────────
  const sentiments = [
    ...ixs.map(i => i.sentiment).filter(Boolean),
    ...diaryMentions.map(m => m.sentiment).filter(Boolean),
  ];
  const posCount = sentiments.filter(s => s === 'positive').length;
  const negCount = sentiments.filter(s => s === 'negative').length;
  const total    = sentiments.length || 1;

  const recentSents  = sentiments.slice(-4);
  const recentPos    = recentSents.filter(s => s === 'positive').length;
  const sentimentTrend =
    recentSents.length === 0 ? 'unknown' :
    recentPos >= 3            ? 'improving' :
    recentPos === 0 && recentSents.length >= 2 ? 'declining' : 'stable';

  // ── Responsiveness ────────────────────────────────────────────────────────
  const notResponded  = ixs.filter(i => !i.responded).length;
  const responseRate  = ixs.length > 0
    ? Math.round(((ixs.length - notResponded) / ixs.length) * 100)
    : 50;
  const ghosting = lastContactDays !== null && lastContactDays > 21 && responseRate < 30;
  const ignoring = lastContactDays !== null && lastContactDays > 14 && responseRate < 40 && ixs.length > 2;
  const responsiveness =
    ghosting ? 'ghosting' :
    ignoring ? 'ignoring' :
    responseRate < 45 ? 'slow' : 'responsive';

  // ── Order / payment patterns ───────────────────────────────────────────────
  const hasPaymentDelay = hasKeywords(allText, PAYMENT_DELAY_WORDS);
  const orderMentions   = diaryMentions.filter(m =>
    hasKeywords((m.notes || '') + ' ' + (m.originalNotes || ''), ORDER_WORDS)
  );
  const orderFrequency =
    orderMentions.length >= 4 ? 'frequent' :
    orderMentions.length >= 1 ? 'occasional' : 'rare';

  // Average cycle between diary appearances (days)
  let avgOrderCycleDays = null;
  if (diaryMentions.length >= 2) {
    const dates = diaryMentions
      .map(m => new Date(m.entryDate).getTime())
      .sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < dates.length; i++) gaps.push((dates[i] - dates[i - 1]) / 86400000);
    avgOrderCycleDays = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
  }

  // ── Staff concern: recent interactions mostly negative ────────────────────
  const latestIxs    = [...ixs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 3);
  const latestNeg    = latestIxs.filter(i => i.sentiment === 'negative').length;
  const staffConcern = latestNeg >= 2 && latestIxs.length >= 2;

  // ── Priority score ────────────────────────────────────────────────────────
  // Contact RECENCY is the spine of the score — it's the one signal that's
  // always present, and a follow-up queue is fundamentally "who's been ignored
  // longest". Low baseline so healthy, recently-touched accounts fall to "low";
  // recency drives a WIDE spread; behaviour/stage modulate on top.
  // Thresholds: urgent ≥70, high ≥50, medium ≥28, low <28.
  let score = 8;

  // Time since last contact — the dominant axis (wide range → natural spread)
  if      (lastContactDays === null)   score += 46; // never contacted at all
  else if (lastContactDays > 60)       score += 50; // abandoned
  else if (lastContactDays > 45)       score += 42; // severely neglected
  else if (lastContactDays > 30)       score += 34; // overdue
  else if (lastContactDays > 21)       score += 24; // getting stale
  else if (lastContactDays > 14)       score += 15; // due a nudge
  else if (lastContactDays > 7)        score += 7;  // approaching cadence
  else if (lastContactDays > 3)        score += 2;  // recent
  else                                 score -= 4;  // freshly contacted

  // Responsiveness (measured from interaction history)
  if      (responsiveness === 'ghosting') score += 16;
  else if (responsiveness === 'ignoring') score += 9;
  else if (responsiveness === 'slow')     score += 3;

  // Sentiment trend from recent diary/interaction data
  if      (sentimentTrend === 'declining')  score += 9;
  else if (sentimentTrend === 'improving')  score -= 8;

  // Hard signals
  if (hasPaymentDelay) score += 11;
  if (staffConcern)    score += 7;

  // Pipeline stage — active deals at risk matter most; dead deals sink
  const stageBonus = { lead: 0, contacted: 2, interested: 7, negotiating: 11, closed: -45, churned: -25 };
  score += stageBonus[customer.status] || 0;

  // Negative sentiment ratio (max +8)
  score += Math.round((negCount / total) * 8);

  const priorityScore = Math.max(0, Math.min(100, score));

  // ── Hard urgency overrides ──────────────────────────────────────────────
  // Reserved for COMPOUNDING evidence only — neglect *and* a behavioural red
  // flag, or a live deal visibly breaking down. A single soft signal (a stale
  // lead, a 2-week-quiet deal) is NOT urgent on its own; the score handles it.
  const activeStages = customer.status === 'interested' || customer.status === 'negotiating';
  const badResponse  = responsiveness === 'ghosting' || responsiveness === 'ignoring';
  const redFlag      = badResponse || hasPaymentDelay || sentimentTrend === 'declining' || staffConcern;
  const severeNeglect = lastContactDays === null || lastContactDays > 45;
  let forcedUrgent = false;
  // Severely neglected winnable deal that ALSO shows a behavioural red flag
  if (severeNeglect && activeStages && redFlag) forcedUrgent = true;
  // A live deal actively breaking down: ghosting or a payment delay mid-negotiation
  if (activeStages && (responsiveness === 'ghosting' || hasPaymentDelay)) forcedUrgent = true;

  const priority =
    forcedUrgent || priorityScore >= 70 ? 'urgent' :   // Compounding red flags — act now
    priorityScore >= 50 ? 'high'   :                   // Needs attention this week
    priorityScore >= 28 ? 'medium' :                   // On the radar
                          'low';                       // All good, recently touched

  // ── Context snippet for AI (compact) ─────────────────────────────────────
  const contextSnippet = [
    ...diaryMentions.slice(-3).map(m => m.notes),
    ...ixs.slice(-2).map(i => i.notes),
  ].filter(Boolean).join(' | ').substring(0, 350);

  return {
    customerId:          customer.id,
    customerName:        customer.name,
    phone:               customer.phone || '',
    status:              customer.status,
    assignedTo:          customer.assignedTo,
    assignedStaffName:   staffMap[customer.assignedTo]?.name   || 'Unassigned',
    assignedStaffAvatar: staffMap[customer.assignedTo]?.avatar || '?',
    lastContactDays,
    priorityScore,
    priority,
    patterns: { responsiveness, orderFrequency, sentimentTrend, hasPaymentDelay, avgOrderCycleDays, staffConcern },
    metrics: {
      totalInteractions:  ixs.length + diaryMentions.length,
      positiveRatio:      Math.round((posCount / total) * 100),
      negativeRatio:      Math.round((negCount / total) * 100),
      responseRate,
      orderMentions:      orderMentions.length,
      totalDiaryMentions: diaryMentions.length,
    },
    contextSnippet,
    insight:    null,
    nextAction: null,
  };
}

// ── AI enrichment (batched single call) ────────────────────────────────────────

async function enrichWithAI(customers) {
  const { getClient, aiCreate } = require('../utils/llm');
  const client = getClient();
  if (!client || customers.length === 0) return customers;
  try {
    const summaries = customers.map(c => ({
      name:         c.customerName,
      status:       c.status,
      lastContact:  c.lastContactDays !== null ? `${c.lastContactDays}d ago` : 'never contacted',
      respond:      c.patterns.responsiveness,
      orders:       c.patterns.orderFrequency,
      sentiment:    c.patterns.sentimentTrend,
      paymentDelay: c.patterns.hasPaymentDelay,
      notes:        c.contextSnippet || null,
    }));

    const prompt = `You are a sales CRM analyst for an Indian business. Analyze each customer and give:
1. insight: 1 specific sentence about what's happening with this customer (use data, not generic advice)
2. nextAction: 1 concrete action the sales person should take next (specific, actionable)

Keep language simple, Hinglish OK. Be direct. No filler words.

Customers JSON:
${JSON.stringify(summaries)}

Return ONLY valid JSON array: [{"name":"...","insight":"...","nextAction":"..."}]`;

    const response = await aiCreate(client, {
      max_tokens: 2500,
      messages:   [{ role: 'user', content: prompt }],
    });

    const text  = response.content[0].text;
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return customers;

    const insights = JSON.parse(match[0]);
    return customers.map(c => {
      const ins = insights.find(i => i.name === c.customerName);
      return { ...c, insight: ins?.insight || null, nextAction: ins?.nextAction || null };
    });
  } catch (e) {
    console.error('[Insights AI]', e.message);
    return customers;
  }
}

// ── GET /api/insights/queue ────────────────────────────────────────────────────
router.get('/queue', async (req, res) => {
  try {
    const [customers, interactions, diaryEntries, staffList] = await Promise.all([
      readDB('customers'),
      readDB('interactions'),
      readDB('diary'),
      readDB('staff'),
    ]);

    let filtered = customers;
    if (req.user.role === 'staff') {
      filtered = customers.filter(c => c.assignedTo === req.user.id);
    }

    const staffMap = Object.fromEntries(staffList.map(s => [s.id, s]));

    const results = filtered.map(c =>
      computeCustomerInsight(c, interactions, diaryEntries, staffMap)
    );
    results.sort((a, b) => b.priorityScore - a.priorityScore);

    // Enrich top 25 with AI insights
    const enriched = await enrichWithAI(results.slice(0, 25));
    const final    = [...enriched, ...results.slice(25)];

    res.json(final);
  } catch (e) {
    console.error('[Insights Queue]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/insights/staff-behavior ─────────────────────────────────────────
router.get('/staff-behavior', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const [customers, interactions, staffList] = await Promise.all([
      readDB('customers'),
      readDB('interactions'),
      readDB('staff'),
    ]);

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

    const analysis = staffList.map(s => {
      const myCustomers    = customers.filter(c => c.assignedTo === s.id);
      const myInteractions = interactions.filter(i => i.staffId === s.id);
      const recentIxs      = myInteractions.filter(i => i.createdAt >= sevenDaysAgo);

      // Coverage: % of assigned customers contacted in last 7 days (capped at 100)
      const assignedIds    = new Set(myCustomers.map(c => c.id));
      const recentCustIds  = new Set(recentIxs.filter(i => assignedIds.has(i.customerId)).map(i => i.customerId));
      const coverage       = myCustomers.length > 0
        ? Math.min(100, Math.round((recentCustIds.size / myCustomers.length) * 100))
        : 0;
      const avgInteractions = myCustomers.length > 0
        ? Math.round((recentIxs.length / myCustomers.length) * 10) / 10
        : 0;

      // Sentiment score
      const sents      = myInteractions.map(i => i.sentiment).filter(Boolean);
      const posCount   = sents.filter(x => x === 'positive').length;
      const sentScore  = sents.length > 0 ? Math.round((posCount / sents.length) * 100) : 50;

      // Response rate (customer responded)
      const responded     = myInteractions.filter(i => i.responded).length;
      const responseRate  = myInteractions.length > 0
        ? Math.round((responded / myInteractions.length) * 100)
        : 0;

      // Customers with deteriorating sentiment (2+ consecutive negatives)
      const concernedCustomers = myCustomers.filter(c => {
        const cIxs = myInteractions
          .filter(i => i.customerId === c.id)
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .slice(0, 3);
        return cIxs.length >= 2 && cIxs.filter(i => i.sentiment === 'negative').length >= 2;
      }).map(c => ({ id: c.id, name: c.name }));

      // Overdue (not contacted in 14+ days)
      const overdueCount = myCustomers.filter(c => {
        const d = daysSince(c.lastContact);
        return d === null || d > 14;
      }).length;

      // Quality score composite
      const qualityScore = Math.round(coverage * 0.3 + sentScore * 0.3 + responseRate * 0.4);
      const qualityLabel =
        qualityScore >= 70 ? 'excellent' :
        qualityScore >= 35 ? 'good' : 'needs_attention';

      return {
        staffId:           s.id,
        staffName:         s.name,
        avatar:            s.avatar,
        customersAssigned: myCustomers.length,
        totalInteractions: myInteractions.length,
        recentInteractions: recentIxs.length,
        coverage,
        avgInteractions,
        sentimentScore:    sentScore,
        responseRate,
        qualityScore,
        qualityLabel,
        concernedCustomers,
        overdueCount,
        streak:            s.streakData?.currentStreak || 0,
      };
    });

    analysis.sort((a, b) => b.qualityScore - a.qualityScore);
    res.json(analysis);
  } catch (e) {
    console.error('[Insights Staff Behavior]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/insights/trends ──────────────────────────────────────────────────
router.get('/trends', async (req, res) => {
  try {
    const [customers, interactions] = await Promise.all([
      readDB('customers'),
      readDB('interactions'),
    ]);

    let filtered = customers;
    if (req.user.role === 'staff') {
      filtered = customers.filter(c => c.assignedTo === req.user.id);
    }
    const custIds      = new Set(filtered.map(c => c.id));
    const filteredIxs  = interactions.filter(i => custIds.has(i.customerId));

    // Pipeline breakdown
    const pipelineBreakdown = {};
    for (const c of filtered) {
      pipelineBreakdown[c.status] = (pipelineBreakdown[c.status] || 0) + 1;
    }

    // Weekly trend (last 8 ISO weeks)
    const weekMap = {};
    for (const ix of filteredIxs) {
      const d   = new Date(ix.createdAt);
      const yr  = d.getFullYear();
      const wk  = Math.ceil(((d - new Date(yr, 0, 1)) / 86400000 + new Date(yr, 0, 1).getDay() + 1) / 7);
      const key = `${yr}-W${String(wk).padStart(2, '0')}`;
      if (!weekMap[key]) weekMap[key] = { total: 0, responded: 0, positive: 0, negative: 0 };
      weekMap[key].total++;
      if (ix.responded)           weekMap[key].responded++;
      if (ix.sentiment === 'positive') weekMap[key].positive++;
      if (ix.sentiment === 'negative') weekMap[key].negative++;
    }
    const sentimentByWeek = Object.entries(weekMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-8)
      .map(([week, d]) => ({
        week:         `W${week.split('-W')[1]}`,
        responseRate: d.total > 0 ? Math.round((d.responded / d.total) * 100) : 0,
        positiveRate: d.total > 0 ? Math.round((d.positive  / d.total) * 100) : 0,
        total:        d.total,
      }));

    // Top customers by engagement
    const custEngagement = {};
    for (const ix of filteredIxs) {
      custEngagement[ix.customerId] = (custEngagement[ix.customerId] || 0) + 1;
    }
    const topCustomers = filtered
      .map(c => ({
        id:           c.id,
        name:         c.name,
        interactions: custEngagement[c.id] || 0,
        status:       c.status,
      }))
      .sort((a, b) => b.interactions - a.interactions)
      .slice(0, 10);

    // Ghost customers (never contacted or > 30 days)
    const ghostCustomers = filtered
      .filter(c => !['closed', 'churned'].includes(c.status))
      .filter(c => {
        const d = daysSince(c.lastContact);
        return d === null || d > 30;
      })
      .map(c => ({ id: c.id, name: c.name, daysSince: daysSince(c.lastContact) }))
      .sort((a, b) => (b.daysSince ?? 999) - (a.daysSince ?? 999))
      .slice(0, 8);

    // Tags breakdown
    const tagCounts = {};
    for (const c of filtered) {
      for (const tag of (c.tags || [])) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }
    const topTags = Object.entries(tagCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([tag, count]) => ({ tag, count }));

    // Interaction type breakdown (call / message / email / meeting / other)
    const typeBreakdown = {};
    for (const ix of filteredIxs) {
      const t = ix.type || 'other';
      if (!typeBreakdown[t]) typeBreakdown[t] = { count: 0, responded: 0 };
      typeBreakdown[t].count++;
      if (ix.responded) typeBreakdown[t].responded++;
    }
    const interactionTypeBreakdown = Object.entries(typeBreakdown)
      .sort(([, a], [, b]) => b.count - a.count)
      .map(([type, d]) => ({
        type,
        count: d.count,
        responseRate: d.count > 0 ? Math.round((d.responded / d.count) * 100) : 0,
      }));

    // Daily activity for last 30 days (for heatmap / sparkline)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const dailyActivity = {};
    for (const ix of filteredIxs) {
      if (ix.createdAt < thirtyDaysAgo) continue;
      const day = ix.createdAt.split('T')[0];
      if (!dailyActivity[day]) dailyActivity[day] = 0;
      dailyActivity[day]++;
    }

    res.json({
      pipelineBreakdown,
      sentimentByWeek,
      topCustomers,
      ghostCustomers,
      topTags,
      interactionTypeBreakdown,
      dailyActivity,
      totalCustomers:    filtered.length,
      totalInteractions: filteredIxs.length,
    });
  } catch (e) {
    console.error('[Insights Trends]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
