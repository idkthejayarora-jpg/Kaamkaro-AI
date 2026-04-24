import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, UserCheck, Building2,
  BookOpen, Sparkles, LogOut, Menu, X, ChevronRight,
  ClipboardList, Shield, Download, Trophy, Clock, Target,
  Sun, Moon, FileText, Webhook, Radio,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { exportAPI, staffAPI, broadcastAPI } from '../lib/api';
import { useState } from 'react';

const adminNav = [
  { to: '/dashboard',       icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/staff',           icon: Users,           label: 'Staff' },
  { to: '/customers',       icon: UserCheck,       label: 'Customers' },
  { to: '/vendors',         icon: Building2,       label: 'Vendors' },
  { to: '/tasks',           icon: ClipboardList,   label: 'Tasks' },
  { to: '/diary',           icon: BookOpen,        label: 'Diary' },
  { to: '/leaderboard',     icon: Trophy,          label: 'Leaderboard' },
  { to: '/followup',        icon: Clock,           label: 'Follow-up Queue' },
  { to: '/goals',           icon: Target,          label: 'Goals' },
  { to: '/recommendations', icon: Sparkles,        label: 'AI Insights' },
  { to: '/templates',       icon: FileText,        label: 'Templates' },
  { to: '/webhook',         icon: Webhook,         label: 'WhatsApp Setup' },
  { to: '/audit',           icon: Shield,          label: 'Audit Log' },
];

const staffNav = [
  { to: '/dashboard',   icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/customers',   icon: UserCheck,       label: 'My Customers' },
  { to: '/vendors',     icon: Building2,       label: 'Vendors' },
  { to: '/tasks',       icon: ClipboardList,   label: 'Tasks' },
  { to: '/diary',       icon: BookOpen,        label: 'Diary' },
  { to: '/leaderboard', icon: Trophy,          label: 'Leaderboard' },
  { to: '/followup',    icon: Clock,           label: 'Follow-up Queue' },
  { to: '/goals',       icon: Target,          label: 'Goals' },
];

interface SidebarProps {
  mobileOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ mobileOpen, onClose }: SidebarProps) {
  const { user, logout, isAdmin, updateUser } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const nav = isAdmin ? adminNav : staffNav;

  const [exporting,        setExporting]        = useState(false);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [showBroadcast,    setShowBroadcast]    = useState(false);
  const [broadcastMsg,     setBroadcastMsg]     = useState('');
  const [sending,          setSending]          = useState(false);

  const isActive = user?.attendanceStatus === 'active';

  const handleLogout = () => { logout(); navigate('/login'); };

  const handleExport = async () => {
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

  const handleAttendance = async () => {
    if (attendanceLoading) return;
    setAttendanceLoading(true);
    try {
      const updated = isActive ? await staffAPI.checkout() : await staffAPI.checkin();
      updateUser({ ...user!, ...updated });
    } catch { /* non-fatal */ }
    finally { setAttendanceLoading(false); }
  };

  const sendBroadcast = async () => {
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
            <div className="w-8 h-8 rounded-lg bg-gold flex items-center justify-center">
              <span className="text-dark-500 font-black text-xs">K</span>
            </div>
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

        {/* User pill — shows attendance status dot + check-in/out */}
        <div className="mx-4 mt-4 mb-2 p-3 rounded-xl bg-dark-300 border border-dark-50">
          <div className="flex items-center gap-3">
            {/* Avatar with status dot */}
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

          {/* Check-in / Check-out button (staff only) */}
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
          <p className="text-white/20 text-[10px] font-semibold uppercase tracking-widest px-3 mb-2 mt-2">Menu</p>
          <ul className="space-y-0.5">
            {nav.map(({ to, icon: Icon, label }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  onClick={onClose}
                  className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                >
                  <Icon size={16} className="flex-shrink-0" />
                  <span className="flex-1">{label}</span>
                  <ChevronRight size={12} className="opacity-0 group-hover:opacity-100" />
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* Bottom actions */}
        <div className="p-3 border-t border-dark-50 space-y-1">
          {/* Broadcast button — admin only */}
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
