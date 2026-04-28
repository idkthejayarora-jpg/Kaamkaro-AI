import { useEffect, useState } from 'react';
import { Users, Plus, Trash2, Edit2, Check, X, UserPlus, UserMinus } from 'lucide-react';
import { teamsAPI, staffAPI } from '../lib/api';
import type { Team, Staff } from '../types';

export default function Teams() {
  const [teams,   setTeams]   = useState<Team[]>([]);
  const [staff,   setStaff]   = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);   // team id being edited
  const [editName, setEditName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName,  setNewName]  = useState('');
  const [saving,   setSaving]   = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [t, s] = await Promise.all([teamsAPI.list(), staffAPI.list()]);
      setTeams(t);
      setStaff(s as Staff[]);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Derive which team each staff member belongs to
  const staffTeamMap: Record<string, string> = {};
  teams.forEach(t => t.members.forEach(mid => { staffTeamMap[mid] = t.id; }));

  const createTeam = async () => {
    if (!newName.trim() || saving) return;
    setSaving(true);
    try {
      const t = await teamsAPI.create({ name: newName.trim() });
      setTeams(prev => [...prev, t]);
      setNewName('');
      setCreating(false);
    } catch {}
    setSaving(false);
  };

  const renameTeam = async (id: string) => {
    if (!editName.trim() || saving) return;
    setSaving(true);
    try {
      const updated = await teamsAPI.update(id, { name: editName.trim() });
      setTeams(prev => prev.map(t => t.id === id ? updated : t));
      setEditing(null);
    } catch {}
    setSaving(false);
  };

  const deleteTeam = async (id: string) => {
    if (!confirm('Delete this team? Staff members will become unassigned on the leaderboard.')) return;
    try {
      await teamsAPI.delete(id);
      setTeams(prev => prev.filter(t => t.id !== id));
    } catch {}
  };

  const toggleMember = async (teamId: string, staffId: string) => {
    const team = teams.find(t => t.id === teamId);
    if (!team) return;
    const isMember = team.members.includes(staffId);

    // Remove from previous team first if moving between teams
    let newMembers: string[];
    if (isMember) {
      newMembers = team.members.filter(m => m !== staffId);
    } else {
      // Remove from any other team
      const otherTeam = teams.find(t => t.id !== teamId && t.members.includes(staffId));
      if (otherTeam) {
        const updatedOther = await teamsAPI.update(otherTeam.id, {
          members: otherTeam.members.filter(m => m !== staffId),
        });
        setTeams(prev => prev.map(t => t.id === otherTeam.id ? updatedOther : t));
      }
      newMembers = [...team.members, staffId];
    }

    try {
      const updated = await teamsAPI.update(teamId, { members: newMembers });
      setTeams(prev => prev.map(t => t.id === teamId ? updated : t));
    } catch {}
  };

  if (loading) return (
    <div className="space-y-4">
      {[1,2,3].map(i => <div key={i} className="card h-40 shimmer" />)}
    </div>
  );

  const unassignedStaff = staff.filter(s => !staffTeamMap[s.id]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Users size={24} className="text-gold" />
            Teams
          </h1>
          <p className="text-white/30 text-sm mt-1">
            Group staff into teams · each team has its own leaderboard competition
          </p>
        </div>
        <button
          onClick={() => { setCreating(true); setNewName(''); }}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={16} />
          New Team
        </button>
      </div>

      {/* Create team inline */}
      {creating && (
        <div className="card border-gold/30 bg-gold/3">
          <p className="text-gold text-sm font-semibold mb-3">New Team</p>
          <div className="flex gap-2">
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createTeam(); if (e.key === 'Escape') setCreating(false); }}
              placeholder="Team name (e.g. North Zone, Sales A)"
              className="input flex-1"
            />
            <button onClick={createTeam} disabled={!newName.trim() || saving} className="btn-primary px-4">
              {saving ? '…' : <Check size={16} />}
            </button>
            <button onClick={() => setCreating(false)} className="btn-ghost px-3">
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Teams list */}
      {teams.length === 0 && !creating ? (
        <div className="card text-center py-16">
          <Users size={40} className="text-white/10 mx-auto mb-4" />
          <p className="text-white/40 font-medium">No teams yet</p>
          <p className="text-white/20 text-sm mt-1">Create a team to scope the leaderboard for staff groups</p>
          <button onClick={() => setCreating(true)} className="btn-primary mt-5 mx-auto flex items-center gap-2">
            <Plus size={14} /> Create First Team
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {teams.map(team => {
            const members = staff.filter(s => team.members.includes(s.id));
            const nonMembers = staff.filter(s => !team.members.includes(s.id));
            const isEditing = editing === team.id;

            return (
              <div key={team.id} className="card">
                {/* Team header */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-xl bg-gold/15 border border-gold/30 flex items-center justify-center flex-shrink-0">
                    <Users size={16} className="text-gold" />
                  </div>

                  {isEditing ? (
                    <div className="flex gap-2 flex-1">
                      <input
                        autoFocus
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') renameTeam(team.id); if (e.key === 'Escape') setEditing(null); }}
                        className="input flex-1 text-sm py-1.5"
                      />
                      <button onClick={() => renameTeam(team.id)} className="btn-primary px-3 py-1.5 text-xs">
                        <Check size={13} />
                      </button>
                      <button onClick={() => setEditing(null)} className="btn-ghost px-3 py-1.5 text-xs">
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex-1 min-w-0">
                      <h2 className="text-white font-semibold">{team.name}</h2>
                      <p className="text-white/30 text-xs">{members.length} member{members.length !== 1 ? 's' : ''}</p>
                    </div>
                  )}

                  {!isEditing && (
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => { setEditing(team.id); setEditName(team.name); }}
                        className="p-1.5 rounded-lg text-white/30 hover:text-gold hover:bg-gold/10 transition-colors"
                        title="Rename team"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => deleteTeam(team.id)}
                        className="p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Delete team"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Current members */}
                <div className="mb-3">
                  <p className="text-white/30 text-xs uppercase tracking-wider font-medium mb-2">Members</p>
                  {members.length === 0 ? (
                    <p className="text-white/20 text-xs italic">No members yet — add staff below</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {members.map(s => (
                        <div key={s.id} className="flex items-center gap-1.5 bg-gold/10 border border-gold/20 rounded-lg px-2.5 py-1">
                          <div className="w-5 h-5 rounded-full bg-gold/20 flex items-center justify-center">
                            <span className="text-gold text-[9px] font-bold">{s.avatar}</span>
                          </div>
                          <span className="text-white text-xs font-medium">{s.name}</span>
                          <button
                            onClick={() => toggleMember(team.id, s.id)}
                            className="text-white/30 hover:text-red-400 transition-colors ml-0.5"
                            title="Remove from team"
                          >
                            <UserMinus size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Add staff from non-members */}
                {nonMembers.length > 0 && (
                  <div>
                    <p className="text-white/20 text-xs uppercase tracking-wider font-medium mb-2">Add staff</p>
                    <div className="flex flex-wrap gap-1.5">
                      {nonMembers.map(s => (
                        <button
                          key={s.id}
                          onClick={() => toggleMember(team.id, s.id)}
                          className="flex items-center gap-1.5 bg-dark-200 border border-dark-50 hover:border-gold/30 hover:bg-gold/5 rounded-lg px-2.5 py-1 transition-colors group"
                          title={staffTeamMap[s.id] ? `Move from ${teams.find(t => t.id === staffTeamMap[s.id])?.name}` : 'Add to team'}
                        >
                          <div className="w-5 h-5 rounded-full bg-dark-100 flex items-center justify-center">
                            <span className="text-white/40 text-[9px] font-bold">{s.avatar}</span>
                          </div>
                          <span className="text-white/40 group-hover:text-white text-xs transition-colors">{s.name}</span>
                          <UserPlus size={10} className="text-white/20 group-hover:text-gold transition-colors" />
                          {staffTeamMap[s.id] && (
                            <span className="text-[9px] text-white/20 group-hover:text-white/40 ml-0.5">
                              ({teams.find(t => t.id === staffTeamMap[s.id])?.name})
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Unassigned staff summary */}
      {unassignedStaff.length > 0 && teams.length > 0 && (
        <div className="card border-dark-50/50">
          <p className="text-white/30 text-xs uppercase tracking-wider font-medium mb-2">
            Unassigned Staff ({unassignedStaff.length})
          </p>
          <p className="text-white/20 text-xs mb-3">
            These staff members are not in any team — they appear on the global leaderboard only.
          </p>
          <div className="flex flex-wrap gap-2">
            {unassignedStaff.map(s => (
              <div key={s.id} className="flex items-center gap-1.5 bg-dark-200 border border-dark-50 rounded-lg px-2.5 py-1">
                <div className="w-5 h-5 rounded-full bg-dark-100 flex items-center justify-center">
                  <span className="text-white/40 text-[9px] font-bold">{s.avatar}</span>
                </div>
                <span className="text-white/40 text-xs">{s.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
