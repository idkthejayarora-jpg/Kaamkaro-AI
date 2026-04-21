import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trophy, Flame, TrendingUp, CheckCircle, Target, Wifi, Phone, PhoneOff, Home } from 'lucide-react';
import { aiAPI, staffAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { LeaderboardRow } from '../types';

const AVAILABILITY_CONFIG = {
  available:    { label: 'Available',      color: 'text-green-400',  bg: 'bg-green-500/10', dot: 'bg-green-400', icon: Wifi },
  on_call:      { label: 'On Call',        color: 'text-blue-400',   bg: 'bg-blue-500/10',  dot: 'bg-blue-400',  icon: Phone },
  out_of_office:{ label: 'Out of Office',  color: 'text-white/30',   bg: 'bg-white/5',       dot: 'bg-white/20',  icon: Home },
};

const MEDAL = ['🥇', '🥈', '🥉'];

export default function Leaderboard() {
  const [rows, setRows]       = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod]   = useState<'week' | 'month'>('week');
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      const data = await aiAPI.leaderboard();
      setRows(data);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const updateAvailability = async (id: string, availability: string) => {
    try {
      await staffAPI.setAvailability(id, availability);
      setRows(prev => prev.map(r => r.id === id ? { ...r, availability: availability as LeaderboardRow['availability'] } : r));
    } catch {}
  };

  const sorted = [...rows].sort((a, b) =>
    period === 'week' ? b.weekInteractions - a.weekInteractions : b.monthInteractions - a.monthInteractions
  ).map((r, i) => ({ ...r, displayRank: i + 1 }));

  const myRow = sorted.find(r => r.id === user?.id);

  if (loading) return <div className="space-y-3">{Array(6).fill(0).map((_, i) => <div key={i} className="card h-16 shimmer" />)}</div>;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Trophy size={24} className="text-gold" />
            Leaderboard
          </h1>
          <p className="text-white/30 text-sm mt-1">Weekly team rankings · resets every Monday</p>
        </div>
        <div className="flex gap-1 bg-dark-400 border border-dark-50 rounded-xl p-1">
          {(['week', 'month'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all capitalize ${
                period === p ? 'bg-gold text-dark-500' : 'text-white/40 hover:text-white'
              }`}
            >
              This {p}
            </button>
          ))}
        </div>
      </div>

      {/* My position (for staff) */}
      {!isAdmin && myRow && (
        <div className="card border-gold/30 bg-gold/5">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-black text-gold">#{myRow.displayRank}</span>
            <div className="flex-1">
              <p className="text-white font-semibold text-sm">Your ranking</p>
              <p className="text-white/30 text-xs">{myRow.weekInteractions} interactions this week · {myRow.responseRate}% response rate</p>
            </div>
            <div className="text-right">
              <p className="text-gold font-bold">{myRow.score}</p>
              <p className="text-white/20 text-xs">score</p>
            </div>
          </div>
          {/* Availability selector (self) */}
          <div className="mt-3 pt-3 border-t border-dark-50/50">
            <p className="text-white/30 text-xs mb-2 uppercase tracking-wider font-medium">Your availability</p>
            <div className="flex gap-2">
              {(Object.entries(AVAILABILITY_CONFIG) as [string, typeof AVAILABILITY_CONFIG[keyof typeof AVAILABILITY_CONFIG]][]).map(([key, cfg]) => (
                <button
                  key={key}
                  onClick={() => updateAvailability(user!.id, key)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border ${
                    myRow.availability === key
                      ? `${cfg.bg} ${cfg.color} border-current/30`
                      : 'border-dark-50 text-white/30 hover:text-white hover:border-white/20'
                  }`}
                >
                  <div className={`w-1.5 h-1.5 rounded-full ${myRow.availability === key ? cfg.dot : 'bg-white/20'}`} />
                  {cfg.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Leaderboard table */}
      {sorted.length === 0 ? (
        <div className="card flex flex-col items-center py-16 text-center">
          <Trophy size={36} className="text-white/10 mb-4" />
          <p className="text-white/40 font-medium">No data yet</p>
          <p className="text-white/20 text-sm mt-1">Start logging interactions to appear on the leaderboard</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((row) => {
            const avail = AVAILABILITY_CONFIG[row.availability] || AVAILABILITY_CONFIG.available;
            const isMe  = row.id === user?.id;
            return (
              <div
                key={row.id}
                className={`card cursor-pointer transition-all ${isMe ? 'border-gold/25 bg-gold/3' : ''}`}
                onClick={() => navigate(`/staff/${row.id}`)}
              >
                <div className="flex items-center gap-4">
                  {/* Rank */}
                  <div className="w-8 text-center flex-shrink-0">
                    {row.displayRank <= 3
                      ? <span className="text-xl">{MEDAL[row.displayRank - 1]}</span>
                      : <span className="text-white/30 font-bold text-sm">#{row.displayRank}</span>
                    }
                  </div>

                  {/* Avatar */}
                  <div className="relative flex-shrink-0">
                    <div className="w-10 h-10 rounded-full bg-gold/15 border border-gold/25 flex items-center justify-center">
                      <span className="text-gold font-bold text-sm">{row.avatar}</span>
                    </div>
                    <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-dark-300 ${avail.dot}`} />
                  </div>

                  {/* Name + availability */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-white font-semibold text-sm">{row.name}</p>
                      {isMe && <span className="badge badge-gold text-[10px]">You</span>}
                    </div>
                    <p className={`text-xs ${avail.color}`}>{avail.label}</p>
                  </div>

                  {/* Stats */}
                  <div className="hidden sm:flex items-center gap-5 flex-shrink-0">
                    <div className="text-center">
                      <p className="text-white font-bold text-sm">
                        {period === 'week' ? row.weekInteractions : row.monthInteractions}
                      </p>
                      <p className="text-white/25 text-[10px]">interactions</p>
                    </div>
                    <div className="text-center">
                      <p className="text-white font-bold text-sm">{row.responseRate}%</p>
                      <p className="text-white/25 text-[10px]">response</p>
                    </div>
                    <div className="text-center">
                      <p className="text-gold font-bold text-sm flex items-center gap-1">
                        <Flame size={11} />{row.streak}d
                      </p>
                      <p className="text-white/25 text-[10px]">streak</p>
                    </div>
                    <div className="text-center">
                      <p className="text-green-400 font-bold text-sm">{row.closedCount}</p>
                      <p className="text-white/25 text-[10px]">closed</p>
                    </div>
                  </div>

                  {/* Score */}
                  <div className="text-right flex-shrink-0">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-full border-2 border-gold/30 bg-gold/5">
                      <span className="text-gold font-black text-sm">{row.score}</span>
                    </div>
                  </div>
                </div>

                {/* Mini stats bar on mobile */}
                <div className="flex sm:hidden items-center gap-4 mt-3 pt-3 border-t border-dark-50/50 text-xs text-white/40">
                  <span className="flex items-center gap-1"><TrendingUp size={10} />{row.weekInteractions} interactions</span>
                  <span>{row.responseRate}% response</span>
                  <span className="flex items-center gap-1 text-gold/70"><Flame size={10} />{row.streak}d</span>
                  <span className="flex items-center gap-1 text-green-400/70"><CheckCircle size={10} />{row.closedCount}</span>
                </div>

                {/* Availability changer (admin only) */}
                {isAdmin && (
                  <div className="mt-3 pt-3 border-t border-dark-50/50 flex items-center gap-2 flex-wrap"
                    onClick={e => e.stopPropagation()}>
                    <span className="text-white/20 text-[10px] uppercase tracking-wider font-medium">Status:</span>
                    {(Object.entries(AVAILABILITY_CONFIG) as [string, typeof AVAILABILITY_CONFIG[keyof typeof AVAILABILITY_CONFIG]][]).map(([key, cfg]) => (
                      <button
                        key={key}
                        onClick={() => updateAvailability(row.id, key)}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium transition-all border ${
                          row.availability === key
                            ? `${cfg.bg} ${cfg.color} border-current/20`
                            : 'border-dark-50 text-white/20 hover:text-white/50'
                        }`}
                      >
                        <div className={`w-1 h-1 rounded-full ${row.availability === key ? cfg.dot : 'bg-white/20'}`} />
                        {cfg.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Score legend */}
      <div className="card border-dark-50/50">
        <p className="text-white/30 text-xs font-medium uppercase tracking-wider mb-3">How score is calculated</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Response rate', weight: '35%', icon: Target },
            { label: 'Interactions', weight: '30%', icon: TrendingUp },
            { label: 'Streak', weight: '20%', icon: Flame },
            { label: 'Deals closed', weight: '15%', icon: CheckCircle },
          ].map(({ label, weight, icon: Icon }) => (
            <div key={label} className="flex items-center gap-2 p-2.5 rounded-lg bg-dark-200">
              <Icon size={12} className="text-gold flex-shrink-0" />
              <div>
                <p className="text-white/60 text-[10px]">{label}</p>
                <p className="text-gold font-bold text-xs">{weight}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
