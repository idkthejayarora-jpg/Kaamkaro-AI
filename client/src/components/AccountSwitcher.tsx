/**
 * AccountSwitcher — Switch between staff accounts and manage attendance managers.
 *
 * Admins can:
 * - View as any active staff member
 * - Switch into an attendance manager account
 * - Create new attendance manager accounts (credentials displayed after creation)
 * - Reset a manager's password
 * - Remove a manager
 */
import { useEffect, useState } from 'react';
import {
  X, Check, RefreshCw, UserPlus, Eye, EyeOff, Copy, Trash2,
  KeyRound, CalendarClock, ChevronDown, ChevronUp,
} from 'lucide-react';
import { authAPI, staffAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { Staff } from '../types';

const AVAIL_DOT: Record<string, string> = {
  available:      'bg-green-400',
  on_call:        'bg-yellow-400',
  out_of_office:  'bg-white/20',
};
const AVAIL_LABEL: Record<string, string> = {
  available:      'Available',
  on_call:        'On call',
  out_of_office:  'Out of office',
};

interface Manager {
  id: string;
  name: string;
  phone: string;
  avatar: string;
  role: string;
  createdAt: string;
}

interface NewCreds { name: string; phone: string; password: string; }

interface Props { onClose: () => void; }

export default function AccountSwitcher({ onClose }: Props) {
  const { user, isSwitched, originalAdmin, switchToStaff, switchBack } = useAuth();

  // Staff
  const [staff,    setStaff]    = useState<Staff[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);

  // Managers
  const [managers,    setManagers]    = useState<Manager[]>([]);
  const [mgrsOpen,    setMgrsOpen]    = useState(true);
  const [mgrsLoading, setMgrsLoading] = useState(true);

  // Create manager form
  const [creating,   setCreating]   = useState(false);
  const [form,       setForm]       = useState({ name: '', phone: '', password: '' });
  const [showPw,     setShowPw]     = useState(false);
  const [formBusy,   setFormBusy]   = useState(false);
  const [formErr,    setFormErr]    = useState('');
  const [newCreds,   setNewCreds]   = useState<NewCreds | null>(null);

  // Reset password
  const [resetFor,   setResetFor]   = useState<Manager | null>(null);
  const [resetPw,    setResetPw]    = useState('');
  const [resetShowPw, setResetShowPw] = useState(false);
  const [resetBusy,  setResetBusy]  = useState(false);
  const [resetDone,  setResetDone]  = useState<NewCreds | null>(null);

  // Delete confirm
  const [deleteFor,  setDeleteFor]  = useState<Manager | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    staffAPI.list()
      .then((s: Staff[]) => setStaff(s.filter(m => m.active !== false)))
      .finally(() => setStaffLoading(false));
    authAPI.listManagers()
      .then(setManagers)
      .finally(() => setMgrsLoading(false));
  }, []);

  const handleSwitch = async (id: string) => {
    if (id === user?.id) return;
    setSwitching(id);
    try {
      await switchToStaff(id);
      onClose();
    } catch {
      setSwitching(null);
    }
  };

  const handleSwitchBack = () => { switchBack(); onClose(); };

  const copyText = (text: string) => navigator.clipboard.writeText(text).catch(() => {});

  // ── Create manager ────────────────────────────────────────────────────────────
  const handleCreate = async () => {
    setFormErr('');
    if (!form.name.trim() || !form.phone.trim() || !form.password.trim()) {
      setFormErr('All fields are required'); return;
    }
    if (form.password.length < 4) {
      setFormErr('Password must be at least 4 characters'); return;
    }
    setFormBusy(true);
    try {
      const res = await authAPI.createManager(form);
      setManagers(prev => [...prev, res.manager]);
      setNewCreds({ name: res.manager.name, phone: res.manager.phone, password: res.plainPassword });
      setCreating(false);
      setForm({ name: '', phone: '', password: '' });
      setShowPw(false);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setFormErr(msg || 'Failed to create manager');
    } finally {
      setFormBusy(false);
    }
  };

  // ── Reset password ────────────────────────────────────────────────────────────
  const handleReset = async () => {
    if (!resetFor || resetPw.length < 4) return;
    setResetBusy(true);
    try {
      await authAPI.resetManagerPassword(resetFor.id, resetPw);
      setResetDone({ name: resetFor.name, phone: resetFor.phone, password: resetPw });
      setResetFor(null);
      setResetPw('');
    } catch {
      // silent
    } finally {
      setResetBusy(false);
    }
  };

  // ── Delete manager ────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteFor) return;
    setDeleteBusy(true);
    try {
      await authAPI.deleteManager(deleteFor.id);
      setManagers(prev => prev.filter(m => m.id !== deleteFor.id));
      setDeleteFor(null);
    } catch {
      // silent
    } finally {
      setDeleteBusy(false);
    }
  };

  const adminUser = originalAdmin?.user || (user?.role === 'admin' ? user : null);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] animate-fade-in"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="fixed inset-x-0 bottom-0 sm:inset-auto sm:left-4 sm:bottom-4 sm:w-80 z-[61] animate-slide-up">
        <div className="bg-dark-300 border border-dark-50 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-dark-50">
            <p className="text-white font-semibold text-sm">Switch Account</p>
            <button onClick={onClose} className="text-white/30 hover:text-white transition-colors p-0.5">
              <X size={16} />
            </button>
          </div>

          <div className="max-h-[75vh] overflow-y-auto">

            {/* Currently active account */}
            <div className="px-4 pt-3 pb-1">
              <p className="text-white/25 text-[10px] uppercase tracking-widest font-medium mb-2">
                {isSwitched ? 'Viewing As' : 'Logged In As'}
              </p>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-gold/5 border border-gold/20">
                <div className="relative flex-shrink-0">
                  <div className="w-10 h-10 rounded-full bg-gold/20 border-2 border-gold/40 flex items-center justify-center">
                    <span className="text-gold font-bold text-sm">{user?.avatar || user?.name?.[0]}</span>
                  </div>
                  <Check size={10} className="absolute -bottom-0.5 -right-0.5 bg-gold text-white rounded-full p-0.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-sm truncate">{user?.name}</p>
                  <p className="text-white/40 text-xs capitalize">{user?.role?.replace('_', ' ')}</p>
                </div>
              </div>
            </div>

            {/* Switch back to admin */}
            {isSwitched && adminUser && (
              <div className="px-4 pt-2 pb-1">
                <p className="text-white/25 text-[10px] uppercase tracking-widest font-medium mb-2">Admin Account</p>
                <button
                  onClick={handleSwitchBack}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-dark-200 hover:bg-dark-100 border border-dark-50 hover:border-gold/30 transition-all group"
                >
                  <div className="w-10 h-10 rounded-full bg-gold/15 border border-gold/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-gold font-bold text-sm">{adminUser.avatar || adminUser.name?.[0]}</span>
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <p className="text-white text-sm font-medium truncate group-hover:text-gold transition-colors">
                      {adminUser.name}
                    </p>
                    <p className="text-white/40 text-xs">Admin · Switch back</p>
                  </div>
                  <RefreshCw size={14} className="text-white/25 group-hover:text-gold transition-colors flex-shrink-0" />
                </button>
              </div>
            )}

            {/* ── Attendance Managers section ─────────────────────────────────── */}
            <div className="px-4 pt-3 pb-1">
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={() => setMgrsOpen(o => !o)}
                  className="flex items-center gap-1.5 text-white/25 text-[10px] uppercase tracking-widest font-medium hover:text-white/50 transition-colors"
                >
                  <CalendarClock size={11} />
                  Attendance Managers
                  {mgrsOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                </button>
                <button
                  onClick={() => { setCreating(c => !c); setFormErr(''); setNewCreds(null); }}
                  className="flex items-center gap-1 text-gold/60 hover:text-gold text-[10px] font-medium transition-colors"
                >
                  <UserPlus size={11} />
                  New
                </button>
              </div>

              {/* Create form */}
              {creating && (
                <div className="mb-2 p-3 rounded-xl bg-dark-200 border border-dark-50 space-y-2">
                  <p className="text-white/60 text-xs font-medium">New Attendance Manager</p>
                  <input
                    type="text"
                    placeholder="Full name"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full bg-dark-100 border border-dark-50 rounded-lg px-3 py-2 text-white text-xs placeholder-white/20 focus:outline-none focus:border-gold/40"
                  />
                  <input
                    type="text"
                    placeholder="Login ID (phone / username)"
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    className="w-full bg-dark-100 border border-dark-50 rounded-lg px-3 py-2 text-white text-xs placeholder-white/20 focus:outline-none focus:border-gold/40"
                  />
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      placeholder="Password (min 4 chars)"
                      value={form.password}
                      onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && handleCreate()}
                      className="w-full bg-dark-100 border border-dark-50 rounded-lg px-3 py-2 pr-9 text-white text-xs placeholder-white/20 focus:outline-none focus:border-gold/40"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(v => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                    >
                      {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                  {formErr && <p className="text-red-400 text-[11px]">{formErr}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={handleCreate}
                      disabled={formBusy}
                      className="flex-1 bg-gold text-black text-xs font-semibold py-2 rounded-lg hover:bg-gold/90 transition disabled:opacity-50"
                    >
                      {formBusy ? 'Creating…' : 'Create Manager'}
                    </button>
                    <button
                      onClick={() => { setCreating(false); setFormErr(''); }}
                      className="px-3 py-2 text-white/40 hover:text-white text-xs transition"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* New credentials card */}
              {newCreds && (
                <CredentialsCard
                  creds={newCreds}
                  onClose={() => setNewCreds(null)}
                  copyText={copyText}
                />
              )}

              {/* Reset done card */}
              {resetDone && (
                <CredentialsCard
                  creds={resetDone}
                  label="Password Reset"
                  onClose={() => setResetDone(null)}
                  copyText={copyText}
                />
              )}

              {/* Managers list */}
              {mgrsOpen && (
                mgrsLoading ? (
                  <div className="flex items-center justify-center py-4 text-white/30 text-xs">
                    <RefreshCw size={12} className="animate-spin mr-1.5" /> Loading…
                  </div>
                ) : managers.length === 0 && !creating ? (
                  <p className="text-white/20 text-xs text-center py-3">No managers yet — tap New above</p>
                ) : (
                  <div className="space-y-1 mb-1">
                    {managers.map(m => {
                      const isCurrent  = m.id === user?.id;
                      const isSpinning = switching === m.id;
                      return (
                        <div
                          key={m.id}
                          className="flex items-center gap-2.5 p-2.5 rounded-xl bg-dark-200 border border-dark-50 group"
                        >
                          {/* Avatar */}
                          <div className="w-9 h-9 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
                            <span className="text-amber-400 font-bold text-sm">{m.avatar || m.name?.[0]}</span>
                          </div>
                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-xs font-medium truncate">{m.name}</p>
                            <p className="text-white/30 text-[10px] font-mono">{m.phone}</p>
                          </div>
                          {/* Hover actions */}
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => { setResetFor(m); setResetPw(''); setResetDone(null); setResetShowPw(false); }}
                              title="Reset password"
                              className="p-1.5 text-white/30 hover:text-amber-400 transition-colors rounded"
                            >
                              <KeyRound size={12} />
                            </button>
                            <button
                              onClick={() => setDeleteFor(m)}
                              title="Remove manager"
                              className="p-1.5 text-white/30 hover:text-red-400 transition-colors rounded"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                          {/* Switch button */}
                          <button
                            onClick={() => handleSwitch(m.id)}
                            disabled={isCurrent || !!switching}
                            className={`flex-shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all
                              ${isCurrent
                                ? 'bg-amber-500/10 text-amber-400 cursor-default'
                                : 'bg-dark-100 hover:bg-amber-500/20 hover:text-amber-400 text-white/50 active:scale-95'
                              }`}
                          >
                            {isCurrent
                              ? <Check size={12} />
                              : isSpinning
                                ? <RefreshCw size={12} className="animate-spin" />
                                : 'Switch'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )
              )}
            </div>

            {/* ── Staff section ───────────────────────────────────────────────── */}
            <div className="px-4 pt-2 pb-4">
              <p className="text-white/25 text-[10px] uppercase tracking-widest font-medium mb-2">
                {isSwitched ? 'Switch To' : 'View As Staff'}
              </p>

              {staffLoading ? (
                <div className="flex items-center justify-center py-6 text-white/30 text-sm">
                  <RefreshCw size={14} className="animate-spin mr-2" /> Loading…
                </div>
              ) : staff.length === 0 ? (
                <p className="text-white/20 text-sm text-center py-4">No active staff found</p>
              ) : (
                <div className="space-y-1">
                  {staff.map(s => {
                    const isCurrent  = s.id === user?.id;
                    const isSpinning = switching === s.id;
                    const avail      = s.availability || 'available';

                    return (
                      <button
                        key={s.id}
                        onClick={() => handleSwitch(s.id)}
                        disabled={isCurrent || !!switching}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left
                          ${isCurrent
                            ? 'bg-dark-200 border-dark-50 opacity-50 cursor-default'
                            : 'bg-dark-200 hover:bg-dark-100 border-dark-50 hover:border-gold/25 active:scale-[0.98]'
                          }`}
                      >
                        <div className="relative flex-shrink-0">
                          <div className="w-9 h-9 rounded-full bg-dark-100 border border-dark-50 flex items-center justify-center">
                            <span className="text-white/70 font-semibold text-sm">{s.avatar || s.name?.[0]}</span>
                          </div>
                          <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-dark-200 ${AVAIL_DOT[avail] || 'bg-white/20'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-medium truncate">{s.name}</p>
                          <p className="text-white/30 text-[11px]">{AVAIL_LABEL[avail] || 'Staff'}</p>
                        </div>
                        {isCurrent ? (
                          <Check size={14} className="text-gold flex-shrink-0" />
                        ) : isSpinning ? (
                          <RefreshCw size={14} className="text-white/40 animate-spin flex-shrink-0" />
                        ) : (
                          <div className="w-5 h-5 rounded-full border border-dark-50 flex-shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Reset password modal */}
      {resetFor && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setResetFor(null)} />
          <div className="relative bg-dark-300 border border-dark-50 rounded-2xl p-5 w-full max-w-xs shadow-2xl space-y-3">
            <p className="text-white font-semibold text-sm">Reset Password</p>
            <p className="text-white/40 text-xs">For <span className="text-white">{resetFor.name}</span> · <span className="font-mono">{resetFor.phone}</span></p>
            <div className="relative">
              <input
                type={resetShowPw ? 'text' : 'password'}
                placeholder="New password (min 4 chars)"
                value={resetPw}
                onChange={e => setResetPw(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleReset()}
                className="w-full bg-dark-100 border border-dark-50 rounded-xl px-3 py-2.5 pr-9 text-white text-sm placeholder-white/20 focus:outline-none focus:border-gold/40"
              />
              <button
                type="button"
                onClick={() => setResetShowPw(v => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
              >
                {resetShowPw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleReset}
                disabled={resetBusy || resetPw.length < 4}
                className="flex-1 bg-gold text-black text-sm font-semibold py-2.5 rounded-xl hover:bg-gold/90 transition disabled:opacity-40"
              >
                {resetBusy ? 'Saving…' : 'Reset Password'}
              </button>
              <button onClick={() => setResetFor(null)} className="px-4 text-white/40 hover:text-white text-sm transition">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteFor && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setDeleteFor(null)} />
          <div className="relative bg-dark-300 border border-dark-50 rounded-2xl p-5 w-full max-w-xs shadow-2xl space-y-3">
            <p className="text-white font-semibold text-sm">Remove Manager?</p>
            <p className="text-white/40 text-xs">
              <span className="text-white">{deleteFor.name}</span> will lose access to the attendance portal immediately.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleDelete}
                disabled={deleteBusy}
                className="flex-1 bg-red-500/20 border border-red-500/40 text-red-400 text-sm font-semibold py-2.5 rounded-xl hover:bg-red-500/30 transition disabled:opacity-40"
              >
                {deleteBusy ? 'Removing…' : 'Yes, Remove'}
              </button>
              <button onClick={() => setDeleteFor(null)} className="px-4 text-white/40 hover:text-white text-sm transition">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Credentials display card ──────────────────────────────────────────────────
function CredentialsCard({
  creds, label = 'Manager Created', onClose, copyText,
}: {
  creds: NewCreds;
  label?: string;
  onClose: () => void;
  copyText: (t: string) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = (text: string, key: string) => {
    copyText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="mb-2 p-3.5 rounded-xl bg-gold/5 border border-gold/30 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Check size={12} className="text-gold" />
          <p className="text-gold text-xs font-semibold">{label}</p>
        </div>
        <button onClick={onClose} className="text-white/30 hover:text-white transition-colors">
          <X size={13} />
        </button>
      </div>
      <p className="text-white/35 text-[10px]">Save these — password won't be shown again.</p>

      <CredRow label="Name"     value={creds.name}     field="name"     copied={copied} onCopy={handleCopy} />
      <CredRow label="Login ID" value={creds.phone}    field="phone"    copied={copied} onCopy={handleCopy} mono />
      <CredRow label="Password" value={creds.password} field="password" copied={copied} onCopy={handleCopy} mono />

      <button
        onClick={() => handleCopy(`Name: ${creds.name}\nLogin ID: ${creds.phone}\nPassword: ${creds.password}`, 'all')}
        className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-gold/10 hover:bg-gold/20 border border-gold/20 rounded-lg text-gold text-[11px] font-medium transition"
      >
        {copied === 'all' ? <Check size={11} /> : <Copy size={11} />}
        {copied === 'all' ? 'Copied!' : 'Copy All Credentials'}
      </button>
    </div>
  );
}

function CredRow({
  label, value, field, copied, onCopy, mono = false,
}: {
  label: string; value: string; field: string;
  copied: string | null; onCopy: (v: string, f: string) => void; mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-white/30 text-[10px] w-14 flex-shrink-0">{label}</span>
      <span className={`flex-1 text-white text-xs truncate ${mono ? 'font-mono' : ''}`}>{value}</span>
      <button
        onClick={() => onCopy(value, field)}
        className="text-white/25 hover:text-gold transition-colors flex-shrink-0"
        title="Copy"
      >
        {copied === field ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
      </button>
    </div>
  );
}
