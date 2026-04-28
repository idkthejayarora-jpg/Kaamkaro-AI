import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Phone, MapPin, MessageCircle, Edit2, Trash2,
  Check, X, PhoneOff, BookCheck, CalendarDays, Trophy,
  Clock, Send, Loader2, Plus,
} from 'lucide-react';
import { leadsAPI } from '../lib/api';
import type { Lead, LeadNote, LeadStage } from '../types';
import { STAGES, STAGE_LABELS, STAGE_COLORS, SOURCE_LABELS } from './CRM';

// ─ add N days to today's date (YYYY-MM-DD) ────────────────────────────────────
function addDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

// ─ Confirm delete helper ───────────────────────────────────────────────────────
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

export default function CRMDetail() {
  const { id }    = useParams<{ id: string }>();
  const navigate  = useNavigate();

  const [lead,     setLead]     = useState<Lead | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [noteText, setNoteText] = useState('');
  const [editSchedule, setEditSchedule] = useState(false);
  const [followUpEdit, setFollowUpEdit] = useState('');
  const [visitEdit,    setVisitEdit]    = useState('');

  const today = new Date().toISOString().split('T')[0];

  const load = async () => {
    try {
      const leads: Lead[] = await leadsAPI.list();
      const l = leads.find(x => x.id === id);
      if (l) setLead(l);
      else navigate('/crm');
    } catch {
      navigate('/crm');
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, [id]);

  // ── Patch helper ─────────────────────────────────────────────────────────────
  const patch = async (updates: Record<string, unknown>) => {
    if (!lead) return;
    setSaving(true);
    try {
      const updated: Lead = await leadsAPI.update(lead.id, updates);
      setLead(updated);
    } catch {}
    setSaving(false);
  };

  // ── Append a note then also apply other updates ───────────────────────────────
  const appendNote = async (text: string, extra: Record<string, unknown> = {}) => {
    if (!lead) return;
    const newNote: LeadNote = { text, date: new Date().toISOString() };
    await patch({ notes: [...(lead.notes || []), newNote], ...extra });
  };

  // ── Quick log actions ─────────────────────────────────────────────────────────
  const logCallDone = () =>
    appendNote('Call done', { nextFollowUp: null });

  const logNoPickup = () =>
    appendNote(`No pickup (#${(lead?.noPickupCount || 0) + 1})`, {
      noPickupCount: (lead?.noPickupCount || 0) + 1,
      nextFollowUp:  addDays(3),
    });

  const logCatalogueSent = () =>
    appendNote('Catalogue sent', { nextFollowUp: addDays(7) });

  const logFollowUpDone = () =>
    appendNote('Follow-up done', { nextFollowUp: null });

  // ── Add manual note ───────────────────────────────────────────────────────────
  const submitNote = async () => {
    if (!noteText.trim()) return;
    await appendNote(noteText.trim());
    setNoteText('');
  };

  // ── Save schedule edit ────────────────────────────────────────────────────────
  const saveSchedule = async () => {
    await patch({
      nextFollowUp: followUpEdit || null,
      visitDate:    visitEdit    || null,
    });
    setEditSchedule(false);
  };

  // ── Soft delete ───────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!confirm('Delete this lead? It will be soft-deleted and removed from the list.')) return;
    await leadsAPI.delete(lead!.id);
    navigate('/crm');
  };

  if (loading) return (
    <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="card h-20 shimmer" />)}</div>
  );

  if (!lead) return null;

  const isOverdue  = lead.nextFollowUp && lead.nextFollowUp < today;
  const isDueToday = lead.nextFollowUp === today;
  const sortedNotes = [...(lead.notes || [])].reverse();

  return (
    <div className="max-w-2xl mx-auto space-y-5 animate-fade-in">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/crm')}
          className="p-2 rounded-xl hover:bg-dark-200 text-white/40 hover:text-white transition-colors flex-shrink-0"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-white">{lead.name}</h1>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STAGE_COLORS[lead.stage]}`}>
              {STAGE_LABELS[lead.stage]}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {lead.place && (
              <span className="text-white/30 text-xs flex items-center gap-1">
                <MapPin size={10} />{lead.place}
              </span>
            )}
            {lead.source && (
              <span className="text-white/25 text-xs">{SOURCE_LABELS[lead.source]}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => navigate(`/crm/${lead.id}/edit`)}
            className="p-1.5 rounded-lg text-white/30 hover:text-gold hover:bg-gold/10 transition-colors"
            title="Edit lead"
          >
            <Edit2 size={14} />
          </button>
          <button
            onClick={handleDelete}
            className="p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Delete lead"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* ── Phone / WhatsApp buttons ────────────────────────────────────────── */}
      {lead.phone && (
        <div className="flex gap-2">
          <a
            href={`tel:${lead.phone}`}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dark-50 text-white/50 hover:text-white hover:border-gold/30 transition-colors text-sm font-medium"
          >
            <Phone size={14} /> Call {lead.phone}
          </a>
          <a
            href={`https://wa.me/91${lead.phone.replace(/\D/g, '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-green-500/20 text-green-400/60 hover:text-green-400 hover:border-green-500/40 transition-colors text-sm font-medium"
          >
            <MessageCircle size={14} /> WhatsApp
          </a>
        </div>
      )}

      {/* ── Stage pills ─────────────────────────────────────────────────────── */}
      <div className="card">
        <p className="text-white/30 text-xs uppercase tracking-wider font-medium mb-3">Stage</p>
        <div className="flex flex-wrap gap-1.5">
          {STAGES.map(s => (
            <button
              key={s}
              disabled={saving}
              onClick={() => patch({ stage: s })}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                lead.stage === s
                  ? `${STAGE_COLORS[s]} border-current`
                  : 'bg-dark-200 border-dark-50 text-white/25 hover:text-white/60 hover:border-dark-100'
              }`}
            >
              {STAGE_LABELS[s]}
            </button>
          ))}
        </div>

        {/* Mark as Won shortcut */}
        {lead.stage !== 'won' && (
          <button
            onClick={() => patch({ stage: 'won' as LeadStage })}
            disabled={saving}
            className="mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-green-500/20 text-green-400/60 hover:text-green-400 hover:bg-green-500/5 hover:border-green-500/40 text-xs font-semibold transition-all"
          >
            <Trophy size={12} /> Mark as Won
          </button>
        )}
      </div>

      {/* ── Quick log buttons ────────────────────────────────────────────────── */}
      <div className="card">
        <p className="text-white/30 text-xs uppercase tracking-wider font-medium mb-3">Quick Log</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={logCallDone}
            disabled={saving}
            className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-blue-500/20 text-blue-400/70 hover:text-blue-400 hover:bg-blue-500/8 hover:border-blue-500/40 text-xs font-medium transition-all"
          >
            <Check size={12} /> Call Done
          </button>
          <button
            onClick={logNoPickup}
            disabled={saving}
            className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-amber-500/20 text-amber-400/70 hover:text-amber-400 hover:bg-amber-500/8 hover:border-amber-500/40 text-xs font-medium transition-all"
          >
            <PhoneOff size={12} /> No Pickup
            {lead.noPickupCount > 0 && (
              <span className="ml-0.5 bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full text-[9px] font-bold">
                ×{lead.noPickupCount}
              </span>
            )}
          </button>
          <button
            onClick={logCatalogueSent}
            disabled={saving}
            className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-purple-500/20 text-purple-400/70 hover:text-purple-400 hover:bg-purple-500/8 hover:border-purple-500/40 text-xs font-medium transition-all"
          >
            <BookCheck size={12} /> Sent Catalogue
          </button>
          <button
            onClick={logFollowUpDone}
            disabled={saving}
            className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-green-500/20 text-green-400/70 hover:text-green-400 hover:bg-green-500/8 hover:border-green-500/40 text-xs font-medium transition-all"
          >
            <CalendarDays size={12} /> Follow-up Done
          </button>
        </div>
        {saving && (
          <div className="mt-2 flex items-center gap-2 text-white/30 text-xs">
            <Loader2 size={11} className="animate-spin" /> Saving…
          </div>
        )}
      </div>

      {/* ── Schedule ─────────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <p className="text-white/30 text-xs uppercase tracking-wider font-medium">Schedule</p>
          {!editSchedule && (
            <button
              onClick={() => {
                setFollowUpEdit(lead.nextFollowUp || '');
                setVisitEdit(lead.visitDate || '');
                setEditSchedule(true);
              }}
              className="text-white/30 hover:text-gold text-xs flex items-center gap-1 transition-colors"
            >
              <Edit2 size={11} /> Edit
            </button>
          )}
        </div>

        {editSchedule ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Next Follow-up</label>
                <input type="date" className="input" value={followUpEdit} onChange={e => setFollowUpEdit(e.target.value)} />
              </div>
              <div>
                <label className="label">Visit Date</label>
                <input type="date" className="input" value={visitEdit} onChange={e => setVisitEdit(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditSchedule(false)} className="btn-ghost flex-1 text-xs py-1.5">Cancel</button>
              <button onClick={saveSchedule} disabled={saving} className="btn-primary flex-1 text-xs py-1.5">Save</button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-white/20 text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1">
                <Clock size={9} /> Next Follow-up
              </p>
              {lead.nextFollowUp ? (
                <p className={`text-sm font-medium ${isOverdue ? 'text-red-400' : isDueToday ? 'text-orange-400' : 'text-white'}`}>
                  {isOverdue && '⚠ '}{lead.nextFollowUp}
                </p>
              ) : (
                <p className="text-white/20 text-sm italic">Not set</p>
              )}
            </div>
            <div>
              <p className="text-white/20 text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1">
                <CalendarDays size={9} /> Visit Date
              </p>
              {lead.visitDate ? (
                <p className="text-white text-sm font-medium">{lead.visitDate}</p>
              ) : (
                <p className="text-white/20 text-sm italic">Not set</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Add note ─────────────────────────────────────────────────────────── */}
      <div className="card">
        <p className="text-white/30 text-xs uppercase tracking-wider font-medium mb-3">Add Note</p>
        <div className="flex gap-2">
          <textarea
            className="input flex-1 resize-none text-sm"
            rows={2}
            placeholder="Log a call, note an update, record anything…"
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitNote(); }}
          />
          <button
            onClick={submitNote}
            disabled={!noteText.trim() || saving}
            className="btn-primary px-4 flex-shrink-0 flex items-center gap-1.5 self-end"
          >
            <Send size={13} /> Save
          </button>
        </div>
      </div>

      {/* ── Notes timeline ───────────────────────────────────────────────────── */}
      <div className="card">
        <p className="text-white/30 text-xs uppercase tracking-wider font-medium mb-3">
          Notes Timeline ({sortedNotes.length})
        </p>
        {sortedNotes.length === 0 ? (
          <p className="text-white/20 text-sm italic">No notes yet — use the quick log buttons or add a note above.</p>
        ) : (
          <div className="space-y-3">
            {sortedNotes.map((n, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center flex-shrink-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-gold/40 mt-1.5" />
                  {i < sortedNotes.length - 1 && <div className="w-px flex-1 bg-dark-50 mt-1" />}
                </div>
                <div className="pb-3 flex-1 min-w-0">
                  <p className="text-white text-sm">{n.text}</p>
                  <p className="text-white/25 text-[10px] mt-0.5">{fmtDate(n.date)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Created info ─────────────────────────────────────────────────────── */}
      <p className="text-white/15 text-xs text-center pb-4">
        Created {fmtDate(lead.createdAt)}
        {lead.updatedAt !== lead.createdAt && ` · Updated ${fmtDate(lead.updatedAt)}`}
      </p>
    </div>
  );
}
