/**
 * fraud.js — Anti-farming / anti-fraud detection for merit and task systems.
 *
 * GET  /api/fraud/detect         (admin only) — scan & return live alerts
 * POST /api/fraud/fine           (admin only) — deduct -10 merit points from staff
 * POST /api/fraud/dismiss        (admin only) — dismiss an alert (logged, not actioned)
 * GET  /api/fraud/records        (admin only) — history of fines + dismissals
 */

const express         = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne } = require('../utils/db');
const { authMiddleware }    = require('../middleware/auth');
const { awardMerit }        = require('../utils/merits');

const router = express.Router();
router.use(authMiddleware);

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

function dateStr(iso) { return (iso || '').substring(0, 10); }

// ── Content-quality helpers ───────────────────────────────────────────────────

/** Jaccard word-overlap similarity between two strings (0–1). */
function jaccardSimilarity(a, b) {
  const words = s => new Set((s || '').toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 2));
  const A = words(a), B = words(b);
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let intersection = 0;
  for (const w of A) if (B.has(w)) intersection++;
  return intersection / (A.size + B.size - intersection);
}

/**
 * Scores a diary entry 0–100 on content quality.
 * High score = genuine, detailed entry. Low score = hollow / copy-paste bait.
 */
function diaryQualityScore(entry) {
  const text = (entry.text || entry.notes || entry.entry || entry.content || '').trim();
  let score = 0;

  // Length — up to 35 pts (proportional; full score at 200 chars)
  score += Math.min(35, Math.floor((text.length / 200) * 35));

  // Customer resolved (not General / unmatched) — 25 pts
  const hasCustomer = !!(entry.resolvedCustomer || entry.customerName || entry.matchedCustomer);
  if (hasCustomer) score += 25;

  // Action items present — 20 pts
  const actionItems = entry.actionItems || entry.actions || [];
  if (Array.isArray(actionItems) && actionItems.length > 0) score += 20;
  // Also check text for common action keywords
  else if (/follow.?up|call back|send|deliver|collect|visit|remind|confirm/i.test(text)) score += 10;

  // Amounts / monetary values mentioned — 15 pts
  if (/₹|rs\.?\s*\d|rupee|\bpaid\b|\bpayment\b|\badvance\b|\d{4,}/.test(text)) score += 15;

  // Sentiment / tone present (not empty boilerplate) — 5 pts
  if (entry.sentiment && entry.sentiment !== 'neutral' && entry.sentiment !== 'unknown') score += 5;

  return Math.min(100, score);
}

function isoWeek(iso) {
  const date = new Date(iso);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 4 - (date.getDay() || 7));
  const yearStart = new Date(date.getFullYear(), 0, 1);
  return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
}
function weekKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-W${String(isoWeek(iso)).padStart(2, '0')}`;
}

// ── GET /api/fraud/detect ─────────────────────────────────────────────────────
router.get('/detect', adminOnly, async (req, res) => {
  try {
    const [tasks, merits, diary, staff, records] = await Promise.all([
      readDB('tasks').catch(() => []),
      readDB('merits').catch(() => []),
      readDB('diary').catch(() => []),
      readDB('staff').catch(() => []),
      readDB('fraud_records').catch(() => []),
    ]);

    const staffMap = Object.fromEntries(staff.map(s => [s.id, s.name]));
    const alerts   = [];
    let   alertIdx = 0;
    const mkId = () => `fraud_${++alertIdx}_${Date.now()}`;

    // Build repeat lookup: staffId+type → array of past week keys where a fine was issued
    const finesByKey = {};
    for (const r of records) {
      if (r.action !== 'fine') continue;
      const k = `${r.staffId}::${r.fraudType}`;
      if (!finesByKey[k]) finesByKey[k] = [];
      finesByKey[k].push(r.week || '');
    }
    function repeatInfo(staffId, type) {
      const k     = `${staffId}::${type}`;
      const weeks = finesByKey[k] || [];
      return { isRepeat: weeks.length > 0, weekCount: weeks.length + 1, pastWeeks: weeks };
    }

    // ── 1. TASK SPEED FARMING ─────────────────────────────────────────────────
    for (const t of tasks) {
      if (!t.completed || !t.completedAt || !t.createdAt) continue;
      const createdMs   = new Date(t.createdAt).getTime();
      const completedMs = new Date(t.completedAt).getTime();
      const diffMins    = (completedMs - createdMs) / 60000;
      // Flag clock skew — completedAt before createdAt means corrupted data
      if (diffMins < 0) {
        const name = staffMap[t.staffId] || t.staffId;
        alerts.push({
          id: mkId(), staffId: t.staffId, staffName: name,
          type: 'clock_skew', severity: 'medium',
          title: 'Task timestamp anomaly',
          detail: `"${t.title}" was marked complete before it was created (${Math.abs(Math.round(diffMins))} min gap). This indicates a device clock error or manual data tampering.`,
          evidence: `Task: "${t.title}" · Created: ${t.createdAt.substring(0,16)} · Completed: ${t.completedAt.substring(0,16)}`,
          taskId: t.id, taskTitle: t.title, detectedAt: new Date().toISOString(),
        });
        continue;
      }
      // Flag only if sub-2-min AND task notes are absent/hollow (genuine work leaves a note)
      const hasNotes = (t.notes || t.description || '').trim().length > 10;
      if (diffMins >= 0 && diffMins < 2 && !hasNotes) {
        const name = staffMap[t.staffId] || t.staffId;
        const ri   = repeatInfo(t.staffId, 'task_speed');
        alerts.push({
          id: mkId(), staffId: t.staffId, staffName: name,
          type: 'task_speed', severity: 'high',
          title: 'Lightning task completion (no notes)',
          detail: `"${t.title}" was created and completed within ${Math.round(diffMins * 10) / 10} min with no task notes. Genuine work always leaves some trace — sub-2-minute hollow completions are a strong farming signal.`,
          evidence: `Task: "${t.title}" · Created: ${t.createdAt.substring(0,16)} · Completed: ${t.completedAt.substring(0,16)}`,
          taskId: t.id, taskTitle: t.title,
          ...ri, detectedAt: new Date().toISOString(),
        });
      }
    }

    // ── 2. TASK BURST ─────────────────────────────────────────────────────────
    const completedByStaff = {};
    for (const t of tasks) {
      if (!t.completed || !t.completedAt) continue;
      const sid = t.completedBy || t.staffId;
      if (!sid) continue;
      if (!completedByStaff[sid]) completedByStaff[sid] = [];
      completedByStaff[sid].push({ ts: new Date(t.completedAt).getTime(), title: t.title, id: t.id });
    }
    for (const [sid, entries] of Object.entries(completedByStaff)) {
      entries.sort((a, b) => a.ts - b.ts);
      for (let i = 0; i < entries.length; i++) {
        const window = entries.filter(e => e.ts - entries[i].ts <= 2 * 3600000);
        if (window.length > 10) {
          // Quality gate: only flag if majority of burst tasks are hollow (no notes, no customer)
          const windowTasks = window.map(e => tasks.find(t => t.id === e.id)).filter(Boolean);
          const hollowCount = windowTasks.filter(t =>
            !(t.notes || t.description || '').trim() && !(t.customerId || t.customerName)
          ).length;
          const hollowRatio = windowTasks.length > 0 ? hollowCount / windowTasks.length : 0;
          if (hollowRatio < 0.6) break; // Mostly documented tasks — batch entry by a diligent worker, skip
          const name = staffMap[sid] || sid;
          const ri   = repeatInfo(sid, 'task_burst');
          alerts.push({
            id: mkId(), staffId: sid, staffName: name,
            type: 'task_burst', severity: 'high',
            title: 'Hollow task burst',
            detail: `${window.length} tasks completed within 2 hours — ${hollowCount} of them have no notes and no customer link (${Math.round(hollowRatio * 100)}% hollow). A legitimate burst of catch-up entries would have documented details.`,
            evidence: `Window start: ${new Date(entries[i].ts).toLocaleString('en-IN')} · Tasks: ${window.slice(0,3).map(e => `"${e.title}"`).join(', ')}${window.length > 3 ? ` +${window.length - 3} more` : ''}`,
            taskTitles: window.slice(0, 6).map(e => e.title),
            ...ri, detectedAt: new Date().toISOString(),
          });
          break;
        }
      }
    }

    // ── 3. TASK TOGGLE ABUSE ──────────────────────────────────────────────────
    const meritByTask = {};
    for (const m of merits) {
      if (m.category !== 'task' || !m.relatedId) continue;
      if (!meritByTask[m.relatedId]) meritByTask[m.relatedId] = [];
      meritByTask[m.relatedId].push(m);
    }
    for (const [taskId, events] of Object.entries(meritByTask)) {
      if (events.length < 2) continue;
      const sid  = events[0].staffId;
      const name = staffMap[sid] || sid;
      const task = tasks.find(t => t.id === taskId);
      const ri   = repeatInfo(sid, 'task_toggle');
      alerts.push({
        id: mkId(), staffId: sid, staffName: name,
        type: 'task_toggle', severity: 'medium',
        title: 'Task toggle farming',
        detail: `Task "${task?.title || taskId}" earned merit ${events.length} separate times. The only way this happens is repeatedly toggling a task complete → incomplete → complete to collect points each time.`,
        evidence: events.map(e => `+${e.points} on ${e.createdAt.substring(0,10)}`).join(' · '),
        taskId, taskTitle: task?.title || taskId,
        ...ri, detectedAt: new Date().toISOString(),
      });
    }

    // ── 4. MERIT DAILY HAUL ───────────────────────────────────────────────────
    const meritByStaffDay = {};
    for (const m of merits) {
      if (m.category === 'manual') continue;
      const key = `${m.staffId}::${dateStr(m.createdAt)}`;
      meritByStaffDay[key] = (meritByStaffDay[key] || 0) + (m.points || 0);
    }
    for (const [key, total] of Object.entries(meritByStaffDay)) {
      if (total <= 25) continue;
      const [sid, day] = key.split('::');
      const name = staffMap[sid] || sid;
      const ri   = repeatInfo(sid, 'merit_haul');
      alerts.push({
        id: mkId(), staffId: sid, staffName: name,
        type: 'merit_haul', severity: total > 45 ? 'high' : 'medium',
        title: 'Abnormal daily merit haul',
        detail: `Earned ${total} auto-merit points in a single day. A productive staff member doing catch-up entry can reach 20–25 pts — scores above 25 suggest bulk task farming without real work behind it.`,
        evidence: `Date: ${day} · Total: ${total} pts from task/auto sources`,
        ...ri, detectedAt: new Date().toISOString(),
      });
    }

    // ── 5. REPEAT MANUAL AWARDS ───────────────────────────────────────────────
    const manualByStaffDay = {};
    for (const m of merits) {
      if (m.category !== 'manual') continue;
      const key = `${m.staffId}::${dateStr(m.createdAt)}`;
      manualByStaffDay[key] = (manualByStaffDay[key] || 0) + 1;
    }
    for (const [key, count] of Object.entries(manualByStaffDay)) {
      if (count < 5) continue;
      const [sid, day] = key.split('::');
      const name = staffMap[sid] || sid;
      const ri   = repeatInfo(sid, 'merit_repeat');
      alerts.push({
        id: mkId(), staffId: sid, staffName: name,
        type: 'merit_repeat', severity: 'medium',
        title: 'Excessive manual merit awards',
        detail: `${count} manual merit awards received in a single day. This suggests admin favouritism, collusion, or an admin account being misused to inflate a specific staff member's score.`,
        evidence: `Date: ${day}`,
        ...ri, detectedAt: new Date().toISOString(),
      });
    }

    // ── 6. DUPLICATE REASON FARMING ───────────────────────────────────────────
    const meritsByStaff = {};
    for (const m of merits) {
      if (!m.staffId) continue;
      if (!meritsByStaff[m.staffId]) meritsByStaff[m.staffId] = [];
      meritsByStaff[m.staffId].push(m);
    }
    for (const [sid, events] of Object.entries(meritsByStaff)) {
      const reasonCounts = {};
      for (const e of events) {
        const r = (e.reason || '').toLowerCase().trim();
        if (!r || r.length < 5) continue;
        reasonCounts[r] = (reasonCounts[r] || 0) + 1;
      }
      for (const [reason, count] of Object.entries(reasonCounts)) {
        if (count < 5) continue;
        const name = staffMap[sid] || sid;
        const ri   = repeatInfo(sid, 'merit_duplicate_reason');
        alerts.push({
          id: mkId(), staffId: sid, staffName: name,
          type: 'merit_duplicate_reason', severity: 'low',
          title: 'Repeated merit reason',
          detail: `The reason "${reason}" appears ${count} times in merit history. Genuine merit reasons vary — identical copy-pasted reasons suggest scripted or artificially repeated activity.`,
          evidence: `Reason used ${count}× in merit history`,
          ...ri, detectedAt: new Date().toISOString(),
        });
      }
    }

    // ── 7. LOOP TASK ABUSE ────────────────────────────────────────────────────
    const loopMeritByDay = {};
    for (const m of merits) {
      if (!m.reason?.startsWith('Loop update:') || !m.relatedId) continue;
      const key = `${m.staffId}::${m.relatedId}::${dateStr(m.createdAt)}`;
      loopMeritByDay[key] = (loopMeritByDay[key] || 0) + 1;
    }
    for (const [key, count] of Object.entries(loopMeritByDay)) {
      if (count < 3) continue;
      const [sid, taskId, day] = key.split('::');
      const name = staffMap[sid] || sid;
      const task = tasks.find(t => t.id === taskId);
      const ri   = repeatInfo(sid, 'loop_abuse');
      alerts.push({
        id: mkId(), staffId: sid, staffName: name,
        type: 'loop_abuse', severity: 'high',
        title: 'Loop task completion abuse',
        detail: `Loop task "${task?.title || taskId}" was merit-awarded ${count} times on the same day. Loop tasks are designed to award merit once per interval — multiple same-day awards mean the loop was artificially reset.`,
        evidence: `Date: ${day} · Task: "${task?.title || taskId}" · Awarded ${count}×`,
        taskId, taskTitle: task?.title || taskId,
        ...ri, detectedAt: new Date().toISOString(),
      });
    }

    // ── 8. THIN DIARY BURST — hollow entries in bulk ──────────────────────────
    // Staff who do after-hours catch-up entry write detailed notes; farmers write nothing.
    const diaryByStaffDay = {};
    for (const d of diary) {
      const day = dateStr(d.date || d.createdAt);
      const key = `${d.staffId}::${day}`;
      if (!diaryByStaffDay[key]) diaryByStaffDay[key] = [];
      diaryByStaffDay[key].push(d);
    }
    for (const [key, entries] of Object.entries(diaryByStaffDay)) {
      if (entries.length < 3) continue; // Need at least 3 same-day entries to evaluate
      const thinEntries = entries.filter(e => diaryQualityScore(e) < 25);
      if (thinEntries.length < 3) continue; // At least 3 must be hollow
      const [sid, day] = key.split('::');
      const name = staffMap[sid] || sid;
      const ri   = repeatInfo(sid, 'thin_diary_burst');
      const avgScore = Math.round(thinEntries.reduce((s, e) => s + diaryQualityScore(e), 0) / thinEntries.length);
      alerts.push({
        id: mkId(), staffId: sid, staffName: name,
        type: 'thin_diary_burst', severity: 'medium',
        title: 'Hollow diary burst',
        detail: `${thinEntries.length} of ${entries.length} diary entries on ${day} scored below 25/100 on content quality (avg: ${avgScore}/100). Genuine after-hours catch-up entries have real customer names, action items, and amounts — these are empty shells.`,
        evidence: `Date: ${day} · ${thinEntries.length} thin entries · avg quality ${avgScore}/100`,
        ...ri, detectedAt: new Date().toISOString(),
      });
    }

    // ── 9. COPY-PASTE DIARY — duplicate content across entries ────────────────
    const diaryByStaff = {};
    for (const d of diary) {
      if (!d.staffId) continue;
      if (!diaryByStaff[d.staffId]) diaryByStaff[d.staffId] = [];
      diaryByStaff[d.staffId].push(d);
    }
    const seenCopyPaste = new Set();
    for (const [sid, entries] of Object.entries(diaryByStaff)) {
      // Only check last 60 days to keep this O(n²) manageable
      const cutoff = Date.now() - 60 * 86400000;
      const recent = entries.filter(e => new Date(e.date || e.createdAt).getTime() > cutoff);
      for (let i = 0; i < recent.length; i++) {
        for (let j = i + 1; j < recent.length; j++) {
          const a = recent[i], b = recent[j];
          const textA = (a.text || a.notes || a.entry || a.content || '').trim();
          const textB = (b.text || b.notes || b.entry || b.content || '').trim();
          if (textA.length < 30 || textB.length < 30) continue; // skip empty entries
          const sim = jaccardSimilarity(textA, textB);
          if (sim >= 0.65) {
            const dedupKey = `${sid}::${[a.id, b.id].sort().join(':')}`;
            if (seenCopyPaste.has(dedupKey)) continue;
            seenCopyPaste.add(dedupKey);
            const name = staffMap[sid] || sid;
            const ri   = repeatInfo(sid, 'copy_paste_diary');
            const dateA = dateStr(a.date || a.createdAt);
            const dateB = dateStr(b.date || b.createdAt);
            alerts.push({
              id: mkId(), staffId: sid, staffName: name,
              type: 'copy_paste_diary', severity: 'high',
              title: 'Copy-paste diary entries',
              detail: `Two diary entries share ${Math.round(sim * 100)}% word overlap — strongly suggesting copy-pasted content. Genuine diary entries describe different customers, visits, and conversations each day.`,
              evidence: `Entry on ${dateA} vs entry on ${dateB} · ${Math.round(sim * 100)}% similarity`,
              ...ri, detectedAt: new Date().toISOString(),
            });
            break; // one alert per person is enough
          }
        }
      }
    }

    // ── 10. ALL-GENERAL BULK — no customer resolution across many entries ──────
    // Staff who write real diary entries match real customers. If every entry in a streak
    // goes to "General" (unmatched), the staff member is likely fabricating activity.
    const generalCountByStaff = {};
    for (const d of diary) {
      if (!d.staffId) continue;
      const isGeneral = !d.resolvedCustomer && !d.customerName && !d.matchedCustomer;
      if (!isGeneral) continue;
      generalCountByStaff[d.staffId] = (generalCountByStaff[d.staffId] || 0) + 1;
    }
    // Also get total diary entries per staff to compute ratio
    const totalDiaryByStaff = {};
    for (const d of diary) {
      if (!d.staffId) continue;
      totalDiaryByStaff[d.staffId] = (totalDiaryByStaff[d.staffId] || 0) + 1;
    }
    for (const [sid, generalCount] of Object.entries(generalCountByStaff)) {
      if (generalCount < 5) continue; // Need a meaningful pattern
      const total = totalDiaryByStaff[sid] || generalCount;
      const ratio = generalCount / total;
      if (ratio < 0.80) continue; // Only flag if >80% of all entries are unmatched
      const name = staffMap[sid] || sid;
      const ri   = repeatInfo(sid, 'all_general_bulk');
      alerts.push({
        id: mkId(), staffId: sid, staffName: name,
        type: 'all_general_bulk', severity: 'medium',
        title: 'No customer resolutions in diary',
        detail: `${generalCount} of ${total} diary entries (${Math.round(ratio * 100)}%) match no real customer — they all fall under "General". Staff who actually visit and talk to customers get customer matches. This pattern suggests fabricated activity without real customer interaction.`,
        evidence: `${generalCount} unmatched entries out of ${total} total · ${Math.round(ratio * 100)}% general rate`,
        ...ri, detectedAt: new Date().toISOString(),
      });
    }

    // ── Sort: repeats first, then high → medium → low ─────────────────────────
    const SEV = { high: 0, medium: 1, low: 2 };
    alerts.sort((a, b) => {
      const rd = (b.isRepeat ? 1 : 0) - (a.isRepeat ? 1 : 0);
      if (rd !== 0) return rd;
      const sd = SEV[a.severity] - SEV[b.severity];
      return sd !== 0 ? sd : a.staffName.localeCompare(b.staffName);
    });

    res.json({ alerts, scannedAt: new Date().toISOString(), total: alerts.length });
  } catch (err) {
    console.error('[Fraud] detect error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/fraud/fine ──────────────────────────────────────────────────────
router.post('/fine', adminOnly, async (req, res) => {
  try {
    const { staffId, fraudType, alertTitle, notes } = req.body;
    if (!staffId || !fraudType) return res.status(400).json({ error: 'staffId and fraudType required' });

    const staff = await readDB('staff').catch(() => []);
    const s     = staff.find(m => m.id === staffId);
    if (!s) return res.status(404).json({ error: 'Staff not found' });

    const reason = `Anti-fraud penalty: ${alertTitle || fraudType}${notes ? ' — ' + notes : ''}`;
    const merit  = await awardMerit(staffId, s.name, -10, reason, 'manual', null);

    const record = {
      id:        uuidv4(),
      staffId,
      staffName: s.name,
      fraudType,
      alertTitle: alertTitle || fraudType,
      notes:      notes || '',
      action:     'fine',
      points:     -10,
      meritId:    merit.id,
      week:       weekKey(new Date().toISOString()),
      issuedAt:   new Date().toISOString(),
      issuedBy:   req.user.id,
    };
    await insertOne('fraud_records', record);

    res.json({ success: true, record, merit });
  } catch (err) {
    console.error('[Fraud] fine error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/fraud/dismiss ───────────────────────────────────────────────────
router.post('/dismiss', adminOnly, async (req, res) => {
  try {
    const { staffId, fraudType, alertTitle, notes } = req.body;
    if (!staffId || !fraudType) return res.status(400).json({ error: 'staffId and fraudType required' });

    const record = {
      id:        uuidv4(),
      staffId,
      fraudType,
      alertTitle: alertTitle || fraudType,
      notes:      notes || '',
      action:     'dismiss',
      week:       weekKey(new Date().toISOString()),
      issuedAt:   new Date().toISOString(),
      issuedBy:   req.user.id,
    };
    await insertOne('fraud_records', record);

    res.json({ success: true, record });
  } catch (err) {
    console.error('[Fraud] dismiss error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/fraud/general-entries ────────────────────────────────────────────
// Returns diary entries that resolved to "General" (no customer matched).
// Used by the Anti-Fraud "Unmatched Entries" tab so admins can inspect and
// trigger re-analysis after customers are added or the NLP is improved.
router.get('/general-entries', adminOnly, async (req, res) => {
  try {
    const [diary, staff] = await Promise.all([
      readDB('diary').catch(() => []),
      readDB('staff').catch(() => []),
    ]);
    const staffMap = Object.fromEntries(staff.map(s => [s.id, s.name]));

    const generalEntries = diary
      .filter(d => {
        // Only include fully-processed entries where every resolved interaction is General
        if (d.status !== 'done') return false;
        if (!Array.isArray(d.aiEntries) || d.aiEntries.length === 0) return false;
        return d.aiEntries.every(e => !e.customerId && (e.customerName === 'General' || !e.customerName));
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 200)
      .map(d => ({
        id:         d.id,
        content:    d.content,
        staffId:    d.staffId,
        staffName:  staffMap[d.staffId] || d.staffName || d.staffId,
        date:       d.date || (d.createdAt || '').split('T')[0],
        createdAt:  d.createdAt,
        status:     d.status,
      }));

    res.json({ entries: generalEntries, total: generalEntries.length });
  } catch (err) {
    console.error('[Fraud] general-entries error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/fraud/records ────────────────────────────────────────────────────
router.get('/records', adminOnly, async (req, res) => {
  try {
    const records = await readDB('fraud_records').catch(() => []);
    records.sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt));
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Suspicious name detection — remodelled ────────────────────────────────────
//
// Core insight: the problem is PHRASES saved as customer names, not short names.
// Indian single-word names (Raj, Soni, Priya, Ravi) are completely normal.
// Business names with "collection", "jewellers" are real customers.
// What's wrong: diary AI saving tasks/sentences like "earring ka order tha" as names.
//
// Detection priority:
//   1. Hindi verb words → it's a task/phrase, not a person
//   2. Hindi sentence connectors (ka/ke/ki/ko + another word) → phrase structure
//   3. Number + word patterns ("5 sets", "10 piece") → quantity note
//   4. 5+ words → almost certainly a sentence, not a name
//   5. Pure interrogative pronouns as the entire name
//   6. Placeholder/test names
//   7. Pure product term with NO name component (standalone, not business names)

// Hindi action/verb words — if present the entry is a task/diary note, not a name
const HINDI_VERBS = new Set([
  'milna','milega','milenge','milte','mila','mile',
  'dikhana','dikhao','dikhaaye','dikhai','dikhani','dikha',
  'bhejna','bhejni','bhejdo','bhejo','bheja','bhejege',
  'dena','dedo','lena','lelo','lenge','lena','liya',
  'karna','karo','karna','karunga','karni','karenge',
  'aana','aao','aaega','aaegi','aaenge',
  'jaana','jao','jaega','jayenge',
  'batana','batao','bataega','bata',
  'samjhana','samjhao','samjha',
  'chahiye','chahte','chahta','chahti',
  'pending','baaki','bakaya','bhejna',
  'rakhna','rakho','rakh','rakha',
  'lagana','lagao','laga',
  'mangana','mangao','manga',
  'bhejdo','bhejdena',
]);

// Hindi phrase connectors — when combined with other words they signal a sentence
const PHRASE_CONNECTORS = ['ka','ke','ki','ko','se','mein','par','tak','wala','wali','waale','ne'];

// Standalone whole-name pronouns only (not when mixed with real name words)
const PURE_PRONOUNS = new Set([
  'kiska','iska','uska','kisi','koi','kuch',
  'aapka','mera','tera','hamara','tumhara','unka','inke','unke',
  'jiska','kaun','kitna','kahan','kyun','kya',
]);

// Only flag as product if the ENTIRE name is product vocabulary (no person-name component)
const PRODUCT_ONLY_WORDS = new Set([
  'earring','earrings','jhumka','jhumke','jhumki',
  'bangle','bangles','kangan','necklace','haar',
  'maangtikka','nath','payal','anklet','pendant','locket',
  'bracelet','bracelets','bajuband','chuda','chudiyan','chooda',
  'tops','studs','sets','pieces','items','samples','stock',
  'catalogue','catalog','bulk','delivery','lot',
]);

// Clear test/placeholder names
const PLACEHOLDERS = new Set([
  'test','demo','abc','xyz','temp','dummy','unknown','anonymous',
  'na','nil','none','null','abcd','1234','nnn','xxx','yyy','zzz',
]);

function getSuspiciousReason(name) {
  if (!name || typeof name !== 'string') return null;
  const trimmed = name.trim();
  const lower   = trimmed.toLowerCase();
  const words   = lower.split(/\s+/).filter(Boolean);
  const wcount  = words.length;

  // Too short to be any name
  if (lower.length < 2) return 'Too short';

  // Pure number
  if (/^\d+$/.test(lower)) return 'Number, not a name';

  // Number mixed with word ("5 sets", "10 piece ka", "3 jhumke")
  if (/^\d+\s+\w/.test(lower) || /\w\s+\d+$/.test(lower)) return 'Quantity phrase';

  // Placeholder/test names (whole name only, not partial)
  if (PLACEHOLDERS.has(lower)) return 'Test / placeholder name';

  // Pure interrogative pronoun as entire name
  if (PURE_PRONOUNS.has(lower)) return 'Interrogative pronoun';

  // Contains a Hindi verb → it's a task or diary note saved as a name
  if (words.some(w => HINDI_VERBS.has(w))) return 'Hindi action phrase';

  // Phrase connector pattern: word + ka/ke/ki + word (e.g. "earring ka order")
  if (wcount >= 3 && words.some(w => PHRASE_CONNECTORS.includes(w))) {
    // Check at least one non-connector word is also a product or common noun
    const nonConnectors = words.filter(w => !PHRASE_CONNECTORS.includes(w));
    if (nonConnectors.some(w => PRODUCT_ONLY_WORDS.has(w))) {
      return 'Product phrase (not a name)';
    }
    // Even without product words, 4+ words with connector = likely sentence
    if (wcount >= 4) return 'Sentence structure';
  }

  // 5+ words → almost certainly a sentence / note, not a person or business name
  if (wcount >= 5) return 'Too many words — likely a phrase';

  // Entire name is ONLY product/category words with no person-name component
  if (wcount <= 2 && words.every(w => PRODUCT_ONLY_WORDS.has(w))) {
    return 'Product term, not a name';
  }

  return null; // looks like a legitimate name
}

// ── GET /api/fraud/suspicious-names ──────────────────────────────────────────
router.get('/suspicious-names', adminOnly, async (req, res) => {
  try {
    const [customers, staffList, whitelist] = await Promise.all([
      readDB('customers').catch(() => []),
      readDB('staff').catch(() => []),
      readDB('name_whitelist').catch(() => []),
    ]);
    const staffMap      = Object.fromEntries(staffList.map(s => [s.id, s.name]));
    const whitelistSet  = new Set(whitelist.map(w => w.name?.toLowerCase?.() ?? ''));

    const flagged = [];
    for (const c of customers) {
      if (whitelistSet.has((c.name || '').toLowerCase().trim())) continue;
      const reason = getSuspiciousReason(c.name);
      if (reason) {
        flagged.push({
          id:        c.id,
          name:      c.name,
          reason,
          staffId:   c.staffId || c.assignedTo || null,
          staffName: staffMap[c.staffId || c.assignedTo] || 'Unknown',
          createdAt: c.createdAt,
          phone:     c.phone || null,
        });
      }
    }

    flagged.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ count: flagged.length, customers: flagged });
  } catch (err) {
    console.error('[Fraud] suspicious-names error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /api/fraud/suspicious-names/:id — delete the customer ──────────────
router.delete('/suspicious-names/:id', adminOnly, async (req, res) => {
  try {
    const { deleteOne } = require('../utils/db');
    await deleteOne('customers', req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[Fraud] delete customer error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/fraud/whitelist — learn: mark name as legitimate ────────────────
router.post('/whitelist', adminOnly, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const existing = await readDB('name_whitelist').catch(() => []);
    const lower    = name.toLowerCase().trim();
    if (existing.some(w => w.name?.toLowerCase?.() === lower)) {
      return res.json({ success: true, alreadyExists: true });
    }
    await insertOne('name_whitelist', {
      id:        require('crypto').randomUUID(),
      name:      name.trim(),
      addedAt:   new Date().toISOString(),
      addedBy:   req.user.id,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[Fraud] whitelist error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
