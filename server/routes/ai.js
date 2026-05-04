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

// Model preference order — first valid one wins at runtime
const AI_MODELS = [
  process.env.ANTHROPIC_MODEL,       // if env var set, try it first
  'claude-3-5-haiku-20241022',       // stable, widely available
  'claude-3-haiku-20240307',         // older fallback
].filter(Boolean);

// Once billing fails, skip all API calls for this process lifetime
let _billingFailed = false;

function isBillingErr(err) {
  return err?.status === 400 && String(err?.message || err?.error?.error?.message || '').toLowerCase().includes('credit');
}

function getClient() {
  if (_billingFailed) return null;
  if (!Anthropic || !process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// Wrapper: try models in order, fallback on any model-related error
async function aiCreate(client, params) {
  let lastErr;
  for (const model of AI_MODELS) {
    try {
      return await client.messages.create({ ...params, model });
    } catch (err) {
      if (isBillingErr(err)) { _billingFailed = true; throw err; }
      const status = err?.status;
      // 400/404/422 = bad model name or request — try next
      if (status === 400 || status === 404 || status === 422) {
        lastErr = err;
        continue;
      }
      throw err; // auth error, rate limit, etc — bubble up immediately
    }
  }
  throw lastErr;
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

    const result = await aiCreate(client, {
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
    if (isBillingErr(err)) {
      return res.json({ response: "AI credits have run out. Basic navigation still works — ask me to go to Dashboard, Staff, Customers, Tasks, Diary, or Insights.", navigate: null, action: null });
    }
    console.error('Kamal error:', err);
    res.json({ response: "Having a moment — please try again!", navigate: null, action: null });
  }
});

// ── GET /api/ai/recommendations ───────────────────────────────────────────────
// Uses the ENTIRE database — no date filters. Accuracy grows as data accumulates.
router.get('/recommendations', async (req, res) => {
  try {
    const [staff, customers, interactions, diary, leads, tasks] = await Promise.all([
      readDB('staff'),
      readDB('customers').catch(() => []),
      readDB('interactions').catch(() => []),
      readDB('diary').catch(() => []),
      readDB('leads').catch(() => []),
      readDB('tasks').catch(() => []),
    ]);

    const client = getClient();
    const today = new Date().toISOString().split('T')[0];

    // ── Build full per-staff context from ALL data ──────────────────────────────
    const staffMetrics = staff.map(s => {
      const myDiary        = diary.filter(d => d.staffId === s.id).sort((a, b) => (b.date || b.createdAt || '').localeCompare(a.date || a.createdAt || ''));
      const myLeads        = leads.filter(l => l.staffId === s.id && l.isActive !== false);
      const myCustomers    = customers.filter(c => c.assignedTo === s.id);
      const myTasks        = tasks.filter(t => t.staffId === s.id || t.assignedTo === s.id);
      const myInteractions = interactions.filter(i => i.staffId === s.id);

      // ALL diary entries — newest first, full content for AI
      const allDiaryEntries = myDiary.map(d => ({
        date:    d.date || d.createdAt?.split('T')[0],
        content: (d.content || '').trim(),
        // Flatten AI-extracted tasks/entries
        aiNotes: (d.aiEntries || []).map(e => e.text || e.task || e.description || '').filter(Boolean),
      })).filter(d => d.content);

      // ALL leads with their full note history
      const allLeads = myLeads.map(l => ({
        name:  l.name, phone: l.phone, place: l.place,
        stage: l.stage, source: l.source,
        nextFollowUp: l.nextFollowUp, visitDate: l.visitDate,
        overdue: l.nextFollowUp && l.nextFollowUp < today,
        dueToday: l.nextFollowUp === today,
        notes: (l.notes || []).map(n => n.text).filter(Boolean),
        noPickupCount: l.noPickupCount || 0,
      }));

      // ALL customers with notes + interaction count
      const allCustomers = myCustomers.map(c => ({
        name: c.name, status: c.status, tags: c.tags,
        lastContact: c.lastContact, dealValue: c.dealValue,
        notes: typeof c.notes === 'string' ? c.notes : '',
        interactionCount: myInteractions.filter(i => i.customerId === c.id).length,
      }));

      // Tasks — pending + recently completed
      const pendingTasks    = myTasks.filter(t => !t.completed).map(t => ({ title: t.title, due: t.dueDate, overdue: t.dueDate && t.dueDate < today }));
      const completedTasks  = myTasks.filter(t => t.completed).length;

      // Overdue & due-today counts
      const overdueLeads  = allLeads.filter(l => l.overdue);
      const dueTodayLeads = allLeads.filter(l => l.dueToday);

      // Stage breakdown
      const leadsByStage = {};
      myLeads.forEach(l => { leadsByStage[l.stage] = (leadsByStage[l.stage] || 0) + 1; });

      // Activity score — based on ALL history, grows as data accumulates
      const activityScore = Math.min(100, Math.round(
        Math.min(allDiaryEntries.length * 5, 40) +   // up to 40pts from diary
        Math.min(myLeads.length * 4, 25) +            // up to 25pts from leads
        Math.min(myCustomers.length * 2, 15) +        // up to 15pts from customers
        Math.min(myInteractions.length * 2, 10) +     // up to 10pts from interactions
        Math.min(completedTasks * 3, 10)              // up to 10pts from tasks done
      ));

      return {
        id: s.id, name: s.name, role: s.role,
        activityScore,
        // Diary — send ALL entries; Claude reads Hinglish natively
        totalDiaryEntries: allDiaryEntries.length,
        diaryEntries: allDiaryEntries,   // no limit — full history
        // Leads — full pipeline
        totalLeads: myLeads.length,
        leadsByStage,
        overdueLeads:  overdueLeads.map(l => ({ name: l.name, due: l.nextFollowUp, noPickup: l.noPickupCount })),
        dueTodayLeads: dueTodayLeads.map(l => l.name),
        allLeads,      // full lead list with notes
        // Customers
        totalCustomers: myCustomers.length,
        customers: allCustomers,
        // Tasks
        pendingTasks,
        completedTasksTotal: completedTasks,
        // Interactions
        totalInteractions: myInteractions.length,
      };
    });

    // ── No AI client — rule-based fallback ─────────────────────────────────────
    if (!client) {
      const recommendations = staffMetrics.map(s => {
        const issues = [], strengths = [], actions = [];

        if (s.totalDiaryEntries > 0) strengths.push(`${s.totalDiaryEntries} diary entries logged`);
        else issues.push('No diary entries logged yet');

        if (s.overdueLeads.length > 0) {
          issues.push(`${s.overdueLeads.length} overdue follow-up${s.overdueLeads.length > 1 ? 's' : ''}`);
          actions.push(`Call: ${s.overdueLeads.slice(0, 3).map(l => l.name).join(', ')}`);
        }
        if (s.dueTodayLeads.length > 0) actions.push(`Due today: ${s.dueTodayLeads.slice(0, 3).join(', ')}`);
        if (s.totalLeads > 0) strengths.push(`${s.totalLeads} CRM leads across pipeline`);
        if (s.pendingTasks.filter(t => t.overdue).length > 0) issues.push('Has overdue tasks');
        if (!actions.length) actions.push('Log daily diary entries and keep leads updated');

        return {
          staffId: s.id, staffName: s.name, performanceScore: s.activityScore,
          summary: `${s.totalDiaryEntries} diary entries · ${s.totalLeads} leads · ${s.overdueLeads.length} overdue`,
          strengths, issues, actions,
          priority: issues.length >= 2 ? 'high' : issues.length === 1 ? 'medium' : 'low',
        };
      });
      return res.json({ recommendations, staffMetrics });
    }

    // ── Full AI analysis — entire database, no cutoffs ─────────────────────────
    const prompt = `You are a sales performance AI for an Indian jewellery/fashion/retail business. Analyze the COMPLETE database for each staff member — every diary entry, every CRM lead, every customer, every task. There are NO time filters; use all historical data.

LANGUAGE: Diary entries are in Hinglish (Hindi+English mix). Read them naturally as plain business notes.
Examples: "shop pe aayi" = came to shop, "maal liya" = took goods/made purchase, "AD set" = American Diamond set, "bridal set bheja" = sent bridal set, "follow up karna" = need to follow up.

STAFF DATABASE (complete):
${JSON.stringify(staffMetrics, null, 2)}

Analyze each staff member's FULL history:
- What products/items are being sold or discussed most?
- Which customers/leads are hot, warm, or cold?
- What patterns emerge from the diary entries over time?
- What follow-ups are overdue or urgent?
- How active and effective is this person?

Return ONLY valid JSON array — no markdown, no explanation:
[{
  "staffId": "id",
  "staffName": "name",
  "performanceScore": <0-100, based on total activity volume + lead pipeline + results>,
  "summary": "<1-2 sentences: what they're actively working on, based on actual diary/lead data>",
  "strengths": ["<specific strength derived from real entries — name products, customers, patterns>"],
  "issues": ["<specific gap or risk — overdue leads, silent customers, patterns of concern>"],
  "actions": ["<concrete next step — name real leads/customers where possible, 2-3 items>"],
  "priority": "high|medium|low"
}]`;

    const result = await aiCreate(client, { max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    let raw = result.content[0].text.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    // Extract JSON array even if Claude adds surrounding text
    const arrMatch = raw.match(/\[[\s\S]*\]/);
    if (!arrMatch) throw new Error('AI did not return a valid JSON array');
    const recommendations = JSON.parse(arrMatch[0]);
    return res.json({ recommendations, staffMetrics });
  } catch (err) {
    // Billing / no credits → use rule-based fallback instead of erroring
    if (isBillingErr(err) || _billingFailed) {
      console.warn('[AI] recommendations: billing failed, using rule-based fallback');
      const recommendations = staffMetrics.map(s => {
        const issues = [], strengths = [], actions = [];
        if (s.totalDiaryEntries > 0) strengths.push(`${s.totalDiaryEntries} diary entries logged`);
        else issues.push('No diary entries logged yet');
        if (s.overdueLeads.length > 0) {
          issues.push(`${s.overdueLeads.length} overdue follow-up${s.overdueLeads.length > 1 ? 's' : ''}`);
          actions.push(`Call: ${s.overdueLeads.slice(0, 3).map(l => l.name).join(', ')}`);
        }
        if (s.dueTodayLeads.length > 0) actions.push(`Due today: ${s.dueTodayLeads.slice(0, 3).join(', ')}`);
        if (s.totalLeads > 0) strengths.push(`${s.totalLeads} CRM leads across pipeline`);
        if (s.pendingTasks.filter(t => t.overdue).length > 0) issues.push('Has overdue tasks');
        if (s.totalCustomers > 0) strengths.push(`${s.totalCustomers} customers assigned`);
        if (!actions.length) actions.push('Log daily diary entries and keep leads updated');
        return {
          staffId: s.id, staffName: s.name, performanceScore: s.activityScore,
          summary: `${s.totalDiaryEntries} diary entries · ${s.totalLeads} leads · ${s.overdueLeads.length} overdue`,
          strengths, issues, actions,
          priority: issues.length >= 2 ? 'high' : issues.length === 1 ? 'medium' : 'low',
        };
      });
      return res.json({ recommendations, staffMetrics });
    }
    console.error('[AI] recommendations error:', err);
    res.status(500).json({ error: err?.message || String(err) || 'Failed to generate insights' });
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

// ── GET /api/ai/weekly-report — full-database business report ─────────────────
router.get('/weekly-report', async (req, res) => {
  try {
    const [staff, interactions, customers, tasks, diary, leads] = await Promise.all([
      readDB('staff'),
      readDB('interactions').catch(() => []),
      readDB('customers').catch(() => []),
      readDB('tasks').catch(() => []),
      readDB('diary').catch(() => []),
      readDB('leads').catch(() => []),
    ]);

    const today   = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

    // Build per-staff complete summary — ALL history + recent spotlight
    const staffSummary = staff.map(s => {
      const myDiary        = diary.filter(d => d.staffId === s.id).sort((a, b) => (b.date || b.createdAt || '').localeCompare(a.date || a.createdAt || ''));
      const myLeads        = leads.filter(l => l.staffId === s.id && l.isActive !== false);
      const myInteractions = interactions.filter(i => i.staffId === s.id);
      const myTasks        = tasks.filter(t => t.staffId === s.id || t.assignedTo === s.id);

      // This week's diary vs all-time
      const thisWeekDiary  = myDiary.filter(d => (d.date || d.createdAt?.split('T')[0]) >= weekAgo);
      const allDiaryText   = myDiary.map(d => `[${d.date || d.createdAt?.split('T')[0]}] ${d.content || ''}`).join('\n');

      return {
        name: s.name,
        // All-time stats
        totalDiaryEntries:    myDiary.length,
        totalLeads:           myLeads.length,
        totalCustomers:       customers.filter(c => c.assignedTo === s.id).length,
        totalInteractions:    myInteractions.length,
        totalTasksCompleted:  myTasks.filter(t => t.completed).length,
        // This week spotlight
        newDiaryThisWeek:    thisWeekDiary.length,
        diaryThisWeek:       thisWeekDiary.map(d => d.content || '').filter(Boolean),
        // Pipeline health
        overdueLeads:  myLeads.filter(l => l.nextFollowUp && l.nextFollowUp < today).map(l => l.name),
        dueTodayLeads: myLeads.filter(l => l.nextFollowUp === today).map(l => l.name),
        pendingTasks:  myTasks.filter(t => !t.completed).length,
        leadsByStage:  myLeads.reduce((acc, l) => { acc[l.stage] = (acc[l.stage] || 0) + 1; return acc; }, {}),
        // Full diary for deep analysis
        fullDiary: allDiaryText,
        // All lead notes
        leadNotes: myLeads.flatMap(l => (l.notes || []).map(n => `${l.name}: ${n.text}`)),
      };
    });

    const client = getClient();

    if (!client) {
      const totalDiary = staffSummary.reduce((s, x) => s + x.totalDiaryEntries, 0);
      const totalLeads = staffSummary.reduce((s, x) => s + x.totalLeads, 0);
      const totalOverdue = staffSummary.reduce((s, x) => s + x.overdueLeads.length, 0);
      const lines = [
        `📊 Business Report — ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`,
        `📓 Total diary entries: ${totalDiary} | This week: ${staffSummary.reduce((s,x) => s + x.newDiaryThisWeek, 0)}`,
        `🎯 Active CRM leads: ${totalLeads}`,
        totalOverdue > 0 ? `⚠️ Overdue follow-ups: ${totalOverdue}` : '✅ No overdue follow-ups',
      ];
      staffSummary.forEach(s => {
        if (s.overdueLeads.length) lines.push(`  ${s.name}: call ${s.overdueLeads.slice(0,3).join(', ')}`);
      });
      return res.json({ report: lines.join('\n'), staffSummary });
    }

    const prompt = `You are a business intelligence AI for an Indian retail/jewellery business. Write a comprehensive performance report using the COMPLETE database — all diary entries, leads, customers, and tasks. There are no time restrictions; use all historical data to identify trends.

LANGUAGE: Diary entries mix Hindi and English (Hinglish). Read naturally:
"shop pe aayi" = came to shop | "maal liya/bheja" = goods purchased/sent | "AD set" = American Diamond jewellery | "bridal set" = bridal jewellery set | "whatsapp kiye" = sent on WhatsApp | "order nikla" = order came through | "follow up karna" = need to follow up

COMPLETE TEAM DATA:
${JSON.stringify(staffSummary, null, 2)}

Write a business report covering:
1. Overall business activity (total diary entries, leads, customers across all time)
2. What products/services are being sold most (from diary + lead notes — extract from Hinglish)
3. Key customers and leads — who is active, who needs follow-up
4. This week's activity vs overall momentum
5. Specific overdue follow-ups to action immediately
6. One clear recommendation to grow sales next week

Style: Direct, warm, like a smart business partner. 8-10 sentences. Mention real names from the data.
Respond with ONLY the report text — no JSON, no markdown.`;

    const result = await aiCreate(client, { max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });

    return res.json({ report: result.content[0].text, staffSummary });
  } catch (err) {
    // Billing / no credits → use rule-based report instead of erroring
    if (isBillingErr(err) || _billingFailed) {
      console.warn('[AI] weekly-report: billing failed, using rule-based fallback');
      const today = new Date().toISOString().split('T')[0];
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
      const [staff2, interactions2, customers2, tasks2, diary2, leads2] = await Promise.all([
        readDB('staff'), readDB('interactions').catch(() => []),
        readDB('customers').catch(() => []), readDB('tasks').catch(() => []),
        readDB('diary').catch(() => []), readDB('leads').catch(() => []),
      ]);
      const staffSummary2 = staff2.map(s => {
        const myDiary = diary2.filter(d => d.staffId === s.id);
        const myLeads = leads2.filter(l => l.staffId === s.id && l.isActive !== false);
        const thisWeekDiary = myDiary.filter(d => (d.date || d.createdAt?.split('T')[0]) >= weekAgo);
        return { name: s.name, totalDiaryEntries: myDiary.length, totalLeads: myLeads.length,
          newDiaryThisWeek: thisWeekDiary.length,
          overdueLeads: myLeads.filter(l => l.nextFollowUp && l.nextFollowUp < today).map(l => l.name) };
      });
      const totalDiary = staffSummary2.reduce((s, x) => s + x.totalDiaryEntries, 0);
      const totalLeads = staffSummary2.reduce((s, x) => s + x.totalLeads, 0);
      const totalOverdue = staffSummary2.reduce((s, x) => s + x.overdueLeads.length, 0);
      const lines = [
        `📊 Business Report — ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`,
        `📓 Total diary entries: ${totalDiary} | This week: ${staffSummary2.reduce((s, x) => s + x.newDiaryThisWeek, 0)}`,
        `🎯 Active CRM leads: ${totalLeads}`,
        totalOverdue > 0 ? `⚠️ Overdue follow-ups: ${totalOverdue}` : '✅ No overdue follow-ups',
      ];
      staffSummary2.forEach(s => {
        if (s.overdueLeads.length) lines.push(`  ${s.name}: call ${s.overdueLeads.slice(0, 3).join(', ')}`);
      });
      return res.json({ report: lines.join('\n'), staffSummary: staffSummary2 });
    }
    console.error('[AI] weekly-report error:', err);
    res.status(500).json({ error: err?.message || 'Failed to generate report' });
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
    const [allStaff, interactions, customers, tasks, merits, teams, leads] = await Promise.all([
      readDB('staff'),
      readDB('interactions'),
      readDB('customers'),
      readDB('tasks'),
      readDB('merits').catch(() => []),
      readDB('teams').catch(() => []),
      readDB('leads').catch(() => []),
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

    // Previous week window (7 days before current week window)
    const prevWeekStart = weekWindowMs - 7 * 86400000;
    const prevWeekEnd   = weekWindowMs;

    const rows = staff.map(s => {
      const weekInteractions  = interactions.filter(i => i.staffId === s.id && new Date(i.createdAt).getTime() > weekWindowMs);
      const monthInteractions = interactions.filter(i => i.staffId === s.id && new Date(i.createdAt).getTime() > monthAgo);
      const responded         = weekInteractions.filter(i =>
        i.responded || (i.notes && RESPONSE_KEYWORDS.test(i.notes))
      ).length;
      const responseRate      = weekInteractions.length > 0 ? Math.round(responded / weekInteractions.length * 100) : 0;
      const closedCount       = customers.filter(c => c.assignedTo === s.id && c.status === 'closed' && new Date(c.updatedAt || c.createdAt).getTime() > resetAt).length;

      // Leads closed this week (for Conversion King spotlight)
      const closedThisWeek    = leads.filter(l => l.staffId === s.id && l.stage === 'won' &&
        new Date(l.updatedAt || l.createdAt).getTime() > weekWindowMs).length;

      const completedTasks    = tasks.filter(t => t.staffId === s.id && t.completed && t.completedAt && new Date(t.completedAt).getTime() > weekWindowMs).length;
      const totalTasks        = tasks.filter(t => t.staffId === s.id).length;
      const taskCompletionRate = totalTasks > 0 ? Math.round(completedTasks / totalTasks * 100) : 0;

      // weekPts = merit points earned THIS calendar week (primary rank driver for competition)
      const weekPts  = merits.filter(m => m.staffId === s.id && new Date(m.createdAt).getTime() > weekWindowMs).reduce((sum, m) => sum + (m.points || 0), 0);
      // meritTotal = all-time for profile display
      const meritTotal = merits.filter(m => m.staffId === s.id).reduce((sum, m) => sum + (m.points || 0), 0);

      // Customer count — used for normalised interaction score
      const customerCount = Math.max(customers.filter(c => c.assignedTo === s.id).length, 1);

      // Normalised interaction score: 2 interactions per assigned customer = full score
      // This prevents high-portfolio staff from dominating purely through volume
      const normalisedInteractionScore = Math.min((weekInteractions.length / customerCount) / 2, 1) * 100;

      const score = Math.round(
        (responseRate * 0.35) +
        (normalisedInteractionScore * 0.30) +
        (Math.min(closedCount / 5, 1) * 100 * 0.20) +
        (taskCompletionRate * 0.15)
      );

      // Previous week score (for Most Improved spotlight)
      const prevWeekInteractions = interactions.filter(i => i.staffId === s.id && new Date(i.createdAt).getTime() >= prevWeekStart && new Date(i.createdAt).getTime() < prevWeekEnd);
      const prevResponded        = prevWeekInteractions.filter(i => i.responded || (i.notes && RESPONSE_KEYWORDS.test(i.notes))).length;
      const prevResponseRate     = prevWeekInteractions.length > 0 ? Math.round(prevResponded / prevWeekInteractions.length * 100) : 0;
      const prevClosedCount      = customers.filter(c => c.assignedTo === s.id && c.status === 'closed' && new Date(c.updatedAt || c.createdAt).getTime() >= prevWeekStart && new Date(c.updatedAt || c.createdAt).getTime() < prevWeekEnd).length;
      const prevCompletedTasks   = tasks.filter(t => t.staffId === s.id && t.completed && t.completedAt && new Date(t.completedAt).getTime() >= prevWeekStart && new Date(t.completedAt).getTime() < prevWeekEnd).length;
      const prevTaskRate         = totalTasks > 0 ? Math.round(prevCompletedTasks / totalTasks * 100) : 0;
      const prevNormInteraction  = Math.min((prevWeekInteractions.length / customerCount) / 2, 1) * 100;
      const prevScore = Math.round(
        (prevResponseRate * 0.35) +
        (prevNormInteraction * 0.30) +
        (Math.min(prevClosedCount / 5, 1) * 100 * 0.20) +
        (prevTaskRate * 0.15)
      );
      const weekDelta = score - prevScore;

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
        closedCount, closedThisWeek, completedTasks, totalTasks, taskCompletionRate,
        weekPts, meritTotal, score, weekDelta, customerCount,
        rank: 0,
      };
    });

    // Primary sort: THIS WEEK's merit points (weekly competition); secondary: score
    rows.sort((a, b) => b.weekPts - a.weekPts || b.score - a.score);
    rows.forEach((r, i) => { r.rank = i + 1; });

    // ── Three-track spotlights ─────────────────────────────────────────────────
    // Conversion King: most leads closed this week
    const conversionKing = [...rows].sort((a, b) => b.closedThisWeek - a.closedThisWeek)[0] || null;

    // Consistency Crown: best response rate (min 10 interactions this week)
    const eligibleForCrown = rows.filter(r => r.weekInteractions >= 10);
    const consistencyCrown = eligibleForCrown.length > 0
      ? [...eligibleForCrown].sort((a, b) => b.responseRate - a.responseRate)[0]
      : null;

    // Most Improved: biggest positive delta vs previous week
    const mostImproved = [...rows].sort((a, b) => b.weekDelta - a.weekDelta)[0] || null;

    // Hall of Fame: staff who have held rank #1 for 3+ consecutive weeks
    // Stored in config collection under key 'leaderboardHallOfFame'
    let hallOfFame = [];
    try {
      const cfg = await readDB('config');
      const hofEntry = cfg.find(c => c.key === 'leaderboardHallOfFame');
      if (hofEntry) hallOfFame = JSON.parse(hofEntry.value || '[]');
    } catch {}

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
      spotlights: {
        conversionKing:  conversionKing  ? { id: conversionKing.id,  name: conversionKing.name,  avatar: conversionKing.avatar,  value: conversionKing.closedThisWeek,  label: 'leads closed this week' } : null,
        consistencyCrown: consistencyCrown ? { id: consistencyCrown.id, name: consistencyCrown.name, avatar: consistencyCrown.avatar, value: consistencyCrown.responseRate,   label: '% response rate' } : null,
        mostImproved:    mostImproved    ? { id: mostImproved.id,    name: mostImproved.name,    avatar: mostImproved.avatar,    value: mostImproved.weekDelta,          label: 'pts improvement' } : null,
      },
      hallOfFame,
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
// 100% rule-based — zero AI tokens consumed. Keyword scan + stage-based logic.
router.get('/sales-insights', async (req, res) => {
  try {
    // ── Load data ─────────────────────────────────────────────────────────────
    let diaryEntries = await readDB('diary').catch(() => []);
    let leads        = await readDB('leads').catch(() => []);
    let customers    = await readDB('customers').catch(() => []);
    const staff      = await readDB('staff').catch(() => []);

    // ── Staff-scoped: only show their own entries ─────────────────────────────
    if (req.user.role === 'staff') {
      diaryEntries = diaryEntries.filter(d => d.staffId === req.user.id);
      leads        = leads.filter(l => l.staffId === req.user.id);
      const interactions = await readDB('interactions').catch(() => []);
      const myCustomerIds = new Set([
        ...customers.filter(c => c.assignedTo === req.user.id || c.assignedStaff === req.user.id).map(c => c.id),
        ...interactions.filter(i => i.staffId === req.user.id).map(i => i.customerId),
      ]);
      customers = customers.filter(c => myCustomerIds.has(c.id));
    }

    // ── Product keyword dictionary (display name → search aliases) ────────────
    const PRODUCT_DICT = {
      'AD Set':       ['ad set', 'american diamond set', 'a.d. set', 'ad ka set', 'ad earring', 'ad necklace'],
      'Bridal Set':   ['bridal set', 'bridal', 'shaadi ka set', 'wedding set', 'dulhan set'],
      'Gold':         ['gold', 'sona', 'gold set', 'gold earring', 'gold necklace', 'gold ring'],
      'Diamond':      ['diamond', 'heera', 'diamond set', 'diamond earring', 'diamond ring'],
      'Earrings':     ['earring', 'earrings', 'jhumka', 'jhumki', 'bali', 'tops', 'studs'],
      'Necklace':     ['necklace', 'haar', 'mala', 'necklace set', 'choker', 'hasnuli'],
      'Bracelet':     ['bracelet', 'bangle', 'bangles', 'kangan', 'kada', 'churi', 'churiya'],
      'Ring':         ['ring', 'rings', 'angoothi', 'finger ring'],
      'Pendant':      ['pendant', 'mangalsutra', 'mangal sutra', 'locket'],
      'Anklet':       ['anklet', 'payal', 'pajeb'],
      'Collection':   ['collection', 'new collection', 'latest collection', 'naya collection', 'new stock'],
      'Customized':   ['customize', 'customized', 'customize karke', 'custom order', 'banwana', 'banvana'],
      'Saree':        ['saree', 'sarees', 'sari', 'silk saree', 'cotton saree'],
      'Suit':         ['suit', 'suits', 'salwar suit', 'salwar kameez', 'churidar'],
      'Lehenga':      ['lehenga', 'lehnga', 'ghaghra'],
      'Fabric':       ['fabric', 'kapda', 'kapde', 'cloth', 'material'],
      'Kurti':        ['kurti', 'kurtis'],
      'Tiles':        ['tile', 'tiles'],
      'Marble':       ['marble', 'marbles', 'sangmarmar'],
      'Granite':      ['granite'],
      'Flooring':     ['flooring', 'floor'],
      'Sample':       ['sample', 'samples', 'namoona'],
      'Design':       ['design', 'designs', 'naya design', 'pattern', 'latest design'],
    };

    // ── Demand / urgency signals ──────────────────────────────────────────────
    const DEMAND_RE = /chahiye|chahte|chahta|chahti|order karo|mangwao|stock nahi|nahi hai|out of stock|khatam ho|available nahi|dhoondh raha|zaroorat|need|want urgently|urgent order|jaldi chahiye/;

    // ── Build text corpus with customer name context ───────────────────────────
    const corpus = [
      ...diaryEntries.map(d => ({
        text: (d.content || '') + ' ' + (d.aiEntries || []).map(e => e.text || e.task || '').join(' '),
        customerName: d.customerName || null,
      })),
      ...leads.filter(l => l.isActive !== false).map(l => ({
        text: (l.notes || []).map(n => n.text || '').join(' '),
        customerName: l.name || null,
      })),
      ...customers.map(c => ({
        text: typeof c.notes === 'string' ? c.notes : '',
        customerName: c.name || null,
      })),
    ].filter(e => e.text.trim());

    // ── Trend analysis ────────────────────────────────────────────────────────
    const trendMap = {};
    const demandMap = {};

    for (const entry of corpus) {
      const lc = entry.text.toLowerCase();
      const hasDemand = DEMAND_RE.test(lc);

      for (const [product, aliases] of Object.entries(PRODUCT_DICT)) {
        if (!aliases.some(alias => lc.includes(alias))) continue;
        if (!trendMap[product]) trendMap[product] = { count: 0, customers: new Set(), demandCount: 0 };
        trendMap[product].count++;
        if (entry.customerName) trendMap[product].customers.add(entry.customerName);
        if (hasDemand) { trendMap[product].demandCount++; demandMap[product] = (demandMap[product] || 0) + 1; }
      }
    }

    const trends = Object.entries(trendMap)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 10)
      .map(([item, v]) => {
        const custList = [...v.customers].slice(0, 5);
        let insight = `Mentioned ${v.count} time${v.count !== 1 ? 's' : ''}`;
        if (v.demandCount >= 2)    insight += ' — high demand signal';
        else if (custList.length >= 3) insight += ` across ${custList.length} customers`;
        return { item, count: v.count, customers: custList, insight };
      });

    // ── Segments by lead source ───────────────────────────────────────────────
    const sourceMap = {};
    for (const lead of leads.filter(l => l.isActive !== false)) {
      const src = (lead.source || 'Direct').replace(/_/g, ' ');
      if (!sourceMap[src]) sourceMap[src] = { count: 0, products: {} };
      sourceMap[src].count++;
      const notesLc = (lead.notes || []).map(n => n.text || '').join(' ').toLowerCase();
      for (const [prod, aliases] of Object.entries(PRODUCT_DICT)) {
        if (aliases.some(a => notesLc.includes(a)))
          sourceMap[src].products[prod] = (sourceMap[src].products[prod] || 0) + 1;
      }
    }
    const segments = Object.entries(sourceMap)
      .filter(([, v]) => v.count >= 2)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 5)
      .map(([source, v]) => {
        const topProds = Object.entries(v.products).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p]) => p);
        return {
          segment: `${source} (${v.count} lead${v.count !== 1 ? 's' : ''})`,
          preferredProducts: topProds.length ? topProds : [trends[0]?.item || 'General'],
          tip: topProds.length
            ? `Focus ${source} leads on ${topProds[0]} — most requested by this group`
            : `${v.count} leads from ${source} — pitch your top sellers`,
        };
      });

    // ── Outreach tips: leads in warm/hot pipeline stages ─────────────────────
    const today = new Date().toISOString().split('T')[0];
    const HOT_STAGES  = new Set(['visit_scheduled', 'negotiating']);
    const WARM_STAGES = new Set(['interested', 'catalogue_seen', 'follow_up']);
    const STAGE_LABELS = {
      new: 'New', contacted: 'Contacted', interested: 'Interested',
      catalogue_seen: 'Catalogue seen', follow_up: 'Follow-up pending',
      visit_scheduled: 'Visit scheduled', negotiating: 'Negotiating',
      won: 'Won', lost: 'Lost',
    };

    const topProduct = trends[0]?.item || 'our latest collection';

    const outreachTips = leads
      .filter(l => l.isActive !== false && (HOT_STAGES.has(l.stage) || WARM_STAGES.has(l.stage)))
      .sort((a, b) => {
        const aScore = (HOT_STAGES.has(a.stage) ? 2 : 1) + (a.nextFollowUp && a.nextFollowUp <= today ? 1 : 0);
        const bScore = (HOT_STAGES.has(b.stage) ? 2 : 1) + (b.nextFollowUp && b.nextFollowUp <= today ? 1 : 0);
        return bScore - aScore;
      })
      .slice(0, 6)
      .map(lead => {
        const notesLc = (lead.notes || []).map(n => n.text || '').join(' ').toLowerCase();
        let pitch = topProduct;
        for (const [prod, aliases] of Object.entries(PRODUCT_DICT)) {
          if (aliases.some(a => notesLc.includes(a))) { pitch = prod; break; }
        }
        const firstName  = (lead.name || 'ji').split(' ')[0];
        const isOverdue  = lead.nextFollowUp && lead.nextFollowUp < today;
        const isHot      = HOT_STAGES.has(lead.stage);
        const stageLabel = STAGE_LABELS[lead.stage] || lead.stage || 'Active';
        return {
          leadName: lead.name,
          product:  pitch,
          reason:   isOverdue
            ? `Follow-up overdue since ${lead.nextFollowUp} (${stageLabel})`
            : `${isHot ? 'Hot lead' : 'Warm lead'} — ${stageLabel}`,
          message: isHot
            ? `Hi ${firstName} ji! ${pitch} ke baare mein baat karni thi — kya aaj ya kal ka time milega?`
            : `Hi ${firstName} ji, ${pitch.toLowerCase()} ka naya collection aa gaya hai — aapko zaroor pasand aayega! Kab aayenge milne?`,
        };
      });

    // ── Restock alerts: products with demand signals ──────────────────────────
    const restockAlerts = Object.entries(demandMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 4)
      .map(([item, count]) => ({
        item,
        urgency: count >= 3 ? 'high' : 'medium',
        reason:  `${count} entr${count !== 1 ? 'ies' : 'y'} with demand/urgency signals`,
      }));

    // ── Summary ───────────────────────────────────────────────────────────────
    const activeLeads = leads.filter(l => l.isActive !== false).length;
    const wonLeads    = leads.filter(l => l.stage === 'won').length;
    const convRate    = activeLeads > 0 ? Math.round((wonLeads / activeLeads) * 100) : 0;
    const topItems    = trends.slice(0, 3).map(t => t.item).join(', ');
    const summary = [
      `Analysed ${diaryEntries.length} diary entries, ${activeLeads} active leads, ${customers.length} customers.`,
      topItems ? `Most discussed: ${topItems}.` : '',
      outreachTips.length ? `${outreachTips.length} leads ready for outreach.` : '',
      convRate > 0 ? `Conversion rate: ${convRate}%.` : '',
    ].filter(Boolean).join(' ');

    return res.json({ trends, segments, outreachTips, restockAlerts, summary, rawMode: true, generatedAt: new Date().toISOString() });

  } catch (err) {
    console.error('[Sales Insights] error:', err);
    res.status(500).json({ error: err?.message || 'Failed to generate insights' });
  }
});

module.exports = router;
