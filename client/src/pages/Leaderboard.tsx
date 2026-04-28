import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trophy, TrendingUp, CheckCircle, Target, Wifi, Phone, Home, RotateCcw, Award, Users } from 'lucide-react';
import { aiAPI, staffAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { LeaderboardRow } from '../types';

const AVAILABILITY_CONFIG = {
  available:    { label: 'Available',      color: 'text-green-400',  bg: 'bg-green-500/10', dot: 'bg-green-400', icon: Wifi },
  on_call:      { label: 'On Call',        color: 'text-blue-400',   bg: 'bg-blue-500/10',  dot: 'bg-blue-400',  icon: Phone },
  out_of_office:{ label: 'Out of Office',  color: 'text-white/30',   bg: 'bg-white/5',       dot: 'bg-white/20',  icon: Home },
};

const MEDAL = ['🥇', '🥈', '🥉'];

interface LeaderboardData {
  rows: LeaderboardRow[];
  scopedTeamId:   string | null;
  scopedTeamName: string | null;
  teams: { id: string; name: string }[];
  myTeamId:   string | null;
  myTeamName: string | null;
}

export default function Leaderboard() {
  const [data,       setData]       = useState<LeaderboardData>({ rows: [], scopedTeamId: null, scopedTeamName: null, teams: [], myTeamId: null, myTeamName: null });
  const [loading,    setLoading]    = useState(true);
  const [resetting,  setResetting]  = useState(false);
  const [teamFilter, setTeamFilter] = useState<string>('');       // admin: filter by team id
  const [staffScope, setStaffScope] = useState<'team' | 'all'>('team'); // staff: team vs all toggle
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();

  const load = async (tId?: string, scope?: 'all') => {
    setLoading(true);
    try {
      const d = await aiAPI.leaderboard(tId || teamFilter || undefined, scope);
      setData(d);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleReset = async () => {
    if (!confirm('Reset the leaderboard? All scores, streaks, and rankings will be cleared. Staff, customers, tasks, and diary entries are kept.')) return;
    setResetting(true);
    try {
      await aiAPI.resetLeaderboard();
      await load(undefined, staffScope === 'all' ? 'all' : undefined);
    } catch {}
    setResetting(false);
  };

  const handleTeamFilter = (tId: string) => {
    setTeamFilter(tId);
    load(tId);
  };

  const handleStaffScope = (s: 'team' | 'all') => {
    setStaffScope(s);
    load(undefined, s === 'all' ? 'all' : undefined);
  };

  const updateAvailability = async (id: string, availability: string) => {
    try {
      await staffAPI.setAvailability(id, availability);
      setData(prev => ({ ...prev, rows: prev.rows.map(r => r.id === id ? { ...r, availability: availability as LeaderboardRow['availability'] } : r) }));
    } catch {}
  };

  // Sort by THIS WEEK's merit points (weekPts); secondary: score
  const sorted = [...data.rows]
    .sort((a, b) => b.weekPts - a.weekPts || b.score - a.score)
    .map((r, i) => ({ ...r, displayRank: i + 1 }));

  const myRow = sorted.find(r => r.id === user?.id);

  // Week date range label
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysSinceMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monDate = new Date(now); monDate.setDate(now.getDate() - daysSinceMon);
  const weekLabel = `${monDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;

  if (loading) return <div className="space-y-3">{Array(6).fill(0).map((_, i) => <div key={i} className="card h-16 shimmer" />)}</div>;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Trophy size={24} className="text-gold" />
            Leaderboard
            {data.scopedTeamName && (
              <span className="badge badge-gold text-xs ml-1">{data.scopedTeamName}</span>
            )}
          </h1>
          <p className="text-white/30 text-sm mt-1">
            Weekly points competition · {weekLabel} · resets every Monday
            {!isAdmin && data.myTeamName && staffScope === 'team' && (
              <span className="text-gold/50"> · {data.myTeamName}</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Staff team/all toggle — only shown when staff is in a team */}
          {!isAdmin && data.myTeamId && (
            <div className="flex gap-1 bg-dark-400 border border-dark-50 rounded-xl p-1">
              {(['team', 'all'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => handleStaffScope(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    staffScope === s ? 'bg-gold text-dark-500' : 'text-white/40 hover:text-white'
                  }`}
                >
                  {s === 'team' ? `My Team` : 'All Staff'}
                </button>
              ))}
            </div>
          )}

          {/* Team filter — admin only */}
          {isAdmin && data.teams.length > 0 && (
            <select
              value={teamFilter}
              onChange={e => handleTeamFilter(e.target.value)}
              className="input text-xs py-1.5 px-3 h-auto"
            >
              <option value="">All Staff</option>
              {data.teams.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}

          {isAdmin && (
            <button
              onClick={handleReset}
              disabled={resetting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-red-500/30 text-red-400/70 hover:text-red-400 hover:border-red-500/60 hover:bg-red-500/10 text-xs font-medium transition-all disabled:opacity-40"
              title="Reset all scores and streaks"
            >
              <RotateCcw size={12} className={resetting ? 'animate-spin' : ''} />
              {resetting ? 'Resetting…' : 'Reset'}
            </button>
          )}
        </div>
      </div>

      {/* My position (for staff) */}
      {!isAdmin && myRow && (
        <div className="card border-gold/30 bg-gold/5">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-black text-gold">#{myRow.displayRank}</span>
            <div className="flex-1">
              <p className="text-white font-semibold text-sm">Your ranking this week</p>
              <p className="text-white/30 text-xs">
                {myRow.weekInteractions} interactions · {myRow.responseRate}% response ·{' '}
                {myRow.totalTasks > 0 ? `${myRow.taskCompletionRate}% tasks done` : 'no tasks yet'}
              </p>
              {myRow.teamName && (
                <p className="text-gold/50 text-[10px] mt-0.5 flex items-center gap-1">
                  <Users size={9} /> {myRow.teamName}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className={`font-bold text-lg ${myRow.weekPts >= 0 ? 'text-gold' : 'text-red-400'}`}>
                {myRow.weekPts >= 0 ? '+' : ''}{myRow.weekPts}
              </p>
              <p className="text-white/20 text-xs">this week</p>
              <p className="text-white/15 text-[10px]">{myRow.meritTotal >= 0 ? '+' : ''}{myRow.meritTotal} all-time</p>
            </div>
          </div>
          {/* Availability selector (self) */}
          <div className="mt-3 pt-3 border-t border-dark-50/50">
            <p className="text-white/30 text-xs mb-2 uppercase tracking-wider font-medium">Your availability</p>
            <div className="flex gap-2 flex-wrap">
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

                  {/* Name + team badge */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-white font-semibold text-sm">{row.name}</p>
                      {isMe && <span className="badge badge-gold text-[10px]">You</span>}
                      {row.teamName && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] text-gold/40 border border-gold/15 rounded px-1.5 py-0.5">
                          <Users size={8} />{row.teamName}
                        </span>
                      )}
                    </div>
                    <p className={`text-xs ${avail.color}`}>{avail.label}</p>
                  </div>

                  {/* Stats */}
                  <div className="hidden sm:flex items-center gap-5 flex-shrink-0">
                    <div className="text-center">
                      <p className="text-white font-bold text-sm">{row.weekInteractions}</p>
                      <p className="text-white/25 text-[10px]">interactions</p>
                    </div>
                    <div className="text-center">
                      <p className="text-white font-bold text-sm">{row.responseRate}%</p>
                      <p className="text-white/25 text-[10px]">response</p>
                    </div>
                    <div className="text-center">
                      <p className="text-green-400 font-bold text-sm">{row.closedCount}</p>
                      <p className="text-white/25 text-[10px]">closed</p>
                    </div>
                    <div className="text-center">
                      <p className={`font-bold text-sm ${
                        row.taskCompletionRate >= 80 ? 'text-green-400' :
                        row.taskCompletionRate >= 50 ? 'text-yellow-400' :
                        row.taskCompletionRate > 0   ? 'text-orange-400' :
                        'text-white/30'
                      }`}>
                        {row.totalTasks > 0 ? `${row.taskCompletionRate}%` : '—'}
                      </p>
                      <p className="text-white/25 text-[10px]">tasks done</p>
                    </div>
                  </div>

                  {/* This week's pts — primary rank driver */}
                  <div className="text-right flex-shrink-0">
                    <div className={`inline-flex flex-col items-center justify-center w-16 h-16 rounded-full border-2 ${
                      row.weekPts >= 0 ? 'border-gold/40 bg-gold/5' : 'border-red-500/30 bg-red-500/5'
                    }`}>
                      <Award size={10} className={row.weekPts >= 0 ? 'text-gold/60' : 'text-red-400/60'} />
                      <span className={`font-black text-sm leading-none ${row.weekPts >= 0 ? 'text-gold' : 'text-red-400'}`}>
                        {row.weekPts >= 0 ? '+' : ''}{row.weekPts}
                      </span>
                      <span className="text-white/20 text-[8px]">this wk</span>
                    </div>
                  </div>
                </div>

                {/* Mini stats bar on mobile */}
                <div className="flex sm:hidden items-center gap-4 mt-3 pt-3 border-t border-dark-50/50 text-xs text-white/40 flex-wrap">
                  <span className="flex items-center gap-1 text-gold/70"><Award size={10} />{row.weekPts >= 0 ? '+' : ''}{row.weekPts} pts</span>
                  <span className="flex items-center gap-1"><TrendingUp size={10} />{row.weekInteractions} interactions</span>
                  <span>{row.responseRate}% response</span>
                  <span className="flex items-center gap-1 text-green-400/70"><CheckCircle size={10} />{row.closedCount} closed</span>
                  {row.totalTasks > 0 && (
                    <span className="flex items-center gap-1 text-blue-400/70"><Target size={10} />{row.taskCompletionRate}% tasks</span>
                  )}
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
        <p className="text-white/30 text-xs font-medium uppercase tracking-wider mb-3">How weekly ranking works</p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'This week\'s pts', weight: '#1 rank key', icon: Award },
            { label: 'Response rate',   weight: '35%',          icon: Target },
            { label: 'Interactions',    weight: '30%',          icon: TrendingUp },
            { label: 'Deals closed',    weight: '20%',          icon: CheckCircle },
            { label: 'Task completion', weight: '15%',          icon: CheckCircle },
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
        <p className="text-white/20 text-[10px] mt-3">Points reset each Monday · monthly history visible on staff profiles</p>
      </div>
    </div>
  );
}
