/**
 * AccountSwitcher — Instagram-style account switcher for admins.
 *
 * Shows a bottom-sheet with all active staff accounts.
 * Admin can tap any account to instantly view the app as that staff member.
 * A persistent banner in Layout lets them switch back in one tap.
 */
import { useEffect, useState } from 'react';
import { X, Check, RefreshCw } from 'lucide-react';
import { staffAPI } from '../lib/api';
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

interface Props {
  onClose: () => void;
}

export default function AccountSwitcher({ onClose }: Props) {
  const { user, isSwitched, originalAdmin, switchToStaff, switchBack } = useAuth();
  const [staff,   setStaff]   = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    staffAPI.list()
      .then((s: Staff[]) => setStaff(s.filter(m => m.active !== false)))
      .finally(() => setLoading(false));
  }, []);

  const handleSwitch = async (s: Staff) => {
    if (s.id === user?.id) return; // already this account
    setSwitching(s.id);
    try {
      await switchToStaff(s.id);
      onClose();
    } catch {
      setSwitching(null);
    }
  };

  const handleSwitchBack = () => {
    switchBack();
    onClose();
  };

  // The "real" admin identity (works whether currently switched or not)
  const adminUser = originalAdmin?.user || (user?.role === 'admin' ? user : null);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] animate-fade-in"
        onClick={onClose}
      />

      {/* Sheet — slides up from bottom on mobile, centered on desktop */}
      <div className="fixed inset-x-0 bottom-0 sm:inset-auto sm:left-4 sm:bottom-4 sm:w-72 z-[61] animate-slide-up">
        <div className="bg-dark-300 border border-dark-50 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden">

          {/* Handle / header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-dark-50">
            <p className="text-white font-semibold text-sm">Switch Account</p>
            <button onClick={onClose} className="text-white/30 hover:text-white transition-colors p-0.5">
              <X size={16} />
            </button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {/* Currently logged-in account */}
            <div className="px-4 pt-3 pb-1">
              <p className="text-white/25 text-[10px] uppercase tracking-widest font-medium mb-2">
                {isSwitched ? 'Viewing As' : 'Logged In As'}
              </p>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-gold/5 border border-gold/20">
                <div className="relative flex-shrink-0">
                  <div className="w-10 h-10 rounded-full bg-gold/20 border-2 border-gold/40 flex items-center justify-center">
                    <span className="text-gold font-bold text-sm">{user?.avatar || user?.name?.[0]}</span>
                  </div>
                  <Check size={10} className="absolute -bottom-0.5 -right-0.5 bg-gold text-dark-500 rounded-full p-0.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-sm truncate">{user?.name}</p>
                  <p className="text-white/40 text-xs capitalize">{user?.role}</p>
                </div>
              </div>
            </div>

            {/* Switch back to admin — only shown when switched */}
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

            {/* Staff list */}
            <div className="px-4 pt-2 pb-4">
              <p className="text-white/25 text-[10px] uppercase tracking-widest font-medium mb-2">
                {isSwitched ? 'Switch To' : 'View As Staff'}
              </p>

              {loading ? (
                <div className="flex items-center justify-center py-8 text-white/30 text-sm">
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
                        onClick={() => handleSwitch(s)}
                        disabled={isCurrent || !!switching}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left
                          ${isCurrent
                            ? 'bg-dark-200 border-dark-50 opacity-50 cursor-default'
                            : 'bg-dark-200 hover:bg-dark-100 border-dark-50 hover:border-gold/25 active:scale-[0.98]'
                          }`}
                      >
                        {/* Avatar */}
                        <div className="relative flex-shrink-0">
                          <div className="w-9 h-9 rounded-full bg-dark-100 border border-dark-50 flex items-center justify-center">
                            <span className="text-white/70 font-semibold text-sm">{s.avatar || s.name?.[0]}</span>
                          </div>
                          {/* Availability dot */}
                          <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-dark-200 ${AVAIL_DOT[avail] || 'bg-white/20'}`} />
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-medium truncate">{s.name}</p>
                          <p className="text-white/30 text-[11px]">{AVAIL_LABEL[avail] || 'Staff'}</p>
                        </div>

                        {/* State indicator */}
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
    </>
  );
}
