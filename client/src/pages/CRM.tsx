import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Phone, MapPin, Clock, AlertTriangle, CalendarDays,
  Filter as Funnel, User, Users,
} from 'lucide-react';
import { leadsAPI, staffAPI, teamsAPI } from '../lib/api';
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
  catalogue_sent:  'Catalogue Sent',
  follow_up:       'Follow Up',
  visit_scheduled: 'Visit Scheduled',
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

interface Team { id: string; name: string; members: string[]; }

// ── Lead card ──────────────────────────────────────────────────────────────────
function LeadCard({ lead, today, isAdmin }: { lead: Lead; today: string; isAdmin: boolean }) {
  const navigate = useNavigate();
  const isOverdue  = lead.nextFollowUp && lead.nextFollowUp < today;
  const isDueToday = lead.nextFollowUp === today;
  const lastNote   = lead.notes?.length ? lead.notes[lead.notes.length - 1] : null;

  return (
    <div
      onClick={() => navigate(`/crm/${lead.id}`)}
      className={`card cursor-pointer hover:border-gold/30 hover:bg-gold/2 transition-all group ${
        isOverdue ? 'border-red-500/20' : isDueToday ? 'border-orange-500/20' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Avatar letter */}
        <div className="w-9 h-9 rounded-xl bg-dark-200 border border-dark-50 flex items-center justify-center flex-shrink-0 group-hover:border-gold/20 transition-colors">
          <span className="text-white/50 text-sm font-bold">{lead.name[0].toUpperCase()}</span>
        </div>

        <div className="flex-1 min-w-0">
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
              <span className="text-amber-400/60 text-[10px]">
                No pickup ×{lead.noPickupCount}
              </span>
            )}
            {isAdmin && lead.staffName && (
              <span className="text-white/20 text-[10px] flex items-center gap-1">
                <User size={8} />{lead.staffName}
                {lead.teamName && <span className="text-white/10">· {lead.teamName}</span>}
              </span>
            )}
          </div>

          {lastNote && (
            <p className="text-white/20 text-xs mt-1.5 line-clamp-1 italic">
              "{lastNote.text}"
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main CRM list page ─────────────────────────────────────────────────────────
export default function CRM() {
  const [leads,       setLeads]       = useState<Lead[]>([]);
  const [staffList,   setStaffList]   = useState<Staff[]>([]);
  const [teams,       setTeams]       = useState<Team[]>([]);
  const [teamFilter,  setTeamFilter]  = useState<string>('all');
  const [staffFilter, setStaffFilter] = useState<string>('all');
  const [loading,     setLoading]     = useState(true);
  const [tab,         setTab]         = useState<'today' | 'all' | LeadStage>('today');
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  const load = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (isAdmin) {
        if (teamFilter !== 'all')  params.teamId  = teamFilter;
        else if (staffFilter !== 'all') params.staffId = staffFilter;
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

  // When team changes, reset staff filter
  const handleTeamChange = (val: string) => {
    setTeamFilter(val);
    setStaffFilter('all');
  };

  // Staff filtered to selected team (or all if no team selected)
  const filteredStaff = teamFilter === 'all'
    ? staffList
    : staffList.filter(s => {
        const team = teams.find(t => t.id === teamFilter);
        return team?.members?.includes(s.id);
      });

  const today = new Date().toISOString().split('T')[0];

  const todayLeads = leads.filter(l =>
    l.nextFollowUp && (l.nextFollowUp <= today)
  );
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
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Funnel size={22} className="text-gold" />
            CRM Leads
          </h1>
          <p className="text-white/30 text-sm mt-1">
            {leads.length} active lead{leads.length !== 1 ? 's' : ''}
            {overdueTodayCount > 0 && (
              <span className="text-red-400 ml-2 flex-inline items-center gap-1">
                · <AlertTriangle size={11} className="inline mb-0.5" /> {overdueTodayCount} overdue
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => navigate('/crm/new')}
          className="btn-primary flex items-center gap-2 flex-shrink-0"
        >
          <Plus size={16} /> New Lead
        </button>
      </div>

      {/* Team + Staff filters — admin only */}
      {isAdmin && (
        <div className="flex gap-2 flex-wrap items-center">
          {/* Team filter */}
          {teams.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Users size={13} className="text-white/30" />
              <select
                value={teamFilter}
                onChange={e => handleTeamChange(e.target.value)}
                className="input py-1.5 text-xs w-auto"
              >
                <option value="all">All Teams</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Staff filter */}
          {filteredStaff.length > 0 && (
            <div className="flex items-center gap-1.5">
              <User size={13} className="text-white/30" />
              <select
                value={staffFilter}
                onChange={e => setStaffFilter(e.target.value)}
                className="input py-1.5 text-xs w-auto"
              >
                <option value="all">{teamFilter !== 'all' ? 'All in team' : 'All Staff'}</option>
                {filteredStaff.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Active filter pill */}
          {(teamFilter !== 'all' || staffFilter !== 'all') && (
            <button
              onClick={() => { setTeamFilter('all'); setStaffFilter('all'); }}
              className="text-[10px] text-white/30 hover:text-white border border-dark-50 rounded-lg px-2 py-1 transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Stage tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {/* Today tab */}
        <button
          onClick={() => setTab('today')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
            tab === 'today'
              ? 'bg-gold text-dark-500 border-gold'
              : 'bg-dark-400 border-dark-50 text-white/40 hover:text-white'
          }`}
        >
          <CalendarDays size={11} />
          Today
          {overdueTodayCount > 0 && (
            <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
              tab === 'today' ? 'bg-dark-500/40 text-dark-500' : 'bg-red-500/20 text-red-400'
            }`}>
              {todayLeads.length}
            </span>
          )}
        </button>

        {/* All tab */}
        <button
          onClick={() => setTab('all')}
          className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
            tab === 'all'
              ? 'bg-gold text-dark-500 border-gold'
              : 'bg-dark-400 border-dark-50 text-white/40 hover:text-white'
          }`}
        >
          All ({leads.length})
        </button>

        {/* Per-stage tabs */}
        {STAGES.map(s => stageCounts[s] ? (
          <button
            key={s}
            onClick={() => setTab(s)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
              tab === s
                ? 'bg-gold text-dark-500 border-gold'
                : 'bg-dark-400 border-dark-50 text-white/40 hover:text-white'
            }`}
          >
            {STAGE_LABELS[s]} ({stageCounts[s]})
          </button>
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
            <button
              onClick={() => navigate('/crm/new')}
              className="btn-primary mt-4 mx-auto flex items-center gap-2"
            >
              <Plus size={14} /> Add First Lead
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {visibleLeads.map(l => <LeadCard key={l.id} lead={l} today={today} isAdmin={isAdmin} />)}
        </div>
      )}
    </div>
  );
}
