import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, UserCheck, Building2,
  BookOpen, Sparkles, LogOut, Menu, X, ChevronRight,
  ClipboardList, Shield, Download, Trophy, Clock, Target,
  Sun, Moon, FileText, Webhook, Radio, MessageSquare, Filter, TrendingUp,
  GripVertical, Settings2, Settings, Package, RefreshCw,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { exportAPI, staffAPI, broadcastAPI } from '../lib/api';
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
  { to: '/templates',       icon: FileText,        label: 'Templates' },
  { to: '/webhook',         icon: Webhook,         label: 'WhatsApp Setup' },
  { to: '/teams',           icon: Users,           label: 'Teams' },
  { to: '/audit',           icon: Shield,          label: 'Audit Log' },
];

const staffNav = [
  { to: '/dashboard',   icon: LayoutDashboard, label: 'Dashboard' },
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

export default function Sidebar({ mobileOpen, onClose }: SidebarProps) {
  const { user, logout, isAdmin, updateUser } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

  const defaultNav = isAdmin ? adminNav : staffNav;
  const role       = user?.role || 'staff';
  const userId     = user?.id   || 'unknown';

  const [navItems,   setNavItems]   = useState<NavItem[]>(() => loadOrder(defaultNav, role, userId));
  const [editMode,   setEditMode]   = useState(false);
  const [dragIdx,    setDragIdx]    = useState<number | null>(null);
  // Ref-based drag source — avoids stale-closure & inside-setState mutation bugs
  const dragFromRef                 = useRef<number | null>(null);
  const navItemsRef                 = useRef<NavItem[]>(navItems);
  // Keep ref in sync with state
  useEffect(() => { navItemsRef.current = navItems; }, [navItems]);

  const [exporting,          setExporting]          = useState(false);
  const [attendanceLoading,  setAttendanceLoading]  = useState(false);
  const [showBroadcast,      setShowBroadcast]      = useState(false);
  const [broadcastMsg,       setBroadcastMsg]       = useState('');
  const [sending,            setSending]            = useState(false);

  const isActive = user?.attendanceStatus === 'active';

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
  const handleAttendance  = async () => {
    if (attendanceLoading) return;
    setAttendanceLoading(true);
    try {
      const updated = isActive ? await staffAPI.checkout() : await staffAPI.checkin();
      updateUser({ ...user!, ...updated });
    } catch { /* non-fatal */ }
    finally { setAttendanceLoading(false); }
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
        fixed top-0 left-0 h-full w-64 z-50 flex flex-col
        bg-dark-400 border-r border-dark-50
        transform transition-transform duration-300 ease-out
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 lg:static lg:z-auto
      `}>
        {/* Logo */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-dark-50">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="KJ"
              className="w-9 h-9 rounded-full object-cover flex-shrink-0"
              style={{ boxShadow: '0 0 10px rgba(201,168,76,0.3)' }}
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

        {/* User pill */}
        <div className="mx-4 mt-4 mb-2 p-3 rounded-xl bg-dark-300 border border-dark-50">
          <div className="flex items-center gap-3">
            <div className="relative flex-shrink-0">
              <div className="w-8 h-8 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center">
                <span className="text-gold text-xs font-bold">{user?.avatar || 'U'}</span>
              </div>
              <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-dark-300 transition-colors ${
                isActive ? 'bg-green-400' : 'bg-white/25'
              }`} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-white text-sm font-medium truncate">{user?.name}</p>
              <p className="text-white/30 text-xs capitalize flex items-center gap-1.5">
                {user?.role}
                {user?.role === 'staff' && (
                  <span className={`text-[10px] font-medium ${isActive ? 'text-green-400' : 'text-white/25'}`}>
                    · {isActive ? 'Active' : 'Inactive'}
                  </span>
                )}
              </p>
            </div>
          </div>

          {user?.role === 'staff' && (
            <button
              onClick={handleAttendance}
              disabled={attendanceLoading}
              className={`w-full mt-2.5 text-[11px] py-1.5 px-3 rounded-lg border transition-all flex items-center justify-center gap-1.5 font-medium ${
                isActive
                  ? 'border-red-500/20 text-red-400/80 hover:bg-red-500/10 hover:text-red-400'
                  : 'border-green-500/20 text-green-400/80 hover:bg-green-500/10 hover:text-green-400'
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-red-400' : 'bg-green-400'}`} />
              {attendanceLoading ? 'Please wait…' : isActive ? 'Check Out' : 'Check In'}
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-2 overflow-y-auto">
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
                    <Icon size={16} className="flex-shrink-0" />
                    <span className="flex-1">{label}</span>
                    <ChevronRight size={12} className="opacity-0 group-hover:opacity-100" />
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
