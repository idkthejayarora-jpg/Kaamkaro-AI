/**
 * fraud.js — Anti-farming / anti-fraud detection for merit and task systems.
 *
 * GET /api/fraud/detect   (admin only)
 *   Scans merits, tasks, and diary collections for suspicious patterns.
 *   Returns an array of FraudAlert objects sorted by severity.
 *
 * FraudAlert {
 *   id, staffId, staffName,
 *   type: 'task_speed'|'task_burst'|'task_toggle'|'merit_haul'|'merit_repeat'|
 *         'merit_duplicate_reason'|'loop_abuse'|'diary_spam',
 *   severity: 'high'|'medium'|'low',
 *   title, detail, evidence,  // human-readable
 *   detectedAt
 * }
 */

const express        = require('express');
const { readDB }     = require('../utils/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

function dateStr(iso) { return (iso || '').substring(0, 10); }
function hourStr(iso)  { return (iso || '').substring(0, 13); } // "YYYY-MM-DDTHH"

// ── GET /api/fraud/detect ─────────────────────────────────────────────────────
router.get('/detect', adminOnly, async (req, res) => {
  try {
    const [tasks, merits, diary, staff] = await Promise.all([
      readDB('tasks').catch(() => []),
      readDB('merits').catch(() => []),
      readDB('diary').catch(() => []),
      readDB('staff').catch(() => []),
    ]);

    const staffMap = Object.fromEntries(staff.map(s => [s.id, s.name]));
    const alerts   = [];
    let   alertIdx = 0;
    const mkId = () => `fraud_${++alertIdx}_${Date.now()}`;

    // ── 1. TASK SPEED FARMING ─────────────────────────────────────────────────
    // Task created AND completed within < 4 minutes
    for (const t of tasks) {
      if (!t.completed || !t.completedAt || !t.createdAt) continue;
      const createdMs   = new Date(t.createdAt).getTime();
      const completedMs = new Date(t.completedAt).getTime();
      const diffMins    = (completedMs - createdMs) / 60000;
      if (diffMins >= 0 && diffMins < 4) {
        const name = staffMap[t.staffId] || t.staffId;
        alerts.push({
          id: mkId(), staffId: t.staffId, staffName: name,
          type: 'task_speed', severity: 'high',
          title: 'Lightning task completion',
          detail: `"${t.title}" was created and completed within ${Math.round(diffMins * 10) / 10} minutes.`,
          evidence: `Task ID: ${t.id} · Created: ${t.createdAt.substring(0,16)} · Completed: ${t.completedAt.substring(0,16)}`,
          detectedAt: new Date().toISOString(),
        });
      }
    }

    // ── 2. TASK BURST ─────────────────────────────────────────────────────────
    // > 10 tasks completed by one staff in any rolling 2-hour window
    const completedByStaff = {};
    for (const t of tasks) {
      if (!t.completed || !t.completedAt) continue;
      const sid = t.completedBy || t.staffId;
      if (!sid) continue;
      if (!completedByStaff[sid]) completedByStaff[sid] = [];
      completedByStaff[sid].push(new Date(t.completedAt).getTime());
    }
    for (const [sid, timestamps] of Object.entries(completedByStaff)) {
      timestamps.sort((a, b) => a - b);
      for (let i = 0; i < timestamps.length; i++) {
        const window = timestamps.filter(ts => ts - timestamps[i] <= 2 * 3600000);
        if (window.length > 10) {
          const name = staffMap[sid] || sid;
          alerts.push({
            id: mkId(), staffId: sid, staffName: name,
            type: 'task_burst', severity: 'high',
            title: 'Suspicious task burst',
            detail: `${window.length} tasks completed within a 2-hour window.`,
            evidence: `Window start: ${new Date(timestamps[i]).toLocaleString('en-IN')}`,
            detectedAt: new Date().toISOString(),
          });
          break; // one alert per staff per run
        }
      }
    }

    // ── 3. TASK TOGGLE ABUSE ──────────────────────────────────────────────────
    // Same relatedId (taskId) earns merit from 'task' category more than once
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
      alerts.push({
        id: mkId(), staffId: sid, staffName: name,
        type: 'task_toggle', severity: 'medium',
        title: 'Task toggle farming',
        detail: `Task "${task?.title || taskId}" has been completed and merit-awarded ${events.length} times — likely toggled complete/incomplete repeatedly.`,
        evidence: events.map(e => `+${e.points} on ${e.createdAt.substring(0,10)}`).join(' · '),
        detectedAt: new Date().toISOString(),
      });
    }

    // ── 4. MERIT DAILY HAUL ───────────────────────────────────────────────────
    // Staff earning > 15 points from task/auto sources in a single calendar day
    const meritByStaffDay = {};
    for (const m of merits) {
      if (m.category === 'manual') continue; // admin awards excluded — tracked separately
      const key = `${m.staffId}::${dateStr(m.createdAt)}`;
      meritByStaffDay[key] = (meritByStaffDay[key] || 0) + (m.points || 0);
    }
    for (const [key, total] of Object.entries(meritByStaffDay)) {
      if (total <= 15) continue;
      const [sid, day] = key.split('::');
      const name = staffMap[sid] || sid;
      alerts.push({
        id: mkId(), staffId: sid, staffName: name,
        type: 'merit_haul', severity: total > 30 ? 'high' : 'medium',
        title: 'Abnormal daily merit haul',
        detail: `Earned ${total} merit points in a single day from task/auto sources — significantly above normal.`,
        evidence: `Date: ${day}`,
        detectedAt: new Date().toISOString(),
      });
    }

    // ── 5. REPEAT MANUAL AWARDS ───────────────────────────────────────────────
    // Same admin awarding same staff > 4 times in a single day (possible favouritism)
    const manualByAwdStaff = {};
    for (const m of merits) {
      if (m.category !== 'manual') continue;
      const key = `${m.staffId}::${dateStr(m.createdAt)}`;
      manualByAwdStaff[key] = (manualByAwdStaff[key] || 0) + 1;
    }
    for (const [key, count] of Object.entries(manualByAwdStaff)) {
      if (count < 5) continue;
      const [sid, day] = key.split('::');
      const name = staffMap[sid] || sid;
      alerts.push({
        id: mkId(), staffId: sid, staffName: name,
        type: 'merit_repeat', severity: 'medium',
        title: 'Excessive manual merit awards',
        detail: `${count} separate manual merit awards received in a single day — may indicate favouritism or collusion.`,
        evidence: `Date: ${day}`,
        detectedAt: new Date().toISOString(),
      });
    }

    // ── 6. DUPLICATE REASON FARMING ───────────────────────────────────────────
    // Same merit reason appearing > 4 times for same staff in any 7-day window
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
        alerts.push({
          id: mkId(), staffId: sid, staffName: name,
          type: 'merit_duplicate_reason', severity: 'low',
          title: 'Repeated merit reason',
          detail: `The reason "${reason}" has been used ${count} times to award merits — may indicate repetitive or copy-paste farming.`,
          evidence: `Repeated reason appears ${count} times in merit history`,
          detectedAt: new Date().toISOString(),
        });
      }
    }

    // ── 7. LOOP TASK ABUSE ────────────────────────────────────────────────────
    // Loop task merit earned > 1 time in a single day (shouldn't happen — daily loops complete once/day)
    const loopMeritByDay = {};
    for (const m of merits) {
      if (!m.reason?.startsWith('Loop update:') || !m.relatedId) continue;
      const key = `${m.staffId}::${m.relatedId}::${dateStr(m.createdAt)}`;
      loopMeritByDay[key] = (loopMeritByDay[key] || 0) + 1;
    }
    for (const [key, count] of Object.entries(loopMeritByDay)) {
      if (count < 2) continue;
      const [sid, taskId, day] = key.split('::');
      const name = staffMap[sid] || sid;
      const task = tasks.find(t => t.id === taskId);
      alerts.push({
        id: mkId(), staffId: sid, staffName: name,
        type: 'loop_abuse', severity: 'high',
        title: 'Loop task completion abuse',
        detail: `Loop task "${task?.title || taskId}" was completed and merit-awarded ${count} times on the same day — each loop task should only complete once per interval.`,
        evidence: `Date: ${day} · Task: ${task?.title || taskId}`,
        detectedAt: new Date().toISOString(),
      });
    }

    // ── 8. DIARY SPAM ─────────────────────────────────────────────────────────
    // > 3 diary entries from the same staff on the same day (likely streak farming)
    const diaryByStaffDay = {};
    for (const d of diary) {
      const day = dateStr(d.date || d.createdAt);
      const key = `${d.staffId}::${day}`;
      diaryByStaffDay[key] = (diaryByStaffDay[key] || 0) + 1;
    }
    for (const [key, count] of Object.entries(diaryByStaffDay)) {
      if (count < 4) continue;
      const [sid, day] = key.split('::');
      const name = staffMap[sid] || sid;
      alerts.push({
        id: mkId(), staffId: sid, staffName: name,
        type: 'diary_spam', severity: 'low',
        title: 'Diary entry flooding',
        detail: `${count} diary entries submitted on the same day — may be bulk-logging to maintain streak artificially.`,
        evidence: `Date: ${day}`,
        detectedAt: new Date().toISOString(),
      });
    }

    // ── Sort: high → medium → low, then by staffName ──────────────────────────
    const SEV = { high: 0, medium: 1, low: 2 };
    alerts.sort((a, b) => {
      const sd = SEV[a.severity] - SEV[b.severity];
      return sd !== 0 ? sd : a.staffName.localeCompare(b.staffName);
    });

    res.json({ alerts, scannedAt: new Date().toISOString(), total: alerts.length });
  } catch (err) {
    console.error('[Fraud] detect error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
