/**
 * SidebarClock — live clock + shift-progress sunrise arc, extracted from Sidebar
 * so the per-second tick only re-renders this small subtree (not the whole
 * sidebar with its nav list, drag logic and user pill).
 */
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { attendanceAPI, staffAPI } from '../lib/api';

const tz = 'Asia/Kolkata';

function fmtShiftTime(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export default function SidebarClock() {
  const { user } = useAuth();

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const clockTime = now.toLocaleTimeString('en-IN', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  const clockDate = now.toLocaleDateString('en-IN', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' });
  const istHour   = parseInt(now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }), 10);

  // Shift-aware clock for staff role
  const [attCfg,   setAttCfg]   = useState<{ shiftStart: string; shiftEnd: string; womenShift?: { shiftStart: string; shiftEnd: string } } | null>(null);
  const [staffRec, setStaffRec] = useState<{ gender?: string; shiftOverride?: { shiftStart: string; shiftEnd: string } } | null>(null);
  useEffect(() => {
    if (user?.role !== 'staff') return;
    let cancelled = false;
    Promise.all([
      attendanceAPI.config().catch(() => null),
      staffAPI.get(user.id).catch(() => null),
    ]).then(([cfg, rec]) => {
      if (cancelled) return;
      setAttCfg(cfg as typeof attCfg);
      setStaffRec(rec as typeof staffRec);
    });
    return () => { cancelled = true; };
  }, [user?.id, user?.role]);

  const effectiveShift = (() => {
    if (!attCfg || user?.role !== 'staff') return null;
    if (staffRec?.shiftOverride) return staffRec.shiftOverride;
    if (staffRec?.gender === 'female' && attCfg.womenShift) return attCfg.womenShift;
    return { shiftStart: attCfg.shiftStart, shiftEnd: attCfg.shiftEnd };
  })();

  // IST fractional minutes (includes seconds) — gives the progress bar per-second granularity
  const istNowDate = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const istNowMins = istNowDate.getHours() * 60 + istNowDate.getMinutes() + istNowDate.getSeconds() / 60;

  // shiftProgress: 0–100 (null when no shift config available)
  const shiftProgress = (() => {
    if (!effectiveShift) return null;
    const [sh, sm] = effectiveShift.shiftStart.split(':').map(Number);
    const [eh, em] = effectiveShift.shiftEnd.split(':').map(Number);
    if ([sh, sm, eh, em].some(n => Number.isNaN(n))) return null;
    const startMins = sh * 60 + sm;
    const endMins   = eh * 60 + em;
    if (endMins <= startMins) return null;          // malformed / overnight — fall back to plain clock
    if (istNowMins <= startMins) return 0;
    if (istNowMins >= endMins)   return 100;
    return ((istNowMins - startMins) / (endMins - startMins)) * 100;
  })();

  const withinWork = shiftProgress !== null
    ? shiftProgress > 0 && shiftProgress < 100
    : istHour >= 9;

  // Arc color — rose/pink for women's shift, gold/amber for default
  const isWomenShift = staffRec?.gender === 'female' && !!attCfg?.womenShift && !staffRec?.shiftOverride;
  const arcColor     = isWomenShift ? '#f472b6' : '#f59e0b';

  // Quadratic bezier control points for the sunrise arc (viewBox 220 × 44)
  const arcP0 = { x: 10,  y: 40 };   // start (left  — shift start)
  const arcP1 = { x: 110, y: 5  };   // control (apex — midday peak)
  const arcP2 = { x: 210, y: 40 };   // end   (right — shift end)
  const arcPath = `M ${arcP0.x} ${arcP0.y} Q ${arcP1.x} ${arcP1.y} ${arcP2.x} ${arcP2.y}`;

  // Dot position along the bezier for current progress
  const arcT    = Math.max(0, Math.min(1, (shiftProgress ?? 0) / 100));
  const dotX    = (1 - arcT) ** 2 * arcP0.x + 2 * arcT * (1 - arcT) * arcP1.x + arcT ** 2 * arcP2.x;
  const dotY    = (1 - arcT) ** 2 * arcP0.y + 2 * arcT * (1 - arcT) * arcP1.y + arcT ** 2 * arcP2.y;

  return (
    <div className="mx-3 mb-1 mt-1 rounded-xl border border-dark-50 bg-dark-300 px-3 py-2.5">
      {effectiveShift ? (
        <>
          {/* ── Arc SVG ── */}
          <svg
            viewBox="0 0 220 44"
            width="100%"
            height="44"
            style={{ display: 'block', overflow: 'visible' }}
          >
            {/* Background arc — faint full path */}
            <path
              d={arcPath}
              stroke={`${arcColor}18`}
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
            />

            {/* Filled progress arc — grows from left as shift advances */}
            {shiftProgress !== null && shiftProgress > 0 && (
              <path
                d={arcPath}
                stroke={arcColor}
                strokeWidth="1.5"
                fill="none"
                strokeLinecap="round"
                pathLength="100"
                strokeDasharray="100"
                strokeDashoffset={100 - shiftProgress}
                opacity={withinWork ? 0.65 : 0.35}
                style={{ transition: 'stroke-dashoffset 1s linear' }}
              />
            )}

            {/* Start marker */}
            <circle cx={arcP0.x} cy={arcP0.y} r="2" fill={`${arcColor}55`} />
            {/* End marker */}
            <circle cx={arcP2.x} cy={arcP2.y} r="2" fill={`${arcColor}22`} />

            {/* Sun dot — moves along the arc every second */}
            {shiftProgress !== null && (
              <g
                style={{
                  transform: `translate(${dotX}px, ${dotY}px)`,
                  transition: 'transform 1s linear',
                }}
              >
                {/* Outer glow halos */}
                <circle r="9"   fill={arcColor} opacity="0.06" />
                <circle r="6"   fill={arcColor} opacity="0.12" />
                <circle r="3.5" fill={arcColor} opacity={withinWork ? 0.75 : 0.3} />
                {/* Inner highlight */}
                <circle r="1.5" fill="white"    opacity={withinWork ? 0.55 : 0.1} />
              </g>
            )}
          </svg>

          {/* Shift start / end labels */}
          <div className="flex items-center justify-between -mt-0.5">
            <span
              className="text-[9px] tabular-nums font-medium"
              style={{ color: `${arcColor}70` }}
            >
              {fmtShiftTime(effectiveShift.shiftStart)}
            </span>
            <span
              className="text-[9px] tabular-nums font-medium"
              style={{ color: `${arcColor}38` }}
            >
              {fmtShiftTime(effectiveShift.shiftEnd)}
            </span>
          </div>

          {/* Clock time + progress % */}
          <div className="flex items-baseline justify-between mt-2">
            <p className="text-[15px] font-mono font-bold tracking-tight leading-none text-white/85">
              {clockTime}
            </p>
            <span
              className="text-[9px] font-semibold tabular-nums"
              style={{ color: `${arcColor}80` }}
            >
              {withinWork
                ? `${Math.round(shiftProgress!)}%`
                : shiftProgress === 0 ? 'Not started' : 'Shift over'}
            </span>
          </div>
          <p className="text-white/20 text-[9px] mt-0.5">{clockDate}</p>
        </>
      ) : (
        /* No shift config (admin / attendance_manager) — plain clock */
        <>
          <p className={`text-lg font-mono font-semibold tracking-tight leading-none ${withinWork ? 'text-white/70' : 'text-white/40'}`}>
            {clockTime}
          </p>
          <div className="flex items-center justify-between mt-0.5">
            <p className="text-white/25 text-[10px]">{clockDate}</p>
            <span className={`text-[9px] font-medium ${withinWork ? 'text-white/40' : 'text-white/20'}`}>
              {withinWork ? 'Working' : 'Off hours'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
