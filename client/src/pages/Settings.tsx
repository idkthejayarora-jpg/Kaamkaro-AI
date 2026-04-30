import { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon, Lock, Palette, Users,
  Eye, EyeOff, CheckCircle, AlertTriangle, Copy, Sun, Moon,
  ChevronRight, RefreshCw,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme, ACCENT_PRESETS, AccentPreset } from '../contexts/ThemeContext';
import { authAPI } from '../lib/api';

// ── Tiny section wrapper ───────────────────────────────────────────────────────
function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2 pb-3 border-b border-dark-50">
        <span className="text-gold">{icon}</span>
        <h2 className="text-white font-semibold">{title}</h2>
      </div>
      {children}
    </div>
  );
}

// ── Toast helper ───────────────────────────────────────────────────────────────
function Toast({ msg, ok }: { msg: string; ok: boolean }) {
  return (
    <div className={`flex items-center gap-2 text-sm px-4 py-2 rounded-xl border ${
      ok ? 'bg-green-500/10 border-green-500/20 text-green-400'
         : 'bg-red-500/10 border-red-500/20 text-red-400'
    }`}>
      {ok ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
      {msg}
    </div>
  );
}

// ── AdminUsers sub-component ───────────────────────────────────────────────────
interface UserRow { id: string; name: string; phone?: string; role: string; collection: string; }

function AdminUsers() {
  const [users, setUsers]       = useState<UserRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [copied, setCopied]     = useState('');
  const [resetId, setResetId]   = useState('');
  const [newPwd, setNewPwd]     = useState('');
  const [showPwd, setShowPwd]   = useState(false);
  const [msg, setMsg]           = useState<{ text: string; ok: boolean } | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    authAPI.adminListUsers()
      .then(data => setUsers(data))
      .catch(() => setMsg({ text: 'Failed to load users', ok: false }))
      .finally(() => setLoading(false));
  }, []);

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id).catch(() => {});
    setCopied(id);
    setTimeout(() => setCopied(''), 2000);
  };

  const doReset = async () => {
    if (!resetId || !newPwd.trim()) return;
    setResetting(true);
    try {
      await authAPI.adminResetPassword(resetId, newPwd.trim());
      setMsg({ text: 'Password reset successfully', ok: true });
      setResetId(''); setNewPwd('');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setMsg({ text: e?.response?.data?.error || 'Failed to reset password', ok: false });
    } finally { setResetting(false); }
  };

  if (loading) return <div className="h-24 shimmer rounded-xl" />;

  return (
    <div className="space-y-4">
      {msg && <Toast msg={msg.text} ok={msg.ok} />}

      {/* User list */}
      <div className="space-y-2">
        {users.map(u => (
          <div key={u.id} className="flex items-center gap-3 p-3 bg-dark-200 rounded-xl border border-dark-50">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-white text-sm font-medium">{u.name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                  u.role === 'admin' ? 'bg-gold/15 text-gold' : 'bg-white/5 text-white/40'
                }`}>{u.role}</span>
              </div>
              <p className="text-white/30 text-xs mt-0.5">{u.phone || 'No phone'}</p>
              <p className="text-white/20 text-[10px] font-mono mt-0.5 truncate">{u.id}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => copyId(u.id)}
                className="p-1.5 rounded-lg hover:bg-dark-100 text-white/30 hover:text-gold transition-colors"
                title="Copy user ID"
              >
                {copied === u.id ? <CheckCircle size={13} className="text-green-400" /> : <Copy size={13} />}
              </button>
              <button
                onClick={() => { setResetId(u.id); setNewPwd(''); setMsg(null); }}
                className="text-[11px] px-2 py-1 rounded-lg bg-dark-100 text-white/40 hover:text-gold hover:bg-gold/10 border border-dark-50 transition-colors"
              >
                Reset pwd
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Reset password panel */}
      {resetId && (
        <div className="p-4 bg-dark-200 rounded-xl border border-gold/20 space-y-3">
          <p className="text-white text-sm font-medium">
            Reset password for: <span className="text-gold">{users.find(u => u.id === resetId)?.name}</span>
          </p>
          <div className="relative">
            <input
              type={showPwd ? 'text' : 'password'}
              value={newPwd}
              onChange={e => setNewPwd(e.target.value)}
              placeholder="New password"
              className="input w-full pr-10"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPwd(s => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white"
            >
              {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setResetId('')} className="btn-ghost flex-1 text-sm">Cancel</button>
            <button
              onClick={doReset}
              disabled={!newPwd.trim() || resetting}
              className="btn-primary flex-1 text-sm flex items-center justify-center gap-2"
            >
              {resetting ? <><RefreshCw size={13} className="animate-spin" /> Resetting…</> : 'Reset Password'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Settings page ─────────────────────────────────────────────────────────
export default function Settings() {
  const { user } = useAuth();
  const { theme, toggle, accent, setAccent } = useTheme();
  const isAdmin = user?.role === 'admin';

  // Change-password state
  const [curPwd,   setCurPwd]   = useState('');
  const [newPwd,   setNewPwd]   = useState('');
  const [confPwd,  setConfPwd]  = useState('');
  const [showCur,  setShowCur]  = useState(false);
  const [showNew,  setShowNew]  = useState(false);
  const [pwdMsg,   setPwdMsg]   = useState<{ text: string; ok: boolean } | null>(null);
  const [saving,   setSaving]   = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPwd !== confPwd) return setPwdMsg({ text: 'New passwords do not match', ok: false });
    if (newPwd.length < 4) return setPwdMsg({ text: 'Password must be at least 4 characters', ok: false });
    setSaving(true); setPwdMsg(null);
    try {
      await authAPI.changePassword(curPwd, newPwd);
      setPwdMsg({ text: 'Password changed successfully', ok: true });
      setCurPwd(''); setNewPwd(''); setConfPwd('');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setPwdMsg({ text: e?.response?.data?.error || 'Failed to change password', ok: false });
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <SettingsIcon size={18} className="text-gold" />
          <h1 className="text-2xl font-bold text-white">Settings</h1>
        </div>
        <p className="text-white/40 text-sm">Manage your account, security, and appearance.</p>
      </div>

      {/* Profile info */}
      <Section title="Profile" icon={<Users size={16} />}>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-gold/20 border-2 border-gold/30 flex items-center justify-center flex-shrink-0">
            <span className="text-gold text-lg font-bold">{user?.avatar || user?.name?.[0] || 'U'}</span>
          </div>
          <div>
            <p className="text-white font-semibold">{user?.name}</p>
            <p className="text-white/40 text-sm capitalize">{user?.role}</p>
            <p className="text-white/20 text-xs font-mono mt-0.5">{user?.phone}</p>
          </div>
        </div>
        <div className="bg-dark-200 rounded-xl p-3 border border-dark-50">
          <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">Your User ID</p>
          <div className="flex items-center gap-2">
            <p className="text-white/60 text-xs font-mono flex-1 truncate">{user?.id}</p>
            <button
              onClick={() => { navigator.clipboard.writeText(user?.id || '').catch(() => {}); }}
              className="text-white/30 hover:text-gold transition-colors"
              title="Copy ID"
            >
              <Copy size={13} />
            </button>
          </div>
        </div>
      </Section>

      {/* Change password */}
      <Section title="Change Password" icon={<Lock size={16} />}>
        <form onSubmit={handleChangePassword} className="space-y-3">
          {pwdMsg && <Toast msg={pwdMsg.text} ok={pwdMsg.ok} />}

          <div className="relative">
            <label className="text-white/40 text-xs mb-1 block">Current password</label>
            <input
              type={showCur ? 'text' : 'password'}
              value={curPwd}
              onChange={e => setCurPwd(e.target.value)}
              placeholder="Enter current password"
              className="input w-full pr-10"
              required
            />
            <button type="button" onClick={() => setShowCur(s => !s)}
              className="absolute right-3 bottom-2.5 text-white/30 hover:text-white">
              {showCur ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>

          <div className="relative">
            <label className="text-white/40 text-xs mb-1 block">New password</label>
            <input
              type={showNew ? 'text' : 'password'}
              value={newPwd}
              onChange={e => setNewPwd(e.target.value)}
              placeholder="At least 4 characters"
              className="input w-full pr-10"
              required
            />
            <button type="button" onClick={() => setShowNew(s => !s)}
              className="absolute right-3 bottom-2.5 text-white/30 hover:text-white">
              {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>

          <div>
            <label className="text-white/40 text-xs mb-1 block">Confirm new password</label>
            <input
              type="password"
              value={confPwd}
              onChange={e => setConfPwd(e.target.value)}
              placeholder="Repeat new password"
              className="input w-full"
              required
            />
          </div>

          <button
            type="submit"
            disabled={saving || !curPwd || !newPwd || !confPwd}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {saving ? <><RefreshCw size={14} className="animate-spin" /> Saving…</> : 'Update Password'}
          </button>
        </form>
      </Section>

      {/* Appearance */}
      <Section title="Appearance" icon={<Palette size={16} />}>
        {/* Theme toggle */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-white text-sm font-medium">Theme</p>
            <p className="text-white/40 text-xs">Switch between dark and light mode</p>
          </div>
          <button
            onClick={toggle}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-dark-200 border border-dark-50 text-white/60 hover:text-gold hover:border-gold/30 transition-all text-sm"
          >
            {theme === 'dark' ? <><Moon size={14} /> Dark</> : <><Sun size={14} /> Light</>}
            <ChevronRight size={12} className="text-white/20" />
          </button>
        </div>

        {/* Accent colour */}
        <div>
          <p className="text-white text-sm font-medium mb-1">Accent Colour</p>
          <p className="text-white/40 text-xs mb-3">Changes the highlight colour throughout the app</p>
          <div className="grid grid-cols-4 gap-2">
            {ACCENT_PRESETS.map(preset => (
              <button
                key={preset.name}
                onClick={() => setAccent(preset as AccentPreset)}
                className={`group relative flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all ${
                  accent.name === preset.name
                    ? 'border-white/40 bg-white/5'
                    : 'border-dark-50 hover:border-white/20 hover:bg-white/5'
                }`}
              >
                <div
                  className="w-7 h-7 rounded-full ring-2 ring-offset-2 ring-offset-dark-300 transition-all"
                  style={{
                    backgroundColor: preset.main,
                    ringColor: accent.name === preset.name ? preset.main : 'transparent',
                    boxShadow: accent.name === preset.name ? `0 0 0 2px ${preset.main}` : 'none',
                  }}
                />
                <span className="text-[10px] text-white/40 group-hover:text-white/60">{preset.name}</span>
                {accent.name === preset.name && (
                  <CheckCircle size={10} className="absolute top-1.5 right-1.5 text-white/60" />
                )}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* Admin: user management */}
      {isAdmin && (
        <Section title="User Management" icon={<Users size={16} />}>
          <p className="text-white/40 text-xs">View user IDs and reset passwords for any account.</p>
          <AdminUsers />
        </Section>
      )}
    </div>
  );
}
