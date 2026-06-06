/**
 * Payroll routes — JWT-protected, attendance manager or admin only.
 * GET  /api/payroll/config
 * PATCH /api/payroll/config/:staffId
 * GET  /api/payroll/summary?month=YYYY-MM
 */
const express = require('express');
const { readDB, writeDB, withLock } = require('../utils/db');
const { authMiddleware, attendanceManagerOrAdmin } = require('../middleware/auth');

const router = express.Router();

// Helper: parse shift override into hours
function shiftHours(override) {
  if (!override || !override.shiftStart || !override.shiftEnd) return null;
  const [sh, sm] = override.shiftStart.split(':').map(Number);
  const [eh, em] = override.shiftEnd.split(':').map(Number);
  return ((eh * 60 + em) - (sh * 60 + sm)) / 60;
}

// ── GET /api/payroll/config ───────────────────────────────────────────────────
router.get('/config', authMiddleware, attendanceManagerOrAdmin, async (req, res) => {
  try {
    const configs = await readDB('payroll_config').catch(() => []);
    res.json(configs);
  } catch (err) {
    console.error('[Payroll config GET]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PATCH /api/payroll/config/:staffId ───────────────────────────────────────
router.patch('/config/:staffId', authMiddleware, attendanceManagerOrAdmin, async (req, res) => {
  try {
    const { staffId } = req.params;
    const { monthlySalary, overtimeMultiplier, latePenaltyPerMin, workingDaysOverride } = req.body;

    // Atomic read-modify-write so concurrent config saves can't clobber each other
    const saved = await withLock('payroll_config', async () => {
      const configs = await readDB('payroll_config').catch(() => []);
      const idx = configs.findIndex(c => c.staffId === staffId);

      if (idx >= 0) {
        configs[idx] = {
          ...configs[idx],
          ...(monthlySalary !== undefined     && { monthlySalary }),
          ...(overtimeMultiplier !== undefined && { overtimeMultiplier }),
          ...(latePenaltyPerMin !== undefined  && { latePenaltyPerMin }),
          ...(workingDaysOverride !== undefined && { workingDaysOverride }),
          updatedAt: new Date().toISOString(),
        };
      } else {
        configs.push({
          staffId,
          monthlySalary:       monthlySalary       ?? 0,
          overtimeMultiplier:  overtimeMultiplier   ?? 1.5,
          latePenaltyPerMin:   latePenaltyPerMin    ?? 0,
          workingDaysOverride: workingDaysOverride  ?? null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      await writeDB('payroll_config', configs);
      return configs.find(c => c.staffId === staffId);
    });

    res.json(saved);
  } catch (err) {
    console.error('[Payroll config PATCH]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/payroll/summary?month=YYYY-MM ────────────────────────────────────
router.get('/summary', authMiddleware, attendanceManagerOrAdmin, async (req, res) => {
  try {
    const now = new Date();
    const monthStr = req.query.month ||
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [yr, mo] = monthStr.split('-').map(Number);
    const lastDay  = new Date(yr, mo, 0).getDate();
    const todayISO = now.toISOString().split('T')[0];

    const [staffList, attendance, allLeaves, configs, attendanceCfgArr, holidays] = await Promise.all([
      readDB('staff'),
      readDB('attendance'),
      readDB('leaves').catch(() => []),
      readDB('payroll_config').catch(() => []),
      readDB('config').catch(() => []),
      readDB('holidays').catch(() => []),
    ]);
    const isDayOff = makeDayOff(holidays); // Sundays + declared holidays → no absence, no deduction

    // Get global attendance config for expectedHours fallback
    const attCfgRec = attendanceCfgArr.find(c => c.key === 'attendance');
    const globalExpectedHours = attCfgRec?.value?.expectedHours || 9;

    const activeStaff = staffList.filter(s => s.active !== false);

    const staffResults = activeStaff.map(s => {
      const payCfg = configs.find(c => c.staffId === s.id);
      const monthlySalary     = payCfg?.monthlySalary       ?? 0;
      const overtimeMultiplier = payCfg?.overtimeMultiplier  ?? 1.5;
      const latePenaltyPerMin  = payCfg?.latePenaltyPerMin   ?? 0;
      const workingDays        = payCfg?.workingDaysOverride  ?? lastDay;

      // Effective expected hours per day for this staff member
      const effectiveExpectedHours = s.shiftOverride
        ? (shiftHours(s.shiftOverride) ?? globalExpectedHours)
        : globalExpectedHours;

      const dailyRate  = workingDays > 0 ? monthlySalary / workingDays : 0;
      const hourlyRate = effectiveExpectedHours > 0 ? dailyRate / effectiveExpectedHours : 0;

      let presentDays     = 0;
      let absentDays      = 0;
      let halfDays        = 0;
      let fullLeaveDays   = 0;
      let lateMinutesTotal = 0;
      let overtimeHoursTotal = 0;
      let totalHours      = 0;

      for (let d = 1; d <= lastDay; d++) {
        const dd      = String(d).padStart(2, '0');
        const dateStr = `${monthStr}-${dd}`;

        // Only count days up to today
        if (dateStr > todayISO) continue;

        const rec   = attendance.find(r => r.staffId === s.id && r.date === dateStr);
        const leave = allLeaves.find(l => l.staffId === s.id && l.date === dateStr);

        if (rec) {
          presentDays++;
          totalHours += rec.hoursWorked || 0;
          if (rec.isLate) lateMinutesTotal += rec.lateMinutes || 0;
          overtimeHoursTotal += rec.overtimeHours || 0;
        } else if (leave) {
          if (leave.type === 'half_day_am' || leave.type === 'half_day_pm') {
            halfDays++;
          } else {
            // full_day, sick, emergency → paid leave, no deduction
            fullLeaveDays++;
          }
        } else if (isDayOff(dateStr)) {
          // Weekly off (Sunday) or declared holiday — not absent, no pay deduction.
        } else {
          absentDays++;
        }
      }

      const absentDeduction  = Math.round(absentDays * dailyRate);
      const halfDayDeduction = Math.round(halfDays * dailyRate * 0.5);
      const latePenalty      = Math.round(lateMinutesTotal * latePenaltyPerMin);
      const overtimePay      = Math.round(overtimeHoursTotal * hourlyRate * overtimeMultiplier);
      const netPay           = Math.max(0, Math.round(
        monthlySalary - absentDeduction - halfDayDeduction - latePenalty + overtimePay
      ));

      return {
        staffId:          s.id,
        staffName:        s.name,
        avatar:           s.avatar || s.name[0].toUpperCase(),
        monthlySalary,
        workingDays,
        presentDays,
        absentDays,
        halfDays,
        fullLeaveDays,
        lateMinutesTotal,
        overtimeHours:    Math.round(overtimeHoursTotal * 100) / 100,
        totalHours:       Math.round(totalHours * 100) / 100,
        absentDeduction,
        halfDayDeduction,
        latePenalty,
        overtimePay,
        netPay,
        hasSalaryConfig:  !!payCfg,
      };
    });

    const totalPayroll = staffResults.reduce((s, r) => s + r.netPay, 0);

    res.json({ month: monthStr, totalPayroll, staff: staffResults });
  } catch (err) {
    console.error('[Payroll summary]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
