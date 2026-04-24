import { Outlet } from 'react-router-dom';
import { useState } from 'react';
import Sidebar, { MobileMenuButton } from './Sidebar';
import KamalAssistant from './KamalAssistant';
import NotificationsBell from './NotificationsBell';
import { useSSE } from '../hooks/useSSE';
import { useAuth } from '../contexts/AuthContext';
import { X, Radio, CheckCheck } from 'lucide-react';

// ── Admin broadcast chime — three ascending sine tones ────────────────────────
function playChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const notes = [523.25, 659.25, 783.99]; // C5 → E5 → G5
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.type           = 'sine';
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + i * 0.2;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.28, t0 + 0.025);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.65);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.65);
    });
    setTimeout(() => ctx.close(), 2500);
  } catch { /* audio not available */ }
}

interface BroadcastMsg { id: string; message: string; sentBy: string; }

function getReadBroadcasts(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem('kk_broadcasts_read') || '[]')); }
  catch { return new Set(); }
}
function markBroadcastRead(id: string) {
  const s = getReadBroadcasts();
  s.add(id);
  localStorage.setItem('kk_broadcasts_read', JSON.stringify([...s]));
}

export default function Layout() {
  const { isAdmin } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [broadcast,  setBroadcast]  = useState<BroadcastMsg | null>(null);

  // Admins never see the broadcast popup — they sent it and have their own alert system.
  // Staff see it until they explicitly click "Mark as Read".
  useSSE({
    'admin:broadcast': (data) => {
      if (isAdmin) return;
      const d = data as BroadcastMsg;
      // Skip if already acknowledged in a previous session
      if (getReadBroadcasts().has(d.id)) return;
      setBroadcast({ id: d.id, message: d.message, sentBy: d.sentBy });
      playChime();
    },
  });

  // No auto-dismiss — broadcast stays until staff clicks "Mark as Read"

  return (
    <div className="flex h-screen bg-dark-500 overflow-hidden">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-dark-50 bg-dark-400 flex-shrink-0">
          <MobileMenuButton onClick={() => setMobileOpen(true)} />
          <div className="flex items-center gap-2">
            <svg width="26" height="26" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0">
              <circle cx="32" cy="32" r="32" fill="#0A0A0A"/>
              <circle cx="32" cy="32" r="30" fill="none" stroke="#C9A84C" strokeWidth="1.2" strokeDasharray="2 1.2" opacity="0.8"/>
              <path d="M32 10 C30 15 28.5 20 28.5 27 C28.5 31 30 33.5 32 33.5 C34 33.5 35.5 31 35.5 27 C35.5 20 34 15 32 10Z" fill="#C9A84C"/>
              <path d="M28 14 C24 18 21.5 24 21.5 30 C21.5 33.5 23 35.5 26 35.5 C28.5 35.5 30 33.5 30 30 C30 24 29 18.5 28 14Z" fill="#C9A84C"/>
              <path d="M36 14 C40 18 42.5 24 42.5 30 C42.5 33.5 41 35.5 38 35.5 C35.5 35.5 34 33.5 34 30 C34 24 35 18.5 36 14Z" fill="#C9A84C"/>
              <path d="M22 20 C17 24 14 30 14 36 C14 39.5 16 41.5 19.5 41.5 C23 41.5 25 39 25.5 35.5 C26 32 24.5 26 22 20Z" fill="#A8872A"/>
              <path d="M42 20 C47 24 50 30 50 36 C50 39.5 48 41.5 44.5 41.5 C41 41.5 39 39 38.5 35.5 C38 32 39.5 26 42 20Z" fill="#A8872A"/>
              <path d="M18 40 C22 37.5 27 36.5 32 36.5 C37 36.5 42 37.5 46 40 C42 42 37 43 32 43 C27 43 22 42 18 40Z" fill="#C9A84C"/>
              <path d="M14 38 C16 34 20 34 23 36 C20 39 15 40.5 14 38Z" fill="#A8872A" opacity="0.85"/>
              <path d="M50 38 C48 34 44 34 41 36 C44 39 49 40.5 50 38Z" fill="#A8872A" opacity="0.85"/>
              <text x="32" y="56" fontFamily="Georgia,Times New Roman,serif" fontSize="11" fontStyle="italic" fontWeight="bold" textAnchor="middle" fill="#C9A84C" letterSpacing="1">KJ</text>
            </svg>
            <span className="text-white font-bold text-sm">Kaamkaro AI</span>
          </div>
          <NotificationsBell />
        </header>

        {/* Desktop header — notifications only */}
        <div className="hidden lg:flex items-center justify-end px-8 py-3 border-b border-dark-50/30 bg-dark-400 flex-shrink-0">
          <NotificationsBell />
        </div>

        <main className="flex-1 overflow-y-auto bg-dark-500">
          {/* pb-28 on mobile gives clearance for Kamal button + iOS home bar */}
          <div className="p-4 pb-28 sm:pb-6 md:p-6 lg:p-8 max-w-7xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Kamal floating AI assistant */}
      <KamalAssistant />

      {/* ── Broadcast popup — staff only, persists until "Mark as Read" ── */}
      {!isAdmin && broadcast && (
        <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-4 pointer-events-none">
          <div className="pointer-events-auto w-full max-w-sm animate-fade-in">
            <div className="rounded-2xl shadow-2xl shadow-gold/20 border border-gold/40 bg-dark-300 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 bg-gold/5 border-b border-gold/20">
                <div className="flex items-center gap-2">
                  <Radio size={14} className="text-gold animate-pulse" />
                  <span className="text-gold text-sm font-semibold tracking-wide">Broadcast</span>
                  <span className="text-white/30 text-xs">· from {broadcast.sentBy}</span>
                </div>
                <button
                  onClick={() => setBroadcast(null)}
                  className="text-white/30 hover:text-white transition-colors p-0.5"
                  title="Dismiss temporarily"
                >
                  <X size={15} />
                </button>
              </div>
              <div className="px-5 py-4">
                <p className="text-white text-sm leading-relaxed">{broadcast.message}</p>
              </div>
              <div className="px-5 pb-4">
                <button
                  onClick={() => {
                    markBroadcastRead(broadcast.id);
                    setBroadcast(null);
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-gold/10 border border-gold/20 text-gold text-sm font-medium hover:bg-gold/20 transition-colors"
                >
                  <CheckCheck size={14} />
                  Mark as Read
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
