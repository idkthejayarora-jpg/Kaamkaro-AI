import { NavLink, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import {
  LayoutDashboard, Users, UserCheck, Building2,
  BookOpen, Sparkles, LogOut, Menu, X, ChevronRight,
  ClipboardList, Shield, Download, Trophy, Clock, Target,
  Sun, Moon, FileText, Webhook, Radio, MessageSquare, Filter, TrendingUp,
  GripVertical, Settings2, Settings, Package, RefreshCw, Award, Calendar,
  ShieldOff, CalendarClock, Briefcase, CalendarOff, CalendarDays, IndianRupee,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { exportAPI, staffAPI, broadcastAPI, attendanceAPI } from '../lib/api';
import { useState, useRef, useEffect } from 'react';
import AccountSwitcher from './AccountSwitcher';

// ── Nav definitions ────────────────────────────────────────────────────────────
const adminNav = [
  { to: '/dashboard',       icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/staff',           icon: Users,           label: 'Staff' },
  { to: '/customers',       icon: UserCheck,       label: 'Customers' },
  { to: '/crm',             icon: Filter,          label: 'CRM Leads' },
  { to: '/vendors',         icon: Building2,       label: 'Vendors' },
  { to: '/tasks',           icon: ClipboardList,   label: 'Tasks' },
  { to: '/diary',           icon: BookOpen,        label: 'Diary' },
  { to: '/chat',            icon: MessageSquare,   label: 'Chat' },
  { to: '/leaderboard',     icon: Trophy,          label: 'Leaderboard' },
  { to: '/followup',        icon: Clock,           label: 'Follow-up Queue' },
  { to: '/goals',           icon: Target,          label: 'Goals' },
  { to: '/recommendations', icon: Sparkles,        label: 'AI Insights' },
  { to: '/sales-insights',  icon: TrendingUp,      label: 'Sales Insights' },
  { to: '/stock',           icon: Package,         label: 'Stock Tracker' },
  { to: '/badges',          icon: Award,           label: 'Badges' },
  { to: '/calendar',        icon: Calendar,        label: 'Calendar' },
  { to: '/templates',       icon: FileText,        label: 'Templates' },
  { to: '/webhook',         icon: Webhook,         label: 'WhatsApp Setup' },
  { to: '/teams',           icon: Users,           label: 'Teams' },
  { to: '/anti-fraud',      icon: ShieldOff,       label: 'Anti-Fraud' },
  { to: '/audit',           icon: Shield,          label: 'Audit Log' },
];

const attendanceManagerNav = [
  { to: '/chat',     icon: MessageSquare, label: 'Chat' },
  { to: '/settings', icon: Settings,      label: 'Settings' },
];

const attendanceTabs = [
  { id: 'today',     icon: Clock,         label: 'Today' },
  { id: 'analytics', icon: TrendingUp,    label: 'Analytics' },
  { id: 'monthly',   icon: Calendar,      label: 'Monthly' },
  { id: 'payroll',   icon: IndianRupee,   label: 'Payroll' },
  { id: 'staff',     icon: Users,         label: 'Staff' },
  { id: 'leaves',    icon: CalendarOff,   label: 'Leaves' },
  { id: 'holidays',  icon: CalendarDays,  label: 'Holidays' },
  { id: 'settings',  icon: Settings,      label: 'Att. Settings' },
];

const staffNav = [
  { to: '/dashboard',   icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/kaam',        icon: Briefcase,       label: 'Kaam' },
  { to: '/customers',   icon: UserCheck,       label: 'My Customers' },
  { to: '/crm',         icon: Filter,          label: 'CRM Leads' },
  { to: '/vendors',     icon: Building2,       label: 'Vendors' },
  { to: '/tasks',       icon: ClipboardList,   label: 'Tasks' },
  { to: '/diary',       icon: BookOpen,        label: 'Diary' },
  { to: '/chat',        icon: MessageSquare,   label: 'Chat' },
  { to: '/leaderboard', icon: Trophy,          label: 'Leaderboard' },
  { to: '/followup',    icon: Clock,           label: 'Follow-up Queue' },
  { to: '/goals',       icon: Target,          label: 'Goals' },
  { to: '/templates',   icon: FileText,        label: 'Templates' },
  { to: '/stock',       icon: Package,         label: 'Stock Tracker' },
  { to: '/badges',      icon: Award,           label: 'Badges' },
  { to: '/calendar',    icon: Calendar,        label: 'Calendar' },
];

type NavItem = typeof adminNav[number];

// ── Persist nav order in localStorage ─────────────────────────────────────────
function storageKey(role: string, userId: string) {
  return `kk_nav_order_${role}_${userId}`;
}

function loadOrder(defaultNav: NavItem[], role: string, userId: string): NavItem[] {
  try {
    const saved = localStorage.getItem(storageKey(role, userId));
    if (!saved) return defaultNav;
    const paths: string[] = JSON.parse(saved);
    // Merge: respect saved order, but always include new items added since last save
    const ordered = paths.map(p => defaultNav.find(n => n.to === p)).filter(Boolean) as NavItem[];
    const unseen  = defaultNav.filter(n => !paths.includes(n.to));
    return [...ordered, ...unseen];
  } catch {
    return defaultNav;
  }
}

function saveOrder(items: NavItem[], role: string, userId: string) {
  localStorage.setItem(storageKey(role, userId), JSON.stringify(items.map(n => n.to)));
}

// ── Sidebar component ──────────────────────────────────────────────────────────
interface SidebarProps { mobileOpen: boolean; onClose: () => void; }

// Deterministic color from user name — drives all glow in the UI
function getUserColor(name: string): string {
  const palette = ['#a855f7','#3b82f6','#10b981','#f59e0b','#ef4444','#06b6d4','#8b5cf6','#ec4899'];
  const idx = ((name.charCodeAt(0) || 0) + (name.charCodeAt(1) || 0)) % palette.length;
  return palette[idx];
}

export default function Sidebar({ mobileOpen, onClose }: SidebarProps) {
  const { user, logout, isAdmin, updateUser, isSwitched, originalAdmin, switchBack } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [attSearchParams, setAttSearchParams] = useSearchParams();
  const activeAttTab = location.pathname === '/attendance-portal'
    ? (attSearchParams.get('tab') || 'today')
    : null;
  const [showSwitcher, setShowSwitcher] = useState(false);

  const defaultNav = user?.role === 'attendance_manager' ? attendanceManagerNav : isAdmin ? adminNav : staffNav;
  const role       = user?.role || 'staff';
  const userId     = user?.id   || 'unknown';

  const userColor  = getUserColor(user?.name || 'U');

  const [navItems,   setNavItems]   = useState<NavItem[]>(() => loadOrder(defaultNav, role, userId));
  const [editMode,   setEditMode]   = useState(false);
  const [dragIdx,    setDragIdx]    = useState<number | null>(null);
  // Ref-based drag source — avoids stale-closure & inside-setState mutation bugs
  const dragFromRef                 = useRef<number | null>(null);
  const navItemsRef                 = useRef<NavItem[]>(navItems);
  // Keep ref in sync with state
  useEffect(() => { navItemsRef.current = navItems; }, [navItems]);

  const [exporting,          setExporting]          = useState(false);
  const [showBroadcast,      setShowBroadcast]      = useState(false);
  const [broadcastMsg,       setBroadcastMsg]       = useState('');
  const [sending,            setSending]            = useState(false);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const tz        = 'Asia/Kolkata';
  const clockTime = now.toLocaleTimeString('en-IN', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  const clockDate = now.toLocaleDateString('en-IN', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' });
  const istHour   = parseInt(now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }), 10);

  // Shift-aware clock for staff role
  const [attCfg,   setAttCfg]   = useState<{ shiftStart: string; shiftEnd: string; womenShift?: { shiftStart: string; shiftEnd: string } } | null>(null);
  const [staffRec, setStaffRec] = useState<{ gender?: string; shiftOverride?: { shiftStart: string; shiftEnd: string } } | null>(null);
  useEffect(() => {
    if (user?.role !== 'staff') return;
    Promise.all([
      attendanceAPI.config().catch(() => null),
      staffAPI.get(user.id).catch(() => null),
    ]).then(([cfg, rec]) => {
      setAttCfg(cfg as typeof attCfg);
      setStaffRec(rec as typeof staffRec);
    });
  }, [user?.id, user?.role]);

  const effectiveShift = (() => {
    if (!attCfg || user?.role !== 'staff') return null;
    if (staffRec?.shiftOverride) return staffRec.shiftOverride;
    if (staffRec?.gender === 'female' && attCfg.womenShift) return attCfg.womenShift;
    return { shiftStart: attCfg.shiftStart, shiftEnd: attCfg.shiftEnd };
  })();

  const fmtShiftTime = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  };

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

  // Keep navItems in sync if user switches role (e.g. re-login)
  useEffect(() => {
    setNavItems(loadOrder(defaultNav, role, userId));
  }, [role, userId]);

  // ── Drag handlers ────────────────────────────────────────────────────────────
  const handleDragStart = (e: React.DragEvent, idx: number) => {
    e.dataTransfer.effectAllowed = 'move';
    dragFromRef.current = idx;
    setDragIdx(idx);
  };

  // dragEnter fires ONCE when cursor enters a new element — safe to reorder here
  const handleDragEnter = (_e: React.DragEvent, idx: number) => {
    const from = dragFromRef.current;
    if (from === null || from === idx) return;
    const next = [...navItemsRef.current];
    const [moved] = next.splice(from, 1);
    next.splice(idx, 0, moved);
    dragFromRef.current = idx;
    navItemsRef.current = next;
    setNavItems(next);
    setDragIdx(idx);
  };

  const handleDragEnd = () => {
    dragFromRef.current = null;
    setDragIdx(null);
    // navItemsRef.current always has the latest order (no stale closure)
    saveOrder(navItemsRef.current, role, userId);
  };

  const handleExitEdit = () => {
    setEditMode(false);
    saveOrder(navItemsRef.current, role, userId);
  };

  const handleReset = () => {
    setNavItems(defaultNav);
    navItemsRef.current = defaultNav;
    saveOrder(defaultNav, role, userId);
  };

  const handleLogout      = () => { logout(); navigate('/login'); };
  const handleExport      = async () => {
    setExporting(true);
    try {
      const blob = await exportAPI.download();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `kaamkaro-export-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  };
  const sendBroadcast     = async () => {
    if (!broadcastMsg.trim() || sending) return;
    setSending(true);
    try {
      await broadcastAPI.send(broadcastMsg.trim());
      setBroadcastMsg('');
      setShowBroadcast(false);
    } catch { /* non-fatal */ }
    finally { setSending(false); }
  };

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/60 z-40 lg:hidden backdrop-blur-sm" onClick={onClose} />
      )}

      <aside className={`
        fixed top-0 left-0 h-svh w-64 z-50 flex flex-col
        kk-glass-nav border-r border-dark-50
        transform transition-transform duration-300 ease-out
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 lg:static lg:z-auto lg:h-full
      `}>
        {/* Logo — pt includes notch safe-area on mobile */}
        <div
          className="flex items-center justify-between px-5 border-b border-dark-50 flex-shrink-0"
          style={{ paddingTop: 'calc(1.25rem + env(safe-area-inset-top))', paddingBottom: '1.25rem' }}
        >
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="KJ"
              className="w-9 h-9 rounded-full object-cover flex-shrink-0 animate-float"
              style={{ boxShadow: '0 0 18px #C9A84Cb3, 0 0 6px #C9A84C59' }}
            />
            <div>
              <p className="text-white font-bold text-sm tracking-wide">Kaamkaro</p>
              <p className="text-gold text-[10px] font-medium tracking-widest uppercase">AI Platform</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={toggle}
              className="p-1.5 rounded-lg hover:bg-dark-200 text-white/30 hover:text-gold transition-colors"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            <button onClick={onClose} className="lg:hidden text-white/40 hover:text-white transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* User pill — clickable for admin to open account switcher */}
        <div className="mx-4 mt-4 mb-2">
          {/* Switched-mode badge */}
          {isSwitched && originalAdmin && (
            <div className="flex items-center justify-between px-3 py-1.5 mb-1.5 rounded-lg bg-gold/10 border border-gold/25">
              <span className="text-gold text-[10px] font-medium truncate">
                Viewing as {user?.name}
              </span>
              <button
                onClick={() => { switchBack(); }}
                className="flex items-center gap-1 text-[10px] text-gold/70 hover:text-gold transition-colors ml-2 flex-shrink-0"
              >
                <RefreshCw size={10} /> Back
              </button>
            </div>
          )}

          <button
            onClick={() => {
              if (isAdmin || isSwitched) setShowSwitcher(true);
              else if (user?.id) navigate(`/staff/${user.id}`); // staff → own profile/stats
            }}
            className="w-full p-3 rounded-xl bg-dark-300 border border-dark-50 text-left transition-all hover:border-gold/30 hover:bg-dark-200 cursor-pointer active:scale-[0.99]"
          >
            <div className="flex items-center gap-3">
              <div className="relative flex-shrink-0">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center border flex-shrink-0"
                  style={{
                    background: isSwitched ? 'rgba(255,255,255,0.1)' : `${userColor}33`,
                    borderColor: isSwitched ? 'rgba(255,255,255,0.2)' : `${userColor}66`,
                    boxShadow: !isSwitched ? `0 0 10px ${userColor}77` : undefined,
                  }}
                >
                  <span className="text-xs font-bold" style={{ color: isSwitched ? 'rgba(255,255,255,0.7)' : userColor }}>
                    {user?.avatar || 'U'}
                  </span>
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-white text-sm font-medium truncate">{user?.name}</p>
                <p className="text-white/30 text-xs capitalize">{user?.role}</p>
              </div>
              {/* Switch icon for admins · profile chevron for staff */}
              {(isAdmin || isSwitched) ? (
                <RefreshCw size={12} className="text-white/20 flex-shrink-0" />
              ) : (
                <ChevronRight size={13} className="text-white/25 flex-shrink-0" />
              )}
            </div>
          </button>

        </div>

        {/* Live clock — sunrise / sunset arc */}
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

        {/* Navigation */}
        <nav className="flex-1 px-3 py-2 overflow-y-auto">
          {/* Attendance tabs — shown inline for attendance_manager role */}
          {user?.role === 'attendance_manager' && (
            <div className="mb-3">
              <p className="text-white/20 text-[10px] font-semibold uppercase tracking-widest px-3 mb-2 mt-2">Attendance</p>
              <ul className="space-y-0.5">
                {attendanceTabs.map(({ id, icon: Icon, label }) => {
                  const active = activeAttTab === id;
                  return (
                    <li key={id}>
                      <button
                        onClick={() => {
                          navigate(`/attendance-portal?tab=${id}`, { replace: false });
                          onClose();
                        }}
                        className={`sidebar-link w-full ${active ? 'active' : ''}`}
                      >
                        <Icon size={16} className="sidebar-icon flex-shrink-0 transition-all duration-200"
                          style={active ? { filter: 'drop-shadow(0 0 6px #C9A84Ccc)' } : undefined} />
                        <span className="flex-1">{label}</span>
                        {active && <ChevronRight size={12} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="mx-3 my-3 border-t border-dark-50" />
            </div>
          )}

          {/* Section header + customize toggle */}
          <div className="flex items-center justify-between px-3 mb-2 mt-2">
            <p className="text-white/20 text-[10px] font-semibold uppercase tracking-widest">Menu</p>
            {!editMode ? (
              <button
                onClick={() => setEditMode(true)}
                className="text-white/20 hover:text-gold transition-colors"
                title="Customize menu order"
              >
                <Settings2 size={12} />
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleReset}
                  className="text-[9px] text-white/20 hover:text-white/50 transition-colors"
                >
                  Reset
                </button>
                <button
                  onClick={handleExitEdit}
                  className="text-[9px] bg-gold/15 text-gold px-2 py-0.5 rounded-md hover:bg-gold/25 transition-colors font-medium"
                >
                  Done
                </button>
              </div>
            )}
          </div>

          {/* Edit mode hint */}
          {editMode && (
            <p className="text-white/15 text-[10px] px-3 mb-2">Drag to reorder</p>
          )}

          <ul className="space-y-0.5">
            {navItems.map(({ to, icon: Icon, label }, idx) => (
              <li
                key={to}
                draggable={editMode}
                onDragStart={e => handleDragStart(e, idx)}
                onDragEnter={e => handleDragEnter(e, idx)}
                onDragOver={e => e.preventDefault()}
                onDragEnd={handleDragEnd}
                className={`transition-opacity duration-100 ${
                  editMode && dragIdx === idx ? 'opacity-30' : 'opacity-100'
                }`}
              >
                {editMode ? (
                  /* Edit mode — drag handle + label, no NavLink */
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl cursor-grab active:cursor-grabbing text-white/50 hover:text-white/70 hover:bg-white/5 transition-colors select-none">
                    <GripVertical size={14} className="text-white/20 flex-shrink-0" />
                    <Icon size={16} className="flex-shrink-0" />
                    <span className="flex-1 text-sm">{label}</span>
                  </div>
                ) : (
                  /* Normal nav link */
                  <NavLink
                    to={to}
                    onClick={onClose}
                    className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                  >
                    {({ isActive }) => (
                      <>
                        <Icon size={16} className="sidebar-icon flex-shrink-0 transition-all duration-200"
                          style={isActive ? { filter: 'drop-shadow(0 0 6px #C9A84Ccc)' } : undefined} />
                        <span className="flex-1">{label}</span>
                        <ChevronRight size={12} className="opacity-0 group-hover:opacity-100" />
                      </>
                    )}
                  </NavLink>
                )}
              </li>
            ))}
          </ul>
        </nav>

        {/* Bottom actions */}
        <div className="p-3 border-t border-dark-50 space-y-1">
          {isAdmin && (
            <button
              onClick={() => setShowBroadcast(true)}
              className="w-full sidebar-link text-white/40 hover:text-gold hover:bg-gold/5"
            >
              <Radio size={16} />
              <span>Broadcast Message</span>
            </button>
          )}
          {isAdmin && (
            <button
              onClick={handleExport}
              disabled={exporting}
              className="w-full sidebar-link text-white/30 hover:text-gold hover:bg-gold/5"
            >
              <Download size={16} />
              <span>{exporting ? 'Exporting…' : 'Export Data'}</span>
            </button>
          )}
          <NavLink to="/settings" onClick={onClose} className={({ isActive }) => `w-full sidebar-link ${isActive ? 'active' : 'text-white/30 hover:text-gold hover:bg-gold/5'}`}>
            <Settings size={16} />
            <span>Settings</span>
          </NavLink>
          <button onClick={handleLogout} className="w-full sidebar-link text-red-400/50 hover:text-red-400 hover:bg-red-500/10">
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Account switcher — admin only */}
      {showSwitcher && <AccountSwitcher onClose={() => setShowSwitcher(false)} />}

      {/* Broadcast modal */}
      {showBroadcast && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div className="bg-dark-300 border border-gold/30 rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-dark-50">
              <div className="flex items-center gap-2">
                <Radio size={16} className="text-gold" />
                <span className="text-white font-semibold text-sm">Broadcast to All Staff</span>
              </div>
              <button onClick={() => setShowBroadcast(false)} className="text-white/30 hover:text-white transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-white/40 text-xs">Message will appear as a popup notification for all online staff with a sound alert.</p>
              <textarea
                value={broadcastMsg}
                onChange={e => setBroadcastMsg(e.target.value)}
                placeholder="Type your message here…"
                rows={4}
                className="input resize-none w-full"
                autoFocus
              />
            </div>
            <div className="px-5 pb-5 flex gap-3">
              <button onClick={() => setShowBroadcast(false)} className="btn-ghost flex-1">Cancel</button>
              <button
                onClick={sendBroadcast}
                disabled={!broadcastMsg.trim() || sending}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                <Radio size={13} />
                {sending ? 'Sending…' : 'Send Now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function MobileMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="lg:hidden p-2 rounded-lg hover:bg-dark-200 text-white/60 hover:text-white transition-colors">
      <Menu size={20} />
    </button>
  );
}
