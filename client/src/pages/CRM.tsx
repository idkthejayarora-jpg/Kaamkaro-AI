import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Phone, MapPin, Clock, AlertTriangle, CalendarDays,
  Filter as Funnel, User, Users, PhoneOff, ChevronRight,
  LayoutGrid, List, Trophy, ChevronDown, ChevronUp,
} from 'lucide-react';
import { leadsAPI, staffAPI, teamsAPI, meritsAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { Lead, LeadStage, Staff } from '../types';

// ── Shared helpers ─────────────────────────────────────────────────────────────

export const STAGES: LeadStage[] = [
  'new', 'contacted', 'interested', 'catalogue_sent',
  'follow_up', 'visit_scheduled', 'won', 'lost',
];

export const STAGE_LABELS: Record<LeadStage, string> = {
  new:             'New',
  contacted:       'Contacted',
  interested:      'Interested',
  catalogue_sent:  'Catalogue',
  follow_up:       'Follow Up',
  visit_scheduled: 'Visit',
  won:             'Won',
  lost:            'Lost',
};

export const STAGE_COLORS: Record<LeadStage, string> = {
  new:             'bg-white/10 text-white/50',
  contacted:       'bg-blue-500/15 text-blue-400',
  interested:      'bg-yellow-500/15 text-yellow-400',
  catalogue_sent:  'bg-purple-500/15 text-purple-400',
  follow_up:       'bg-orange-500/15 text-orange-400',
  visit_scheduled: 'bg-indigo-500/15 text-indigo-400',
  won:             'bg-green-500/15 text-green-400',
  lost:            'bg-red-500/15 text-red-400',
};

export const SOURCE_LABELS: Record<string, string> = {
  walk_in:   'Walk-in',
  referral:  'Referral',
  phone:     'Phone',
  instagram: 'Instagram',
  whatsapp:  'WhatsApp',
  other:     'Other',
};

// Pipeline order (terminal stages always last)
const PIPELINE: LeadStage[] = ['new','contacted','interested','catalogue_sent','follow_up','visit_scheduled'];

function nextStage(s: LeadStage): LeadStage | null {
  const i = PIPELINE.indexOf(s);
  if (i === -1) return null;
  return i < PIPELINE.length - 1 ? PIPELINE[i + 1] : 'won';
}

// ── Heat signal ────────────────────────────────────────────────────────────────
function getLeadHeat(lead: Lead, today: string): 'hot' | 'warm' | 'cold' {
  if (lead.stage === 'won' || lead.stage === 'lost') return 'cold';
  if ((lead.nextFollowUp && lead.nextFollowUp < today) || lead.noPickupCount >= 3) return 'hot';
  if (lead.nextFollowUp === today || lead.stage === 'interested' || lead.stage === 'visit_scheduled') return 'warm';
  return 'cold';
}

const HEAT_DOT: Record<string, string> = {
  hot:  'bg-red-500',
  warm: 'bg-amber-400',
  cold: 'bg-white/15',
};

// ── Win celebration overlay ───────────────────────────────────────────────────
function WinCelebration({ active, onDone }: { active: boolean; onDone: () => void }) {
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
  }, [active, onDone]);
  if (!active) return null;
  return (
    <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center bg-black/30">
      <div className="text-center bg-dark-300 border border-gold/40 rounded-2xl px-12 py-10 shadow-2xl animate-slide-up">
        <Trophy size={56} className="text-gold mx-auto mb-3" />
        <p className="text-gold font-bold text-2xl tracking-wide">Lead Won! 🏆</p>
        <p className="text-white/50 text-sm mt-2">+50 merit points awarded</p>
      </div>
    </div>
  );
}

// ── Toast ──────────────────────────────────────────────────────────────────────
function Toast({ msg }: { msg: string }) {
  if (!msg) return null;
  return (
    <div className="fixed bottom-6 right-6 z-40 bg-dark-200 border border-gold/20 text-white/80 text-sm px-4 py-2.5 rounded-xl shadow-lg animate-slide-up">
      {msg}
    </div>
  );
}

interface Team { id: string; name: string; members: string[]; }

// ── Lead card ──────────────────────────────────────────────────────────────────
interface LeadCardProps {
  lead: Lead;
  today: string;
  isAdmin: boolean;
  onAction: (id: string, patch: Partial<Lead>, checkWin?: boolean) => void;
}

function LeadCard({ lead, today, isAdmin, onAction }: LeadCardProps) {
  const navigate = useNavigate();
  const isOverdue  = lead.nextFollowUp && lead.nextFollowUp < today;
  const isDueToday = lead.nextFollowUp === today;
  const heat       = getLeadHeat(lead, today);
  const lastNote   = lead.notes?.length ? lead.notes[lead.notes.length - 1] : null;
  const nxt        = nextStage(lead.stage);

  const handleLogCall = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAction(lead.id, { nextFollowUp: null, noPickupCount: 0 });
  };
  const handleNoPickup = (e: React.MouseEvent) => {
    e.stopPropagation();
    const d = new Date(); d.setDate(d.getDate() + 3);
    const fu = d.toISOString().split('T')[0];
    onAction(lead.id, { noPickupCount: lead.noPickupCount + 1, nextFollowUp: fu });
  };
  const handleNextStage = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!nxt) return;
    onAction(lead.id, { stage: nxt }, nxt === 'won');
  };

  return (
    <div
      onClick={() => navigate(`/crm/${lead.id}`)}
      className={`card cursor-pointer hover:border-gold/30 transition-all group relative ${
        isOverdue ? 'border-red-500/20' : isDueToday ? 'border-orange-500/20' : ''
      }`}
    >
      {/* Heat dot */}
      <span className={`absolute top-3 right-3 w-2 h-2 rounded-full ${HEAT_DOT[heat]}`} title={heat} />

      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-dark-200 border border-dark-50 flex items-center justify-center flex-shrink-0 group-hover:border-gold/20 transition-colors">
          <span className="text-white/50 text-sm font-bold">{lead.name[0].toUpperCase()}</span>
        </div>

        <div className="flex-1 min-w-0 pr-6">
          <div className="flex items-start gap-2 flex-wrap">
            <p className="text-white font-semibold text-sm">{lead.name}</p>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STAGE_COLORS[lead.stage]}`}>
              {STAGE_LABELS[lead.stage]}
            </span>
          </div>

          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {lead.place && (
              <span className="text-white/30 text-xs flex items-center gap-1">
                <MapPin size={10} />{lead.place}
              </span>
            )}
            {lead.phone && (
              <span className="text-white/30 text-xs flex items-center gap-1">
                <Phone size={10} />{lead.phone}
              </span>
            )}
            {lead.nextFollowUp && (
              <span className={`text-xs flex items-center gap-1 ${
                isOverdue ? 'text-red-400' : isDueToday ? 'text-orange-400' : 'text-white/30'
              }`}>
                <Clock size={10} />
                {isOverdue ? `Overdue · ${lead.nextFollowUp}` :
                 isDueToday ? 'Follow-up today' : `Follow-up ${lead.nextFollowUp}`}
              </span>
            )}
            {lead.noPickupCount > 0 && (
              <span className="text-amber-400/60 text-[10px]">No pickup ×{lead.noPickupCount}</span>
            )}
            {isAdmin && lead.staffName && (
              <span className="text-white/20 text-[10px] flex items-center gap-1">
                <User size={8} />{lead.staffName}
                {lead.teamName && <span className="text-white/10"> · {lead.teamName}</span>}
              </span>
            )}
          </div>

          {lastNote && (
            <p className="text-white/20 text-xs mt-1.5 line-clamp-1 italic">"{lastNote.text}"</p>
          )}
        </div>
      </div>

      {/* Quick actions — visible on hover (always on mobile) */}
      <div className="flex items-center gap-1.5 mt-2.5 pt-2.5 border-t border-dark-50 opacity-0 group-hover:opacity-100 transition-opacity md:opacity-0 opacity-100">
        <button
          onClick={handleLogCall}
          title="Log call — clear follow-up"
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 text-[10px] font-medium transition-colors"
        >
          <Phone size={11} /> Logged
        </button>
        <button
          onClick={handleNoPickup}
          title="No pickup — follow up in 3 days"
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 text-[10px] font-medium transition-colors"
        >
          <PhoneOff size={11} /> No pickup
        </button>
        {nxt && (
          <button
            onClick={handleNextStage}
            title={`Move to ${STAGE_LABELS[nxt]}`}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-gold/10 text-gold hover:bg-gold/20 text-[10px] font-medium transition-colors ml-auto"
          >
            → {STAGE_LABELS[nxt]}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Kanban column ──────────────────────────────────────────────────────────────
function KanbanColumn({ stage, leads, today, isAdmin, onAction, onOpen }: {
  stage: LeadStage; leads: Lead[]; today: string; isAdmin: boolean;
  onAction: LeadCardProps['onAction'];
  onOpen: (id: string) => void;
}) {
  const nxt = nextStage(stage);
  return (
    <div className="flex-shrink-0 w-56 bg-dark-400 border border-dark-50 rounded-xl overflow-hidden">
      <div className={`px-3 py-2 border-b border-dark-50 flex items-center justify-between`}>
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${STAGE_COLORS[stage]}`}>
          {STAGE_LABELS[stage]}
        </span>
        <span className="text-white/30 text-xs">{leads.length}</span>
      </div>
      <div className="p-2 space-y-2 max-h-[60vh] overflow-y-auto">
        {leads.length === 0 && (
          <p className="text-white/15 text-xs text-center py-4">Empty</p>
        )}
        {leads.map(lead => {
          const heat = getLeadHeat(lead, today);
          const isOverdue = lead.nextFollowUp && lead.nextFollowUp < today;
          return (
            <div
              key={lead.id}
              onClick={() => onOpen(lead.id)}
              className={`bg-dark-300 border rounded-lg px-2.5 py-2 cursor-pointer hover:border-gold/20 transition-colors group relative ${
                isOverdue ? 'border-red-500/20' : 'border-dark-50'
              }`}
            >
              <span className={`absolute top-2 right-2 w-1.5 h-1.5 rounded-full ${HEAT_DOT[heat]}`} />
              <p className="text-white/80 text-xs font-medium pr-3 line-clamp-1">{lead.name}</p>
              {lead.place && <p className="text-white/25 text-[10px] mt-0.5">{lead.place}</p>}
              {lead.noPickupCount > 0 && (
                <p className="text-amber-400/50 text-[10px]">No pickup ×{lead.noPickupCount}</p>
              )}
              {nxt && (
                <button
                  onClick={e => { e.stopPropagation(); onAction(lead.id, { stage: nxt }, nxt === 'won'); }}
                  className="mt-1.5 w-full text-[10px] text-gold/60 hover:text-gold border border-gold/10 hover:border-gold/30 rounded py-0.5 transition-colors flex items-center justify-center gap-1"
                >
                  <ChevronRight size={10} /> {STAGE_LABELS[nxt]}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main CRM page ──────────────────────────────────────────────────────────────
export default function CRM() {
  const [leads,         setLeads]         = useState<Lead[]>([]);
  const [staffList,     setStaffList]     = useState<Staff[]>([]);
  const [teams,         setTeams]         = useState<Team[]>([]);
  const [teamFilter,    setTeamFilter]    = useState<string>('all');
  const [staffFilter,   setStaffFilter]  = useState<string>('all');
  const [loading,       setLoading]       = useState(true);
  const [tab,           setTab]           = useState<'today' | 'all' | LeadStage>('today');
  const [view,          setView]          = useState<'list' | 'kanban'>(() =>
    (localStorage.getItem('crm_view') as 'list' | 'kanban') || 'list'
  );
  const [showAttention, setShowAttention] = useState(true);
  const [celebration,   setCelebration]   = useState(false);
  const [toast,         setToast]         = useState('');
  const navigate = useNavigate();
  const { isAdmin, user } = useAuth();

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const load = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (isAdmin) {
        if (teamFilter !== 'all')        params.teamId  = teamFilter;
        else if (staffFilter !== 'all')  params.staffId = staffFilter;
      }
      const [data, staffData, teamsData] = await Promise.all([
        leadsAPI.list(params),
        isAdmin ? staffAPI.list().catch(() => []) : Promise.resolve([]),
        isAdmin ? teamsAPI.list().catch(() => []) : Promise.resolve([]),
      ]);
      setLeads(data);
      setStaffList(staffData as Staff[]);
      setTeams(teamsData as Team[]);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [teamFilter, staffFilter]);

  const handleTeamChange = (val: string) => { setTeamFilter(val); setStaffFilter('all'); };

  const filteredStaff = teamFilter === 'all'
    ? staffList
    : staffList.filter(s => teams.find(t => t.id === teamFilter)?.members?.includes(s.id));

  const switchView = (v: 'list' | 'kanban') => {
    setView(v);
    localStorage.setItem('crm_view', v);
  };

  const today = new Date().toISOString().split('T')[0];

  // ── Quick-action handler (optimistic update) ─────────────────────────────────
  const handleAction = useCallback(async (id: string, patch: Partial<Lead>, triggerWin = false) => {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
    try {
      await leadsAPI.update(id, patch);
      if (triggerWin) {
        setCelebration(true);
        const lead = leads.find(l => l.id === id);
        if (lead?.staffId) {
          meritsAPI.award({ staffId: lead.staffId, points: 50, reason: 'Lead converted to Won 🏆' })
            .then(() => showToast('🏆 +50 merit points awarded!'))
            .catch(() => {});
        }
      } else {
        const actionLabel = patch.noPickupCount !== undefined
          ? `No pickup ×${patch.noPickupCount} · follow-up set`
          : patch.stage
          ? `Moved to ${STAGE_LABELS[patch.stage as LeadStage]}`
          : 'Call logged ✓';
        showToast(actionLabel);
      }
    } catch {
      // revert on failure
      load();
      showToast('Action failed — refreshing');
    }
  }, [leads]);

  // ── Stats ────────────────────────────────────────────────────────────────────
  const thisMonth  = today.slice(0, 7); // YYYY-MM
  const needsAttn  = leads.filter(l => l.nextFollowUp && l.nextFollowUp <= today && l.stage !== 'won' && l.stage !== 'lost');
  const active     = leads.filter(l => l.stage !== 'won' && l.stage !== 'lost');
  const wonMonth   = leads.filter(l => l.stage === 'won' && l.updatedAt?.startsWith(thisMonth));
  const lostCount  = leads.filter(l => l.stage === 'lost').length;
  const wonCount   = leads.filter(l => l.stage === 'won').length;
  const conversion = wonCount + lostCount > 0 ? Math.round(wonCount / (wonCount + lostCount) * 100) : 0;

  // ── Tab filtering ────────────────────────────────────────────────────────────
  const todayLeads   = leads.filter(l => l.nextFollowUp && l.nextFollowUp <= today);
  const overdueTodayCount = leads.filter(l => l.nextFollowUp && l.nextFollowUp < today).length;

  const visibleLeads = (() => {
    if (tab === 'today') return todayLeads;
    if (tab === 'all')   return leads;
    return leads.filter(l => l.stage === tab);
  })();

  const stageCounts: Partial<Record<LeadStage, number>> = {};
  STAGES.forEach(s => {
    const c = leads.filter(l => l.stage === s).length;
    if (c > 0) stageCounts[s] = c;
  });

  if (loading) return (
    <div className="space-y-3">
      {[1,2,3,4].map(i => <div key={i} className="card h-20 shimmer" />)}
    </div>
  );

  return (
    <div className="space-y-4 animate-fade-in">
      <WinCelebration active={celebration} onDone={() => setCelebration(false)} />
      <Toast msg={toast} />

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Funnel size={22} className="text-gold" />
            CRM Leads
          </h1>
          <p className="text-white/30 text-sm mt-1">
            {leads.length} lead{leads.length !== 1 ? 's' : ''}
            {overdueTodayCount > 0 && (
              <span className="text-red-400 ml-2">
                · <AlertTriangle size={11} className="inline mb-0.5" /> {overdueTodayCount} overdue
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex bg-dark-400 border border-dark-50 rounded-lg p-0.5">
            <button
              onClick={() => switchView('list')}
              className={`p-1.5 rounded-md transition-colors ${view === 'list' ? 'bg-gold text-dark-500' : 'text-white/30 hover:text-white'}`}
            ><List size={14} /></button>
            <button
              onClick={() => switchView('kanban')}
              className={`p-1.5 rounded-md transition-colors ${view === 'kanban' ? 'bg-gold text-dark-500' : 'text-white/30 hover:text-white'}`}
            ><LayoutGrid size={14} /></button>
          </div>
          <button
            onClick={() => navigate('/crm/new')}
            className="btn-primary flex items-center gap-2 flex-shrink-0"
          >
            <Plus size={16} /> New Lead
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <button
          onClick={() => setTab('today')}
          className="card text-left hover:border-gold/20 transition-colors cursor-pointer"
        >
          <p className="text-red-400 text-xs font-medium mb-1 flex items-center gap-1">
            🔥 Needs Attention
          </p>
          <p className="text-white font-bold text-xl">{needsAttn.length}</p>
        </button>
        <div className="card">
          <p className="text-white/40 text-xs mb-1">📋 Active Leads</p>
          <p className="text-white font-bold text-xl">{active.length}</p>
        </div>
        <div className="card">
          <p className="text-white/40 text-xs mb-1">🏆 Won This Month</p>
          <p className="text-gold font-bold text-xl">{wonMonth.length}</p>
        </div>
        <div className="card">
          <p className="text-white/40 text-xs mb-1">📈 Conversion</p>
          <p className="text-white font-bold text-xl">{conversion}%</p>
        </div>
      </div>

      {/* Admin filters */}
      {isAdmin && (
        <div className="flex gap-2 flex-wrap items-center">
          {teams.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Users size={13} className="text-white/30" />
              <select value={teamFilter} onChange={e => handleTeamChange(e.target.value)} className="input py-1.5 text-xs w-auto">
                <option value="all">All Teams</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
          {filteredStaff.length > 0 && (
            <div className="flex items-center gap-1.5">
              <User size={13} className="text-white/30" />
              <select value={staffFilter} onChange={e => setStaffFilter(e.target.value)} className="input py-1.5 text-xs w-auto">
                <option value="all">{teamFilter !== 'all' ? 'All in team' : 'All Staff'}</option>
                {filteredStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          {(teamFilter !== 'all' || staffFilter !== 'all') && (
            <button
              onClick={() => { setTeamFilter('all'); setStaffFilter('all'); }}
              className="text-[10px] text-white/30 hover:text-white border border-dark-50 rounded-lg px-2 py-1 transition-colors"
            >Clear filters</button>
          )}
        </div>
      )}

      {/* ── KANBAN VIEW ──────────────────────────────────────────────────────────── */}
      {view === 'kanban' && (
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-3" style={{ minWidth: 'max-content' }}>
            {STAGES.map(stage => (
              <KanbanColumn
                key={stage}
                stage={stage}
                leads={leads.filter(l => l.stage === stage)}
                today={today}
                isAdmin={isAdmin}
                onAction={handleAction}
                onOpen={id => navigate(`/crm/${id}`)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── LIST VIEW ────────────────────────────────────────────────────────────── */}
      {view === 'list' && (
        <>
          {/* 🔥 Needs Attention section */}
          {needsAttn.length > 0 && (
            <div className="space-y-2">
              <button
                onClick={() => setShowAttention(s => !s)}
                className="flex items-center gap-2 text-red-400 text-sm font-semibold w-full"
              >
                🔥 Needs Attention Today
                <span className="bg-red-500/15 text-red-400 text-[10px] font-bold px-2 py-0.5 rounded-full">{needsAttn.length}</span>
                <span className="ml-auto text-white/20">{showAttention ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
              </button>
              {showAttention && (
                <div className="space-y-2">
                  {needsAttn
                    .sort((a, b) => (a.nextFollowUp || '').localeCompare(b.nextFollowUp || ''))
                    .map(l => (
                      <LeadCard key={l.id} lead={l} today={today} isAdmin={isAdmin} onAction={handleAction} />
                    ))
                  }
                </div>
              )}
              <div className="border-t border-dark-50 pt-1" />
            </div>
          )}

          {/* Stage tabs */}
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => setTab('today')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                tab === 'today' ? 'bg-gold text-dark-500 border-gold' : 'bg-dark-400 border-dark-50 text-white/40 hover:text-white'
              }`}
            >
              <CalendarDays size={11} /> Today
              {todayLeads.length > 0 && (
                <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
                  tab === 'today' ? 'bg-dark-500/40 text-dark-500' : 'bg-red-500/20 text-red-400'
                }`}>{todayLeads.length}</span>
              )}
            </button>
            <button
              onClick={() => setTab('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                tab === 'all' ? 'bg-gold text-dark-500 border-gold' : 'bg-dark-400 border-dark-50 text-white/40 hover:text-white'
              }`}
            >All ({leads.length})</button>
            {STAGES.map(s => stageCounts[s] ? (
              <button
                key={s}
                onClick={() => setTab(s)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                  tab === s ? 'bg-gold text-dark-500 border-gold' : 'bg-dark-400 border-dark-50 text-white/40 hover:text-white'
                }`}
              >{STAGE_LABELS[s]} ({stageCounts[s]})</button>
            ) : null)}
          </div>

          {/* Lead list */}
          {visibleLeads.length === 0 ? (
            <div className="card text-center py-14">
              <Funnel size={36} className="text-white/10 mx-auto mb-3" />
              <p className="text-white/40 font-medium">
                {tab === 'today' ? 'No follow-ups due today' :
                 tab === 'all'   ? 'No leads yet' :
                 `No leads in "${STAGE_LABELS[tab as LeadStage]}" stage`}
              </p>
              {tab === 'all' && (
                <button onClick={() => navigate('/crm/new')} className="btn-primary mt-4 mx-auto flex items-center gap-2">
                  <Plus size={14} /> Add First Lead
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {visibleLeads.map(l => (
                <LeadCard key={l.id} lead={l} today={today} isAdmin={isAdmin} onAction={handleAction} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
