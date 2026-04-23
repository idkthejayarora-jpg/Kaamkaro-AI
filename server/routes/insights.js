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
  const ghosting = lastContactDays !== null && lastContactDays > 14 && responseRate < 40;
  const ignoring = lastContactDays !== null && lastContactDays > 7  && responseRate < 50 && ixs.length > 1;
  const responsiveness =
    ghosting ? 'ghosting' :
    ignoring ? 'ignoring' :
    responseRate < 60 ? 'slow' : 'responsive';

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
  let score = 50;

  if (lastContactDays === null) score += 25;
  else if (lastContactDays > 14) score += 20;
  else if (lastContactDays > 7)  score += 12;
  else if (lastContactDays > 3)  score += 4;
  else if (lastContactDays <= 1) score -= 15;

  if      (responsiveness === 'ghosting') score += 20;
  else if (responsiveness === 'ignoring') score += 12;
  else if (responsiveness === 'slow')     score += 5;

  if      (sentimentTrend === 'declining')  score += 15;
  else if (sentimentTrend === 'improving')  score -= 8;

  if (hasPaymentDelay) score += 10;
  if (staffConcern)    score += 8;

  const stageBonus = { lead: 5, contacted: 3, interested: 8, negotiating: 15, closed: -35, churned: -15 };
  score += stageBonus[customer.status] || 0;

  if (customer.dealValue > 50000)  score += 8;
  if (customer.dealValue > 200000) score += 5;

  score += Math.round((negCount / total) * 15);

  const priorityScore = Math.max(0, Math.min(100, score));
  const priority =
    priorityScore >= 80 ? 'urgent' :
    priorityScore >= 60 ? 'high'   :
    priorityScore >= 40 ? 'medium' : 'low';

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
    dealValue:           customer.dealValue,
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
  if (!process.env.ANTHROPIC_API_KEY || customers.length === 0) return customers;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic  = new Anthropic();

    const summaries = customers.map(c => ({
      name:         c.customerName,
      status:       c.status,
      lastContact:  c.lastContactDays !== null ? `${c.lastContactDays}d ago` : 'never contacted',
      respond:      c.patterns.responsiveness,
      orders:       c.patterns.orderFrequency,
      sentiment:    c.patterns.sentimentTrend,
      paymentDelay: c.patterns.hasPaymentDelay,
      dealValue:    c.dealValue ? `₹${c.dealValue}` : null,
      notes:        c.contextSnippet || null,
    }));

    const prompt = `You are a sales CRM analyst for an Indian business. Analyze each customer and give:
1. insight: 1 specific sentence about what's happening with this customer (use data, not generic advice)
2. nextAction: 1 concrete action the sales person should take next (specific, actionable)

Keep language simple, Hinglish OK. Be direct. No filler words.

Customers JSON:
${JSON.stringify(summaries)}

Return ONLY valid JSON array: [{"name":"...","insight":"...","nextAction":"..."}]`;

    const response = await anthropic.messages.create({
      model:      'claude-haiku-4-5',
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

      // Coverage: % of assigned customers contacted in last 7 days
      const recentCustIds  = new Set(recentIxs.map(i => i.customerId));
      const coverage       = myCustomers.length > 0
        ? Math.round((recentCustIds.size / myCustomers.length) * 100)
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

      // Overdue (not contacted in 7+ days)
      const overdueCount = myCustomers.filter(c => {
        const d = daysSince(c.lastContact);
        return d === null || d > 7;
      }).length;

      // Quality score composite
      const qualityScore = Math.round(coverage * 0.3 + sentScore * 0.3 + responseRate * 0.4);
      const qualityLabel =
        qualityScore >= 70 ? 'excellent' :
        qualityScore >= 50 ? 'good' : 'needs_attention';

      return {
        staffId:           s.id,
        staffName:         s.name,
        avatar:            s.avatar,
        customersAssigned: myCustomers.length,
        totalInteractions: myInteractions.length,
        recentInteractions: recentIxs.length,
        coverage,
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
        dealValue:    c.dealValue,
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

    res.json({
      pipelineBreakdown,
      pipelineValue:     filtered.reduce((s, c) => s + (c.dealValue || 0), 0),
      closedValue:       filtered.filter(c => c.status === 'closed').reduce((s, c) => s + (c.dealValue || 0), 0),
      sentimentByWeek,
      topCustomers,
      ghostCustomers,
      topTags,
      totalCustomers:    filtered.length,
      totalInteractions: filteredIxs.length,
    });
  } catch (e) {
    console.error('[Insights Trends]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
