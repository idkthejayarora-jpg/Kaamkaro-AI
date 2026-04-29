const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne, updateOne, writeDB } = require('../utils/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { getCurrentWeek, updateStaffStreak } = require('../utils/streak');
const { logAudit } = require('../utils/audit');

const router = express.Router();
router.use(authMiddleware);

let Anthropic;
try { Anthropic = require('@anthropic-ai/sdk'); } catch {}

function getClient() {
  if (!Anthropic || !process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ── POST /api/ai/kamal — context-aware Kamal AI with Action Mode ────────────────
router.post('/kamal', async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    const client = getClient();

    const staff        = await readDB('staff');
    const customers    = await readDB('customers');
    const tasks        = await readDB('tasks');
    const interactions = await readDB('interactions');
    const performance  = await readDB('performance');

    const now = Date.now();
    const overdue = customers.filter(c => {
      if (!c.lastContact || c.status === 'closed' || c.status === 'churned') return false;
      return (now - new Date(c.lastContact).getTime()) > 7 * 86400000;
    });

    const todayStr = new Date().toISOString().split('T')[0];
    const dueTasks = tasks.filter(t => !t.completed && t.dueDate <= todayStr);

    const currentUserStaff = staff.find(s => s.id === req.user.id);
    const streak = currentUserStaff?.streakData?.currentStreak || 0;

    const thisWeek = getCurrentWeek();
    const weekPerf = performance.filter(p => p.week === thisWeek);
    const avgResponse = weekPerf.length
      ? Math.round(weekPerf.reduce((s, p) => s + (p.responseRate || 0), 0) / weekPerf.length) : 0;

    // Current user's customers for staff
    const myCustomers = req.user.role === 'staff'
      ? customers.filter(c => c.assignedTo === req.user.id).map(c => c.name)
      : [];

    const customerIdMap = customers.slice(0, 60).map(c => `${c.name}=${c.id}`).join(', ');
    const contextSummary = `You are Kamal — a proactive AI agent for Kaamkaro AI, a sales staff CRM. You don't just answer questions; you TAKE ACTIONS when asked.

LIVE DATA (${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}):
• Staff: ${staff.length} | Customers: ${customers.length} active | Pipeline: ${customers.filter(c=>!['closed','churned'].includes(c.status)).length} open
• Overdue (7+ days silent): ${overdue.length}${overdue.length > 0 ? ' → ' + overdue.slice(0, 4).map(c => c.name).join(', ') + (overdue.length > 4 ? ` +${overdue.length-4} more` : '') : ' ✓ none'}
• Due/overdue tasks: ${dueTasks.length}${dueTasks.length > 0 ? ' → ' + dueTasks.slice(0, 2).map(t => t.title).join(', ') : ' ✓ none'}
• This week avg response rate: ${avgResponse}%
• You are: ${req.user.name} (${req.user.role}) | Streak: ${streak} days
${myCustomers.length > 0 ? `• Your customers: ${myCustomers.slice(0, 12).join(', ')}` : ''}

═══ ACTIONS YOU CAN TAKE ═══
When the user says things like "log a call", "mark Rahul as interested", "create a task", "called Priya today" — DO IT immediately. Put the action JSON on its own line at the very end of your response (after your text).

Log a call/contact:
{"action": "log_interaction", "customerId": "ID", "customerName": "Name", "type": "call", "responded": true, "notes": "brief note", "followUpDate": null}

Create a task:
{"action": "create_task", "title": "Task title", "dueDate": "YYYY-MM-DD", "customerId": "ID or null", "customerName": "Name or null"}

Move pipeline stage:
{"action": "update_stage", "customerId": "ID", "customerName": "Name", "status": "lead|contacted|interested|negotiating|closed|churned"}

Navigate to a page:
{"navigate": "/customers"} — paths: /dashboard /staff /customers /vendors /tasks /diary /recommendations /audit /leaderboard /followup /goals

CUSTOMER ID LOOKUP: ${customerIdMap}${customers.length > 60 ? ` ...+${customers.length-60} more` : ''}

═══ RESPONSE STYLE ═══
• Be direct and action-first: confirm what you did, don't ask clarifying questions unless truly needed
• 2-4 sentences max unless giving a detailed report
• Speak like a sharp, warm colleague — not a corporate chatbot
• Always mention the most urgent thing if the user hasn't asked about it
• Support Hindi/Hinglish queries — respond in English but acknowledge Hindi naturally`;

    if (!client) {
      const lowerMsg = message.toLowerCase();
      let response = "I'm Kamal! ";
      let navigate = null;

      const navMap = {
        dashboard:    ['/dashboard',       'Opening Dashboard'],
        staff:        ['/staff',           'Opening Staff management'],
        customer:     ['/customers',       'Opening Customers'],
        vendor:       ['/vendors',         'Opening Vendors'],
        task:         ['/tasks',           'Opening your Tasks'],
        diary:        ['/diary',           'Opening Diary'],
        insight:      ['/recommendations', 'Opening AI Insights'],
        recommend:    ['/recommendations', 'Opening AI Insights'],
        audit:        ['/audit',           'Opening Audit Log'],
        leaderboard:  ['/leaderboard',     'Opening Leaderboard'],
        'follow.?up': ['/followup',        'Opening Follow-up Queue'],
        goal:         ['/goals',           'Opening Goals'],
      };

      let matched = false;
      for (const [key, [path, label]] of Object.entries(navMap)) {
        if (new RegExp(key).test(lowerMsg)) {
          response = label + '.';
          navigate = path;
          matched = true;
          break;
        }
      }

      if (!matched) {
        const alerts = [];
        if (overdue.length > 0) alerts.push(`${overdue.length} customers haven't been contacted in 7+ days`);
        if (dueTasks.length > 0) alerts.push(`${dueTasks.length} tasks are due today or overdue`);
        response += alerts.length > 0
          ? `Here's what needs your attention: ${alerts.join('. ')}.`
          : `Everything looks good! You have ${customers.length} customers and a ${streak}-day streak. Ask me to navigate anywhere or check on specific data.`;
      }

      return res.json({ response, navigate, action: null });
    }

    const messages = [
      ...history.slice(-10).map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message },
    ];

    const result = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: contextSummary,
      messages,
    });

    const raw = result.content[0].text;
    let navigate = null;
    let actionPayload = null;
    let response = raw;

    // Extract navigate JSON — single-line match is sufficient
    const navMatch = raw.match(/\{\s*"navigate"\s*:\s*"([^"]+)"\s*\}/);
    if (navMatch) {
      navigate = navMatch[1];
      response = response.replace(navMatch[0], '').trim();
    }

    // Robust action JSON extraction — handles multi-line, markdown fences, nested nulls
    // Strategy: find all {...} blocks, try to parse each for "action" key
    try {
      // Strip markdown code fences first
      const stripped = raw.replace(/```json?\s*/g, '').replace(/```\s*/g, '');
      // Find JSON object boundaries — greedy match of {...} blocks
      const jsonBlocks = [...stripped.matchAll(/(\{[\s\S]*?\})/g)];
      for (const match of jsonBlocks) {
        try {
          const parsed = JSON.parse(match[1]);
          if (parsed && typeof parsed.action === 'string') {
            actionPayload = parsed;
            response = response
              .replace(match[1], '')
              .replace(/```json?\s*/g, '').replace(/```\s*/g, '')
              .trim();
            break;
          }
        } catch { /* not valid JSON, try next */ }
      }
    } catch { /* ignore extraction errors */ }

    // Execute action server-side
    let actionResult = null;
    if (actionPayload) {
      try {
        if (actionPayload.action === 'log_interaction') {
          const interaction = {
            id: uuidv4(),
            customerId: actionPayload.customerId,
            staffId: req.user.id,
            staffName: req.user.name,
            type: actionPayload.type || 'call',
            responded: Boolean(actionPayload.responded),
            notes: `[Kamal AI] ${actionPayload.notes || ''}`,
            followUpDate: actionPayload.followUpDate || null,
            createdAt: new Date().toISOString(),
            source: 'kamal_ai',
          };
          await insertOne('interactions', interaction);
          await updateOne('customers', actionPayload.customerId, { lastContact: new Date().toISOString() });
          await updateStaffStreak(req.user.id);
          if (actionPayload.followUpDate) {
            await insertOne('tasks', {
              id: uuidv4(),
              staffId: req.user.id,
              customerId: actionPayload.customerId,
              customerName: actionPayload.customerName || 'Unknown',
              title: `Follow up with ${actionPayload.customerName || 'customer'}`,
              notes: '',
              dueDate: actionPayload.followUpDate,
              completed: false,
              completedAt: null,
              createdAt: new Date().toISOString(),
              source: 'kamal_ai',
            });
          }
          await logAudit(req.user.id, req.user.name, 'create', 'interaction', interaction.id, `Kamal AI logged ${interaction.type}`);
          actionResult = { type: 'interaction_logged', customer: actionPayload.customerName };
        } else if (actionPayload.action === 'create_task') {
          const task = {
            id: uuidv4(),
            staffId: req.user.id,
            customerId: actionPayload.customerId || null,
            customerName: actionPayload.customerName || null,
            title: actionPayload.title,
            notes: '[Created by Kamal AI]',
            dueDate: actionPayload.dueDate || new Date().toISOString().split('T')[0],
            completed: false,
            completedAt: null,
            createdAt: new Date().toISOString(),
            source: 'kamal_ai',
          };
          await insertOne('tasks', task);
          actionResult = { type: 'task_created', title: task.title };
        } else if (actionPayload.action === 'update_stage') {
          await updateOne('customers', actionPayload.customerId, { status: actionPayload.status });
          actionResult = { type: 'stage_updated', customer: actionPayload.customerName, stage: actionPayload.status };
        }
      } catch (err) {
        console.error('Action execution error:', err);
      }
    }

    res.json({ response, navigate, action: actionResult });
  } catch (err) {
    console.error('Kamal error:', err);
    res.json({ response: "Having a moment — please try again!", navigate: null, action: null });
  }
});

// ── GET /api/ai/recommendations ───────────────────────────────────────────────
// Analyzes ALL available data — diary (Hinglish/English), leads, customers,
// tasks, interactions — and returns per-staff actionable insights.
router.get('/recommendations', async (req, res) => {
  try {
    const [staff, customers, interactions, diary, leads, tasks, performance] = await Promise.all([
      readDB('staff'),
      readDB('customers').catch(() => []),
      readDB('interactions').catch(() => []),
      readDB('diary').catch(() => []),
      readDB('leads').catch(() => []),
      readDB('tasks').catch(() => []),
      readDB('performance').catch(() => []),
    ]);

    const client = getClient();
    const now = Date.now();
    const today = new Date().toISOString().split('T')[0];

    // ── Build per-staff context ─────────────────────────────────────────────────
    const staffMetrics = staff.map(s => {
      const myDiary    = diary.filter(d => d.staffId === s.id);
      const myLeads    = leads.filter(l => l.staffId === s.id && l.isActive !== false);
      const myCustomers = customers.filter(c => c.assignedTo === s.id);
      const myTasks    = tasks.filter(t => t.staffId === s.id || t.assignedTo === s.id);
      const myInteractions = interactions.filter(i => i.staffId === s.id);

      // Recent diary (last 30 days)
      const recentDiary = myDiary
        .filter(d => d.createdAt > new Date(now - 30 * 86400000).toISOString())
        .map(d => ({
          date:    d.date || d.createdAt?.split('T')[0],
          content: d.content || '',
          tasks:   (d.aiEntries || []).map(e => e.text || e.task || '').filter(Boolean),
        }));

      // Overdue follow-ups
      const overdueLeads = myLeads.filter(l => l.nextFollowUp && l.nextFollowUp < today);
      const dueTodayLeads = myLeads.filter(l => l.nextFollowUp === today);

      // Lead stage breakdown
      const leadsByStage = {};
      myLeads.forEach(l => { leadsByStage[l.stage] = (leadsByStage[l.stage] || 0) + 1; });

      // Pending tasks
      const pendingTasks = myTasks.filter(t => !t.completed).map(t => ({
        title: t.title, due: t.dueDate, overdue: t.dueDate && t.dueDate < today,
      }));

      // Performance
      const perfs = performance.filter(p => p.staffId === s.id)
        .sort((a, b) => b.week.localeCompare(a.week)).slice(0, 4);
      const avgResp = perfs.length
        ? Math.round(perfs.reduce((sum, p) => sum + (p.responseRate || 0), 0) / perfs.length) : null;

      // Compute a simple activity score from diary + interactions
      const activityScore = Math.min(100, Math.round(
        (recentDiary.length * 8) +
        (myInteractions.filter(i => new Date(i.createdAt).getTime() > now - 7 * 86400000).length * 5) +
        (myLeads.length * 3) +
        (myCustomers.length * 2)
      ));

      return {
        id: s.id,
        name: s.name,
        role: s.role,
        activityScore,
        diaryEntryCount: myDiary.length,
        recentDiaryCount: recentDiary.length,
        recentDiary,
        leadCount:    myLeads.length,
        leadsByStage,
        overdueLeads: overdueLeads.map(l => ({ name: l.name, due: l.nextFollowUp })),
        dueTodayLeads: dueTodayLeads.map(l => l.name),
        customerCount: myCustomers.length,
        pendingTasks,
        recentInteractions: myInteractions.filter(i => new Date(i.createdAt).getTime() > now - 7 * 86400000).length,
        avgResponseRate: avgResp,
      };
    });

    // ── No AI client — rule-based fallback ─────────────────────────────────────
    if (!client) {
      const recommendations = staffMetrics.map(s => {
        const issues = [], strengths = [], actions = [];

        if (s.recentDiaryCount > 0) strengths.push(`${s.recentDiaryCount} diary entries logged recently`);
        else issues.push('No recent diary entries logged');

        if (s.overdueLeads.length > 0) {
          issues.push(`${s.overdueLeads.length} overdue follow-up${s.overdueLeads.length > 1 ? 's' : ''}`);
          actions.push(`Follow up: ${s.overdueLeads.slice(0,3).map(l=>l.name).join(', ')}`);
        }
        if (s.dueTodayLeads.length > 0) actions.push(`Due today: ${s.dueTodayLeads.slice(0,3).join(', ')}`);
        if (s.leadCount > 0) strengths.push(`${s.leadCount} active CRM leads`);
        if (s.pendingTasks.filter(t => t.overdue).length > 0) issues.push('Has overdue tasks');
        if (actions.length === 0) actions.push('Keep logging diary entries and follow up on pending leads');

        return {
          staffId: s.id, staffName: s.name, performanceScore: s.activityScore,
          summary: `${s.recentDiaryCount} recent entries · ${s.leadCount} leads · ${s.overdueLeads.length} overdue`,
          strengths, issues, actions,
          priority: issues.length > 2 ? 'high' : issues.length > 0 ? 'medium' : 'low',
        };
      });
      return res.json({ recommendations, staffMetrics });
    }

    // ── AI analysis ─────────────────────────────────────────────────────────────
    const prompt = `You are a sales performance AI for an Indian business. Analyze the following staff data which includes diary entries in Hinglish (Hindi+English mix), CRM lead notes, tasks, and customer data. Understand Hinglish naturally — treat it as plain business notes.

STAFF DATA:
${JSON.stringify(staffMetrics.map(s => ({
  id: s.id, name: s.name, activityScore: s.activityScore,
  recentDiary: s.recentDiary.slice(0, 10),
  leadCount: s.leadCount, leadsByStage: s.leadsByStage,
  overdueLeads: s.overdueLeads,
  dueTodayLeads: s.dueTodayLeads,
  customerCount: s.customerCount,
  pendingTasks: s.pendingTasks.slice(0, 5),
  recentInteractions: s.recentInteractions,
  avgResponseRate: s.avgResponseRate,
})), null, 2)}

For EACH staff member, analyze their diary entries (Hinglish is fine), identify what products/services they're selling, who they're meeting, what follow-ups are pending, and how active they are. Generate coaching insights.

Return ONLY valid JSON array — no markdown, no explanation:
[{
  "staffId": "id",
  "staffName": "name",
  "performanceScore": <number 0-100 based on activity and results>,
  "summary": "<1 sentence summary of what this person is working on based on diary/leads>",
  "strengths": ["<specific strength from actual data, max 2>"],
  "issues": ["<specific issue from actual data, max 2>"],
  "actions": ["<specific actionable next step with actual names/leads where possible, 2-3 items>"],
  "priority": "high|medium|low"
}]`;

    const result = await client.messages.create({
      model: 'claude-haiku-4-5', max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });

    let raw = result.content[0].text.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const recommendations = JSON.parse(raw);
    res.json({ recommendations, staffMetrics });
  } catch (err) {
    console.error('[AI] recommendations error:', err);
    res.status(500).json({ error: 'Failed to generate insights' });
  }
});

// ── GET /api/ai/dashboard-summary ────────────────────────────────────────────
router.get('/dashboard-summary', async (req, res) => {
  try {
    const staff       = await readDB('staff');
    const customers   = await readDB('customers');
    const performance = await readDB('performance');
    const tasks       = await readDB('tasks');
    const thisWeek    = getCurrentWeek();
    const weekPerf    = performance.filter(p => p.week === thisWeek);
    const totalContacts = weekPerf.reduce((s, p) => s + (p.customersContacted || 0), 0);
    const avgResponse   = weekPerf.length
      ? weekPerf.reduce((s, p) => s + (p.responseRate || 0), 0) / weekPerf.length : 0;
    const topStreaker   = [...staff].sort((a, b) =>
      (b.streakData?.currentStreak || 0) - (a.streakData?.currentStreak || 0))[0];
    const overdue       = customers.filter(c => {
      if (!c.lastContact || ['closed','churned'].includes(c.status)) return false;
      return (Date.now() - new Date(c.lastContact).getTime()) > 7 * 86400000;
    });
    const dueTasks = tasks.filter(t => !t.completed && t.dueDate <= new Date().toISOString().split('T')[0]);

    // Pipeline deal value
    const pipelineValue = customers.reduce((sum, c) => sum + (c.dealValue || 0), 0);

    res.json({
      totalStaff: staff.length,
      activeStaff: staff.filter(s => s.active).length,
      totalCustomers: customers.length,
      activeCustomers: customers.filter(c => !['closed','churned'].includes(c.status)).length,
      weeklyContacts: totalContacts,
      avgResponseRate: Math.round(avgResponse),
      topStreaker: topStreaker ? { name: topStreaker.name, streak: topStreaker.streakData?.currentStreak || 0 } : null,
      overdueCount: overdue.length,
      dueTasksCount: dueTasks.length,
      pipelineValue,
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/ai/weekly-report — auto-generated weekly summary ──────────────────
router.get('/weekly-report', async (req, res) => {
  try {
    const staff        = await readDB('staff');
    const interactions = await readDB('interactions');
    const customers    = await readDB('customers');
    const tasks        = await readDB('tasks');
    const performance  = await readDB('performance');

    const weekAgo   = Date.now() - 7 * 86400000;
    const thisWeek  = getCurrentWeek();
    const weekPerf  = performance.filter(p => p.week === thisWeek);

    // Build per-staff summary
    const staffSummary = staff.map(s => {
      const myInteractions = interactions.filter(i => i.staffId === s.id && new Date(i.createdAt).getTime() > weekAgo);
      const responded      = myInteractions.filter(i => i.responded).length;
      const responseRate   = myInteractions.length > 0 ? Math.round(responded / myInteractions.length * 100) : 0;
      const completedTasks = tasks.filter(t => t.staffId === s.id && t.completed && t.completedAt && new Date(t.completedAt).getTime() > weekAgo).length;
      const closedCustomers = customers.filter(c => c.assignedTo === s.id && c.status === 'closed').length;
      const p = weekPerf.find(p => p.staffId === s.id);
      return {
        name: s.name,
        interactions: myInteractions.length,
        responseRate,
        completedTasks,
        closedCustomers,
        streak: s.streakData?.currentStreak || 0,
        performanceScore: p ? Math.round((p.responseRate * 0.4) + (Math.min(p.customersContacted / 20, 1) * 100 * 0.3) + ((s.streakData?.currentStreak || 0) / 7 * 100 * 0.3)) : 0,
      };
    });

    const topPerformer = staffSummary.sort((a, b) => b.interactions - a.interactions)[0];
    const totalInteractions = interactions.filter(i => new Date(i.createdAt).getTime() > weekAgo).length;
    const avgResponseRate = staffSummary.length > 0 ? Math.round(staffSummary.reduce((s, x) => s + x.responseRate, 0) / staffSummary.length) : 0;

    const client = getClient();

    if (!client) {
      const lines = [`📊 Weekly Performance Report — Week of ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}`];
      if (topPerformer) lines.push(`🏆 Top performer: ${topPerformer.name} with ${topPerformer.interactions} interactions`);
      lines.push(`📞 Total interactions: ${totalInteractions}`);
      lines.push(`📈 Avg response rate: ${avgResponseRate}%`);
      const needsAttention = staffSummary.filter(s => s.responseRate < 40 || s.interactions < 3);
      if (needsAttention.length > 0) lines.push(`⚠️ Needs attention: ${needsAttention.map(s => s.name).join(', ')}`);
      return res.json({ report: lines.join('\n'), staffSummary, topPerformer });
    }

    const prompt = `Generate a concise weekly performance report for a sales team. Keep it to 5-7 sentences max.

Team data for this week:
- Total interactions logged: ${totalInteractions}
- Avg response rate: ${avgResponseRate}%
- Per staff: ${JSON.stringify(staffSummary)}

Write in a warm, direct management style. Mention the top performer by name. Flag anyone who needs attention (low interactions or response rate). End with one actionable recommendation for next week.`;

    const result = await client.messages.create({
      model: 'claude-haiku-4-5', max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    res.json({ report: result.content[0].text, staffSummary, topPerformer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// ── GET /api/ai/sentiment-trend/:customerId ────────────────────────────────────
router.get('/sentiment-trend/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    const diary = await readDB('diary');

    // Check customer access
    const customers = await readDB('customers');
    const customer  = customers.find(c => c.id === customerId);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    if (req.user.role === 'staff' && customer.assignedTo !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Collect all AI-extracted entries that mention this customer
    const SENTIMENT_SCORE = { positive: 1, neutral: 0.5, negative: 0 };
    const trend = [];

    for (const entry of diary) {
      if (!entry.aiEntries) continue;
      for (const ai of entry.aiEntries) {
        if (ai.customerId === customerId || ai.matchedCustomerName?.toLowerCase() === customer.name.toLowerCase()) {
          trend.push({
            date: entry.date || entry.createdAt?.split('T')[0],
            sentiment: ai.sentiment || 'neutral',
            score: SENTIMENT_SCORE[ai.sentiment] ?? 0.5,
            notes: ai.notes?.slice(0, 100),
            confidence: ai.confidence,
          });
        }
      }
    }

    trend.sort((a, b) => a.date.localeCompare(b.date));
    const avgScore = trend.length > 0 ? (trend.reduce((s, t) => s + t.score, 0) / trend.length).toFixed(2) : null;

    res.json({ customerId, customerName: customer.name, trend, avgScore });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/ai/leaderboard ────────────────────────────────────────────────────
// Query params: teamId (admin only) — filter by specific team
router.get('/leaderboard', async (req, res) => {
  try {
    const [allStaff, interactions, customers, tasks, merits, teams] = await Promise.all([
      readDB('staff'),
      readDB('interactions'),
      readDB('customers'),
      readDB('tasks'),
      readDB('merits').catch(() => []),
      readDB('teams').catch(() => []),
    ]);

    // ── Team scoping ───────────────────────────────────────────────────────────
    // Staff: automatically scoped to their team (or all if not in any team)
    // Admin: can filter by teamId query param, or see all
    let staff = allStaff;
    let scopedTeamId   = null;
    let scopedTeamName = null;

    if (req.user.role === 'staff' && req.query.scope !== 'all') {
      const myTeam = teams.find(t => Array.isArray(t.members) && t.members.includes(req.user.id));
      if (myTeam) {
        staff = allStaff.filter(s => myTeam.members.includes(s.id));
        scopedTeamId   = myTeam.id;
        scopedTeamName = myTeam.name;
      }
    } else if (req.query.teamId) {
      const team = teams.find(t => t.id === req.query.teamId);
      if (team) {
        staff = allStaff.filter(s => team.members.includes(s.id));
        scopedTeamId   = team.id;
        scopedTeamName = team.name;
      }
    }

    // Build a map of staffId → team for badge display
    const staffTeamMap = {};
    for (const team of teams) {
      for (const mid of (team.members || [])) {
        staffTeamMap[mid] = { teamId: team.id, teamName: team.name };
      }
    }

    // ── Weekly window — current Mon 00:00 local → now ─────────────────────────
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun
    const daysSinceMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - daysSinceMon);
    weekStart.setHours(0, 0, 0, 0);
    const weekStartMs = weekStart.getTime();

    // Respect a manual reset date if admin has reset the leaderboard
    let resetAt = 0;
    try {
      const cfg = await readDB('config');
      const r = cfg.find(c => c.key === 'leaderboardResetAt');
      if (r) resetAt = new Date(r.value).getTime();
    } catch {}

    // Use whichever is more recent: Monday of this week or manual reset
    const weekWindowMs = Math.max(weekStartMs, resetAt);
    const monthAgo     = Date.now() - 30 * 86400000;

    // Response rate: interactions involving productive actions
    const RESPONSE_KEYWORDS = /payment|paid|billed|bill|invoice|parcel|delivery|advance|balance|collected|received|planned|follow.?up/i;

    const rows = staff.map(s => {
      const weekInteractions  = interactions.filter(i => i.staffId === s.id && new Date(i.createdAt).getTime() > weekWindowMs);
      const monthInteractions = interactions.filter(i => i.staffId === s.id && new Date(i.createdAt).getTime() > monthAgo);
      const responded         = weekInteractions.filter(i =>
        i.responded || (i.notes && RESPONSE_KEYWORDS.test(i.notes))
      ).length;
      const responseRate      = weekInteractions.length > 0 ? Math.round(responded / weekInteractions.length * 100) : 0;
      const closedCount       = customers.filter(c => c.assignedTo === s.id && c.status === 'closed' && new Date(c.updatedAt || c.createdAt).getTime() > resetAt).length;
      const completedTasks    = tasks.filter(t => t.staffId === s.id && t.completed && t.completedAt && new Date(t.completedAt).getTime() > weekWindowMs).length;
      const totalTasks        = tasks.filter(t => t.staffId === s.id).length;
      const taskCompletionRate = totalTasks > 0 ? Math.round(completedTasks / totalTasks * 100) : 0;

      // weekPts = merit points earned THIS calendar week (primary rank driver for competition)
      const weekPts  = merits.filter(m => m.staffId === s.id && new Date(m.createdAt).getTime() > weekWindowMs).reduce((sum, m) => sum + (m.points || 0), 0);
      // meritTotal = all-time for profile display
      const meritTotal = merits.filter(m => m.staffId === s.id).reduce((sum, m) => sum + (m.points || 0), 0);

      const score = Math.round(
        (responseRate * 0.35) +
        (Math.min(weekInteractions.length / 20, 1) * 100 * 0.30) +
        (Math.min(closedCount / 5, 1) * 100 * 0.20) +
        (taskCompletionRate * 0.15)
      );

      const teamInfo = staffTeamMap[s.id] || null;

      return {
        id: s.id, name: s.name, avatar: s.avatar,
        availability: s.availability || 'available',
        teamId:   teamInfo?.teamId   || null,
        teamName: teamInfo?.teamName || null,
        weekInteractions: weekInteractions.length,
        monthInteractions: monthInteractions.length,
        responseRate,
        streak: s.streakData?.currentStreak || 0,
        longestStreak: s.streakData?.longestStreak || 0,
        closedCount, completedTasks, totalTasks, taskCompletionRate,
        weekPts, meritTotal, score,
        rank: 0,
      };
    });

    // Primary sort: THIS WEEK's merit points (weekly competition); secondary: score
    rows.sort((a, b) => b.weekPts - a.weekPts || b.score - a.score);
    rows.forEach((r, i) => { r.rank = i + 1; });

    // Tell the client whether this user has a team (drives team/all toggle visibility)
    const myTeamForUser = req.user.role === 'staff'
      ? teams.find(t => Array.isArray(t.members) && t.members.includes(req.user.id)) || null
      : null;

    res.json({
      rows,
      scopedTeamId,
      scopedTeamName,
      teams: teams.map(t => ({ id: t.id, name: t.name })),
      myTeamId:   myTeamForUser?.id   || null,
      myTeamName: myTeamForUser?.name || null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/ai/leaderboard/reset (admin only) ────────────────────────────────
// Resets all scores/streaks to zero while keeping staff, customers, tasks, diary.
router.post('/leaderboard/reset', adminOnly, async (req, res) => {
  try {
    const now = new Date().toISOString();

    // 1. Clear performance collection
    await writeDB('performance', []);

    // 2. Reset streak data on all staff
    const staff = await readDB('staff');
    await Promise.all(staff.map(s =>
      updateOne('staff', s.id, {
        streakData: { currentStreak: 0, lastActivityDate: null, longestStreak: 0 },
      }).catch(() => {})
    ));

    // 3. Store reset timestamp so leaderboard interaction counts start fresh
    let config = [];
    try { config = await readDB('config'); } catch {}
    const existing = config.find(c => c.key === 'leaderboardResetAt');
    if (existing) {
      await updateOne('config', existing.id, { value: now });
    } else {
      await insertOne('config', { id: require('crypto').randomUUID(), key: 'leaderboardResetAt', value: now });
    }

    console.log(`[Leaderboard] ♻️  Reset by ${req.user.name} at ${now}`);
    res.json({ message: 'Leaderboard reset. All scores and streaks cleared.', resetAt: now });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/ai/sales-insights ─────────────────────────────────────────────────
// Scans diary entries + CRM lead notes → returns product/stock trends + per-lead tips.
router.get('/sales-insights', async (req, res) => {
  try {
    const client = getClient();

    // Gather raw text from diary entries
    const diaryEntries = await readDB('diary').catch(() => []);
    const leads        = await readDB('leads').catch(() => []);
    const customers    = await readDB('customers').catch(() => []);
    const staff        = await readDB('staff').catch(() => []);

    // Build staff map for context
    const staffMap = Object.fromEntries(staff.map(s => [s.id, s.name]));

    // Collect diary text (last 90 days)
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
    const recentDiary = diaryEntries
      .filter(d => d.createdAt > cutoff)
      .map(d => ({
        date:    d.date || d.createdAt?.split('T')[0],
        author:  staffMap[d.staffId] || 'Unknown',
        content: d.content || '',
        aiTasks: (d.aiEntries || []).map(e => e.text || e.task || '').join('; '),
      }));

    // Collect lead notes
    const leadData = leads
      .filter(l => l.isActive !== false)
      .map(l => ({
        name:   l.name,
        stage:  l.stage,
        source: l.source,
        place:  l.place,
        staff:  staffMap[l.staffId] || 'Unknown',
        notes:  (l.notes || []).map(n => n.text).join(' | '),
      }))
      .filter(l => l.notes.length > 0);

    // Customer context (name + tags)
    const customerContext = customers.slice(0, 80).map(c =>
      `${c.name}${c.tags?.length ? ' [' + c.tags.join(',') + ']' : ''}`
    ).join(', ');

    // If no AI client, return rule-based keyword analysis
    if (!client) {
      // Simple keyword extraction without AI
      const allText = [
        ...recentDiary.map(d => d.content + ' ' + d.aiTasks),
        ...leadData.map(l => l.notes),
      ].join(' ').toLowerCase();

      const keywords = ['tiles', 'marble', 'granite', 'flooring', 'sanitaryware',
        'bathroom', 'kitchen', 'wall', 'floor', 'slab', 'vitrified', 'mosaic',
        'outdoor', 'elevation', 'steps'];
      const counts = {};
      keywords.forEach(k => {
        const matches = (allText.match(new RegExp(k, 'g')) || []).length;
        if (matches > 0) counts[k] = matches;
      });

      return res.json({
        trends: Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([item, count]) => ({ item, count, customers: [] })),
        tips: [],
        rawMode: true,
        generatedAt: new Date().toISOString(),
      });
    }

    const diaryText = recentDiary.length
      ? recentDiary.map(d =>
          `[${d.date} · ${d.author}] ${d.content}${d.aiTasks ? ' | Tasks: ' + d.aiTasks : ''}`
        ).join('\n')
      : '(no recent diary entries)';

    const notesText = leadData.length
      ? leadData.map(l =>
          `Lead: ${l.name} (${l.stage}, via ${l.source}${l.place ? ', ' + l.place : ''}, staff: ${l.staff})\nNotes: ${l.notes}`
        ).join('\n\n')
      : '(no lead notes)';

    const prompt = `You are a sales intelligence AI for an Indian interior/flooring/building materials business. Analyze the following diary entries and CRM lead notes to extract product/stock trends and generate actionable sales tips.

=== DIARY ENTRIES (last 90 days) ===
${diaryText}

=== CRM LEAD NOTES ===
${notesText}

=== CUSTOMER DATABASE SNAPSHOT ===
${customerContext}

Your task:
1. Identify which PRODUCTS/STOCK ITEMS are mentioned most (tiles, marble, granite, specific sizes, collections, brands, sanitaryware, etc.)
2. Identify which CUSTOMER TYPES / LOCATIONS / SEGMENTS are buying or interested in what
3. Generate SPECIFIC OUTREACH TIPS — name real leads/customers from the data and suggest what product to pitch to them
4. Flag any RESTOCK ALERTS if demand appears high for something

Respond with ONLY valid JSON in this exact shape:
{
  "trends": [
    { "item": "product name", "count": 12, "customers": ["Name1", "Name2"], "insight": "one-line observation" }
  ],
  "segments": [
    { "segment": "e.g. Builders in Noida", "preferredProducts": ["tiles", "slab"], "tip": "action tip" }
  ],
  "outreachTips": [
    { "leadName": "actual name from data", "product": "product to pitch", "reason": "why this fits them", "message": "short suggested WhatsApp/call message in Hinglish" }
  ],
  "restockAlerts": [
    { "item": "product", "urgency": "high|medium", "reason": "why" }
  ],
  "summary": "2-3 sentence overall insight"
}`;

    const aiRes = await client.messages.create({
      model:      'claude-opus-4-5',
      max_tokens: 2000,
      messages:   [{ role: 'user', content: prompt }],
    });

    let raw = aiRes.content[0].text.trim();
    // Strip markdown code fences if present
    raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const result = JSON.parse(raw);
    result.generatedAt = new Date().toISOString();
    res.json(result);
  } catch (err) {
    console.error('[AI] sales-insights error:', err);
    res.status(500).json({ error: 'Failed to generate insights' });
  }
});

module.exports = router;
