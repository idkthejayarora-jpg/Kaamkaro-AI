import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Phone, MapPin, MessageCircle, Edit2, Trash2,
  Check, X, PhoneOff, BookCheck, CalendarDays, Trophy,
  Clock, Send, Loader2, Mic, MicOff, AlertCircle,
  FileText, Copy, CheckCheck, Search, Paperclip, Image, File as FileIcon,
} from 'lucide-react';
import { leadsAPI, templatesAPI } from '../lib/api';
import type { Lead, LeadNote, LeadStage, Template } from '../types';

const SERVER = import.meta.env.VITE_API_URL?.replace('/api', '') || '';
import { STAGES, STAGE_LABELS, STAGE_COLORS, SOURCE_LABELS } from './CRM';
import { useVoice } from '../hooks/useVoice';

// ─ add N days to today's date (YYYY-MM-DD) ────────────────────────────────────
function addDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

// ── Template picker modal ──────────────────────────────────────────────────────
function TemplatePicker({ lead, onClose, onSent }: {
  lead: Lead;
  onClose: () => void;
  onSent: (templateTitle: string) => void;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [selected,  setSelected]  = useState<Template | null>(null);
  const [preview,   setPreview]   = useState('');
  const [copied,    setCopied]    = useState(false);

  // Substitutes {name}, {customerName}, {phone}, {place} placeholders
  const fillTemplate = (tpl: Template) => {
    return tpl.content
      .replace(/\{name\}|\{customerName\}/gi, lead.name)
      .replace(/\{phone\}/gi,  lead.phone  || '')
      .replace(/\{place\}/gi,  lead.place  || '')
      .replace(/\{stage\}/gi,  STAGE_LABELS[lead.stage] || '')
      .replace(/\{date\}/gi,   new Date().toLocaleDateString('en-IN'));
  };

  useEffect(() => {
    templatesAPI.list()
      .then(data => setTemplates(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const pick = (tpl: Template) => {
    setSelected(tpl);
    setPreview(fillTemplate(tpl));
    setCopied(false);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(preview);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    if (selected) {
      templatesAPI.use(selected.id).catch(() => {});
      onSent(selected.title);
    }
  };

  const handleWhatsApp = () => {
    if (!lead.phone) return;
    const phone = '91' + lead.phone.replace(/\D/g, '');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(preview)}`, '_blank');
    if (selected) {
      templatesAPI.use(selected.id).catch(() => {});
      onSent(selected.title);
    }
  };

  const filtered = templates.filter(t =>
    !search || t.title.toLowerCase().includes(search.toLowerCase()) ||
    t.content.toLowerCase().includes(search.toLowerCase())
  );

  const TYPE_ICON: Record<string, string> = {
    message: '💬', call: '📞', email: '📧', meeting: '📅', general: '📄',
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4 animate-fade-in">
      <div className="bg-dark-300 border border-dark-50 rounded-2xl w-full max-w-lg shadow-2xl max-h-[88vh] flex flex-col animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-50 flex-shrink-0">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-gold" />
            <h2 className="text-white font-semibold text-sm">Send Template to {lead.name}</h2>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white"><X size={17} /></button>
        </div>

        {selected ? (
          /* ── Preview pane ── */
          <div className="flex flex-col flex-1 min-h-0">
            <div className="px-5 pt-4 pb-2 border-b border-dark-50 flex-shrink-0">
              <button
                onClick={() => setSelected(null)}
                className="text-white/40 hover:text-white text-xs flex items-center gap-1 mb-2 transition-colors"
              >
                ← Back to templates
              </button>
              <p className="text-white font-medium text-sm">{selected.title}</p>
              <p className="text-white/30 text-xs">{TYPE_ICON[selected.type]} {selected.type}</p>
            </div>

            {/* Message preview */}
            <div className="flex-1 overflow-y-auto p-5">
              <p className="text-white/40 text-[10px] uppercase tracking-wider mb-2">Message preview</p>
              <div className="bg-dark-400 border border-dark-50 rounded-xl p-4">
                <p className="text-white/80 text-sm whitespace-pre-wrap leading-relaxed">{preview}</p>
              </div>
              <p className="text-white/20 text-[10px] mt-2">
                Placeholders filled: name, phone, place, stage, date
              </p>

              {/* Catalogue attachments */}
              {(selected.attachments || []).length > 0 && (
                <div className="mt-4">
                  <p className="text-white/30 text-[10px] uppercase tracking-wider mb-2 flex items-center gap-1">
                    <Paperclip size={10} /> Catalogue Attachments
                  </p>
                  <div className="space-y-2">
                    {selected.attachments!.map(att => {
                      const isImage = att.mimetype.startsWith('image/');
                      const url = `${SERVER}${att.url}`;
                      return (
                        <div key={att.name} className="flex items-center gap-3 bg-dark-400 border border-dark-50 rounded-xl p-3">
                          {isImage
                            ? <Image size={16} className="text-blue-400 flex-shrink-0" />
                            : <FileIcon size={16} className="text-red-400 flex-shrink-0" />}
                          <span className="flex-1 text-white/60 text-xs truncate">{att.originalName}</span>
                          <div className="flex gap-2 flex-shrink-0">
                            <button
                              onClick={() => { navigator.clipboard.writeText(url); }}
                              className="text-[10px] text-white/30 hover:text-white px-2 py-1 bg-dark-300 rounded-lg transition-colors"
                              title="Copy link"
                            >Copy link</button>
                            {lead.phone && (
                              <button
                                onClick={() => {
                                  const phone = '91' + lead.phone!.replace(/\D/g, '');
                                  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(`${preview}\n\n${url}`)}`, '_blank');
                                  if (selected) templatesAPI.use(selected.id).catch(() => {});
                                }}
                                className="text-[10px] text-green-400/70 hover:text-green-400 px-2 py-1 bg-green-500/8 border border-green-500/20 rounded-lg transition-colors"
                              >WhatsApp 📎</button>
                            )}
                            <a href={url} target="_blank" rel="noopener noreferrer"
                              className="text-[10px] text-blue-400/70 hover:text-blue-400 px-2 py-1 bg-blue-500/8 border border-blue-500/20 rounded-lg transition-colors">
                              View
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="p-4 border-t border-dark-50 flex gap-2 flex-shrink-0">
              <button
                onClick={handleCopy}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                  copied
                    ? 'bg-green-500/15 border-green-500/30 text-green-400'
                    : 'bg-dark-400 border-dark-50 text-white/60 hover:text-white hover:border-gold/30'
                }`}
              >
                {copied ? <><CheckCheck size={14} /> Copied!</> : <><Copy size={14} /> Copy</>}
              </button>
              {lead.phone && (
                <button
                  onClick={handleWhatsApp}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border border-green-500/20 text-green-400/70 hover:text-green-400 hover:bg-green-500/8 hover:border-green-500/40 transition-all"
                >
                  <MessageCircle size={14} /> Send via WhatsApp
                </button>
              )}
            </div>
          </div>
        ) : (
          /* ── Template list ── */
          <div className="flex flex-col flex-1 min-h-0">
            {/* Search */}
            <div className="px-5 py-3 border-b border-dark-50 flex-shrink-0">
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
                <input
                  className="input pl-8 text-sm py-2"
                  placeholder="Search templates…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  autoFocus
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loading && (
                <div className="flex items-center justify-center py-8 text-white/30 text-sm gap-2">
                  <Loader2 size={16} className="animate-spin" /> Loading templates…
                </div>
              )}
              {!loading && filtered.length === 0 && (
                <div className="text-center py-8">
                  <FileText size={28} className="text-white/10 mx-auto mb-2" />
                  <p className="text-white/30 text-sm">
                    {search ? 'No templates match your search' : 'No templates yet — create them in the Templates section'}
                  </p>
                </div>
              )}
              {filtered.map(tpl => (
                <button
                  key={tpl.id}
                  onClick={() => pick(tpl)}
                  className="w-full text-left p-3.5 bg-dark-400 border border-dark-50 rounded-xl hover:border-gold/25 hover:bg-dark-200 transition-all group"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-base leading-none mt-0.5">{TYPE_ICON[tpl.type]}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium group-hover:text-gold transition-colors">{tpl.title}</p>
                      <p className="text-white/30 text-xs mt-0.5 line-clamp-2 leading-relaxed">
                        {tpl.content.replace(/\{name\}|\{customerName\}/gi, lead.name).slice(0, 100)}…
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {tpl.usageCount > 0 && (
                          <p className="text-white/15 text-[10px]">Used {tpl.usageCount}×</p>
                        )}
                        {(tpl.attachments || []).length > 0 && (
                          <span className="flex items-center gap-0.5 text-[10px] text-blue-400/60">
                            <Paperclip size={9} /> {tpl.attachments!.length} file{tpl.attachments!.length > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    <Send size={12} className="text-white/15 group-hover:text-gold transition-colors flex-shrink-0 mt-1" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CRMDetail() {
  const { id }    = useParams<{ id: string }>();
  const navigate  = useNavigate();

  const [lead,          setLead]          = useState<Lead | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [noteText,      setNoteText]      = useState('');
  const [editSchedule,  setEditSchedule]  = useState(false);
  const [followUpEdit,  setFollowUpEdit]  = useState('');
  const [visitEdit,     setVisitEdit]     = useState('');
  const [showTemplates, setShowTemplates] = useState(false);

  // Voice input — appends spoken text to the note textarea
  const voice = useVoice((text: string) => {
    setNoteText(prev => prev.trim() ? prev.trimEnd() + ' ' + text : text);
  });

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

      {/* ── Phone / WhatsApp / Template buttons ─────────────────────────────── */}
      <div className="flex gap-2 flex-wrap">
        {lead.phone && (
          <a
            href={`tel:${lead.phone}`}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dark-50 text-white/50 hover:text-white hover:border-gold/30 transition-colors text-sm font-medium min-w-0"
          >
            <Phone size={14} /> Call
          </a>
        )}
        {lead.phone && (
          <a
            href={`https://wa.me/91${lead.phone.replace(/\D/g, '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-green-500/20 text-green-400/60 hover:text-green-400 hover:border-green-500/40 transition-colors text-sm font-medium min-w-0"
          >
            <MessageCircle size={14} /> WhatsApp
          </a>
        )}
        <button
          onClick={() => setShowTemplates(true)}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-gold/20 text-gold/60 hover:text-gold hover:bg-gold/5 hover:border-gold/40 transition-colors text-sm font-medium min-w-0"
        >
          <FileText size={14} /> Template
        </button>
      </div>

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

        <textarea
          className="input w-full resize-none text-sm mb-2"
          rows={3}
          placeholder="Log a call, note an update, record anything… (Hindi/Hinglish/English)"
          value={noteText}
          onChange={e => setNoteText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitNote(); }}
        />

        {voice.listening && (
          <div className="flex items-center gap-3 px-4 py-2.5 mb-2 bg-red-500/5 border border-red-500/20 rounded-xl">
            <div className="flex items-end gap-0.5 flex-shrink-0">
              {[3,5,7,5,3].map((h, i) => (
                <div
                  key={i}
                  className="w-0.5 bg-red-400 rounded-full animate-bounce"
                  style={{ height: `${h}px`, animationDelay: `${i * 100}ms` }}
                />
              ))}
            </div>
            <span className="text-red-400 text-xs font-medium flex-shrink-0">Recording…</span>
            {voice.interimText && (
              <span className="text-white/35 text-xs italic truncate min-w-0">
                {voice.interimText.slice(-80)}
              </span>
            )}
          </div>
        )}

        {voice.voiceError && (
          <p className="flex items-center gap-2 text-amber-400 text-xs mb-2">
            <AlertCircle size={12} />{voice.voiceError}
          </p>
        )}

        <div className="flex items-center gap-2">
          {voice.hasVoice && (
            <button
              onClick={voice.toggle}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-all ${
                voice.listening
                  ? 'bg-red-500 border-red-500 text-white'
                  : 'border-dark-50 text-white/50 hover:text-white hover:border-gold/40'
              }`}
            >
              {voice.listening ? <><MicOff size={14} /> Stop</> : <><Mic size={14} /> Speak</>}
            </button>
          )}
          <button
            onClick={submitNote}
            disabled={!noteText.trim() || saving}
            className="btn-primary flex items-center gap-1.5 ml-auto"
          >
            <Send size={13} /> Save
          </button>
        </div>
        {!voice.hasVoice && (
          <p className="text-white/15 text-xs mt-2">Voice input not available (use Chrome for best results)</p>
        )}
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

      {/* ── Template picker ──────────────────────────────────────────────────── */}
      {showTemplates && (
        <TemplatePicker
          lead={lead}
          onClose={() => setShowTemplates(false)}
          onSent={(title) => {
            appendNote(`Template sent: "${title}"`);
            setShowTemplates(false);
          }}
        />
      )}
    </div>
  );
}
