import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Phone, MapPin, Clock, AlertTriangle, CalendarDays,
  Filter as Funnel, User, Users, PhoneOff, ChevronRight,
  LayoutGrid, List, Trophy, ChevronDown, ChevronUp,
  Search, Upload, X, Trash2, Loader2, FileText,
  CheckCircle2, ChevronLeft, AlignLeft, Keyboard,
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

const PIPELINE: LeadStage[] = ['new','contacted','interested','catalogue_sent','follow_up','visit_scheduled'];
const PAGE_SIZE = 50;

function nextStage(s: LeadStage): LeadStage | null {
  const i = PIPELINE.indexOf(s);
  if (i === -1) return null;
  return i < PIPELINE.length - 1 ? PIPELINE[i + 1] : 'won';
}

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

// ── CSV helpers ────────────────────────────────────────────────────────────────

function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if ((ch === ',' || ch === '\t') && !inQuotes) {
      result.push(field.trim()); field = '';
    } else {
      field += ch;
    }
  }
  result.push(field.trim());
  return result;
}

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = splitCSVLine(lines[0]).map(h => h.replace(/^"|"$/g, '').trim());
  const rows = lines.slice(1).map(line => {
    const vals = splitCSVLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, vals[i]?.replace(/^"|"$/g, '').trim() ?? '']));
  });
  return { headers, rows };
}

function autoDetectCol(headers: string[], field: string): string {
  const synonyms: Record<string, string[]> = {
    name:   ['name', 'customer', 'client', 'lead', 'contact', 'person', 'shop', 'firm', 'company'],
    phone:  ['phone', 'mobile', 'cell', 'number', 'tel', 'whatsapp', 'mob', 'contact no'],
    place:  ['place', 'city', 'location', 'area', 'address', 'town', 'district', 'region'],
    source: ['source', 'from', 'channel', 'via', 'medium', 'referred'],
    stage:  ['stage', 'status', 'pipeline', 'step', 'progress'],
  };
  const words = synonyms[field] || [field];
  return headers.find(h => words.some(w => h.toLowerCase().includes(w))) || '';
}

// ── Win celebration ────────────────────────────────────────────────────────────
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
        <Trophy size={56} className="text-gold mx-auto mb-3 animate-pulse drop-shadow-[0_0_24px_rgba(212,175,55,0.9)]" />
        <p className="text-gold font-bold text-2xl tracking-wide">Lead Won! 🏆</p>
        <p className="text-white/50 text-sm mt-2">+50 merit points awarded</p>
      </div>
    </div>
  );
}

function Toast({ msg }: { msg: string }) {
  if (!msg) return null;
  return (
    <div className="fixed bottom-6 right-6 z-40 bg-dark-200 border border-gold/20 text-white/80 text-sm px-4 py-2.5 rounded-xl shadow-lg animate-slide-up">
      {msg}
    </div>
  );
}

interface Team { id: string; name: string; members: string[]; }

// ── Contact parser (no AI) ────────────────────────────────────────────────────
// Handles: comma/tab/dash-separated lines, multi-line blocks, label prefixes,
// +91 prefix, WhatsApp exports, Excel copy-paste.
function parseRawContacts(text: string): { name: string; phone: string; place: string }[] {
  const PHONE_RE = /(?:\+91[\s\-.]?|91[\s\-.]?|0)?([6-9]\d{9})/g;
  const LABEL_RE = /\b(name|phone|mobile|mob|cell|no\.?|number|city|place|area|location|contact|sr\.?\s*no\.?|s\.?\s*no\.?|#)\s*[:.]?\s*/gi;
  const HEADER_RE = /^(name|phone|mobile|city|place|area|s\.?\s*no|sr|#|contact)\b.{0,30}$/i;
  const results: { name: string; phone: string; place: string }[] = [];
  const seenPhones = new Set<string>();

  // Split into blank-line-separated blocks
  const rawLines = text.trim().split(/\r?\n/);
  const blocks: string[][] = [];
  let cur: string[] = [];
  for (const line of rawLines) {
    const t = line.trim();
    if (!t) { if (cur.length) { blocks.push(cur); cur = []; } }
    else cur.push(t);
  }
  if (cur.length) blocks.push(cur);

  for (const block of blocks) {
    // Skip header rows
    if (block.length === 1 && HEADER_RE.test(block[0])) continue;

    const blockText = block.join(' ');
    PHONE_RE.lastIndex = 0;

    // Collect all phone matches in this block
    const phoneMatches: { phone: string; raw: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = PHONE_RE.exec(blockText)) !== null) phoneMatches.push({ phone: m[1], raw: m[0] });

    // Multi-phone multi-line block → parse each line independently
    if (phoneMatches.length > 1 && block.length > 1) {
      for (const line of block) {
        PHONE_RE.lastIndex = 0;
        const pm = PHONE_RE.exec(line);
        if (!pm) continue;
        const phone = pm[1];
        if (seenPhones.has(phone)) continue;
        seenPhones.add(phone);
        const rest = line.replace(pm[0], '').replace(LABEL_RE, '').replace(/[-,|;:()[\]]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (rest) results.push({ name: rest, phone, place: '' });
      }
      continue;
    }

    if (phoneMatches.length === 0) {
      // No phone — add as name-only if it looks like a proper name (≥2 words, alpha)
      const clean = blockText.replace(LABEL_RE, '').replace(/[-,|;:()[\]]+/g, ' ').trim();
      if (/^[A-Za-z\s.'''-]{4,}$/.test(clean) && clean.split(/\s+/).length >= 2)
        results.push({ name: clean, phone: '', place: '' });
      continue;
    }

    // Single phone in block
    const { phone, raw } = phoneMatches[0];
    if (seenPhones.has(phone)) continue;
    seenPhones.add(phone);

    const cleaned = blockText
      .replace(raw, ' ')
      .replace(LABEL_RE, ' ')
      .replace(/[-,|;:()[\]]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const words = cleaned.split(/\s+/).filter(Boolean);
    let name = '', place = '';

    if (words.length === 0) continue;
    if (words.length === 1) {
      name = words[0];
    } else {
      // Last capitalized single word is likely a city
      const last = words[words.length - 1];
      if (last.length >= 3 && /^[A-Z]/.test(last)) {
        place = last;
        name = words.slice(0, -1).join(' ');
      } else {
        name = words.join(' ');
      }
    }

    // Drop pure-number fragments that slipped through
    name = name.replace(/^\d+\s*/, '').trim();
    if (name) results.push({ name, phone, place });
  }

  return results;
}

// ── Bulk Import Modal ──────────────────────────────────────────────────────────
type ImportTab = 'csv' | 'paste' | 'quick';

interface ParsedLead { name: string; phone: string; place: string; source?: string; stage?: string; }

function BulkImportModal({ staffList, onClose, onImported }: {
  staffList: Staff[];
  onClose: () => void;
  onImported: (count: number) => void;
}) {
  const [tab, setTab]             = useState<ImportTab>('csv');
  const [assignedTo, setAssignedTo] = useState('');

  // CSV tab state
  const [csvHeaders, setCsvHeaders]   = useState<string[]>([]);
  const [csvRows, setCsvRows]         = useState<Record<string, string>[]>([]);
  const [colMap, setColMap]           = useState<Record<string, string>>({});
  const [dragOver, setDragOver]       = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Paste tab state
  const [pasteText, setPasteText]     = useState('');
  const [parsedLeads, setParsedLeads] = useState<ParsedLead[]>([]);
  const [parseError, setParseError]   = useState('');

  // Quick type state
  const [quickRows, setQuickRows]     = useState<ParsedLead[]>([{ name: '', phone: '', place: '' }]);

  // Shared
  const [importing, setImporting]     = useState(false);
  const [importError, setImportError] = useState('');

  // ── CSV helpers ──────────────────────────────────────────────────────────────
  const loadCSVText = (text: string) => {
    const { headers, rows } = parseCSV(text);
    setCsvHeaders(headers);
    setCsvRows(rows);
    // Auto-detect column mapping
    const detected: Record<string, string> = {};
    ['name', 'phone', 'place', 'source', 'stage'].forEach(f => {
      detected[f] = autoDetectCol(headers, f);
    });
    setColMap(detected);
  };

  const handleFileLoad = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => { if (e.target?.result) loadCSVText(e.target.result as string); };
    reader.readAsText(file);
  };

  const mappedRows = csvRows
    .map(row => ({
      name:   colMap.name  ? row[colMap.name]  || '' : '',
      phone:  colMap.phone ? row[colMap.phone] || '' : '',
      place:  colMap.place ? row[colMap.place] || '' : '',
      source: colMap.source ? row[colMap.source] || '' : '',
      stage:  colMap.stage  ? row[colMap.stage]  || '' : '',
    }))
    .filter(r => r.name.trim());

  // ── Paste / AI parse ─────────────────────────────────────────────────────────
  const handleParseText = () => {
    if (!pasteText.trim()) return;
    setParseError('');
    const contacts = parseRawContacts(pasteText);
    setParsedLeads(contacts);
    if (contacts.length === 0) setParseError('No contacts found. Make sure each line has a name and/or a 10-digit phone number.');
  };

  const updateParsedLead = (i: number, field: keyof ParsedLead, value: string) => {
    setParsedLeads(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l));
  };

  // ── Quick type ───────────────────────────────────────────────────────────────
  const updateQuickRow = (i: number, field: keyof ParsedLead, value: string) => {
    setQuickRows(prev => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: value };
      return next;
    });
  };

  const handleQuickKeyDown = (e: React.KeyboardEvent, rowIdx: number, field: 'name' | 'phone' | 'place') => {
    if (e.key === 'Enter' || (e.key === 'Tab' && field === 'place' && !e.shiftKey)) {
      e.preventDefault();
      if (field === 'place' || e.key === 'Enter') {
        // Advance to next row
        if (rowIdx === quickRows.length - 1) {
          setQuickRows(prev => [...prev, { name: '', phone: '', place: '' }]);
          setTimeout(() => {
            const inputs = document.querySelectorAll('[data-quick-name]');
            (inputs[rowIdx + 1] as HTMLInputElement)?.focus();
          }, 50);
        } else {
          setTimeout(() => {
            const inputs = document.querySelectorAll('[data-quick-name]');
            (inputs[rowIdx + 1] as HTMLInputElement)?.focus();
          }, 50);
        }
      }
    }
  };

  // Paste TSV into quick type table
  const handleQuickPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text');
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return;
    // Check if it looks like TSV (multiple tabs)
    if (!text.includes('\t')) return;
    e.preventDefault();
    const newRows = lines.map(line => {
      const parts = line.split('\t').map(p => p.trim());
      return { name: parts[0] || '', phone: parts[1] || '', place: parts[2] || '' };
    }).filter(r => r.name);
    if (newRows.length > 0) setQuickRows([...newRows, { name: '', phone: '', place: '' }]);
  };

  // ── Import ────────────────────────────────────────────────────────────────────
  const doImport = async (leads: ParsedLead[]) => {
    if (leads.length === 0) return;
    setImporting(true); setImportError('');
    try {
      const res = await leadsAPI.bulkImport(
        leads as unknown as Record<string, string>[],
        assignedTo || undefined
      );
      onImported(res.imported);
    } catch {
      setImportError('Import failed. Please try again.');
    } finally { setImporting(false); }
  };

  const getImportLeads = (): ParsedLead[] => {
    if (tab === 'csv')   return mappedRows;
    if (tab === 'paste') return parsedLeads.filter(l => l.name.trim());
    if (tab === 'quick') return quickRows.filter(r => r.name.trim());
    return [];
  };

  const importLeads = getImportLeads();
  const canImport = importLeads.length > 0 && !importing;

  const TABS: { id: ImportTab; label: string; icon: React.ElementType }[] = [
    { id: 'csv',   label: 'CSV File',    icon: FileText },
    { id: 'paste', label: 'Paste Text',  icon: AlignLeft },
    { id: 'quick', label: 'Quick Type',  icon: Keyboard },
  ];

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-dark-300 border border-dark-50 rounded-2xl w-full max-w-2xl shadow-2xl animate-scale-in max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-50 flex-shrink-0">
          <div>
            <h2 className="text-white font-semibold flex items-center gap-2">
              <Upload size={16} className="text-gold" /> Import Leads
            </h2>
            <p className="text-white/30 text-xs mt-0.5">Add hundreds of leads at once from any format</p>
          </div>
          <button type="button" onClick={onClose} className="text-white/40 hover:text-white"><X size={18} /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-dark-50 flex-shrink-0 px-6">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => { setTab(id); setImportError(''); }}
              className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
                tab === id
                  ? 'border-gold text-gold'
                  : 'border-transparent text-white/40 hover:text-white/70'
              }`}
            >
              <Icon size={12} />{label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">

          {/* ── CSV tab ───────────────────────────────────────────────────────── */}
          {tab === 'csv' && (
            <div className="space-y-4">
              <p className="text-white/40 text-xs">
                Upload a <strong className="text-white/60">.csv</strong> or <strong className="text-white/60">.txt</strong> file.
                First row must be column headers. Works with Excel exports too.
              </p>

              {/* Drop zone */}
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFileLoad(f); }}
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                  dragOver ? 'border-gold bg-gold/5' : 'border-dark-50 hover:border-gold/40 hover:bg-dark-200'
                }`}
              >
                <Upload size={28} className={`mx-auto mb-2 ${dragOver ? 'text-gold' : 'text-white/20'}`} />
                <p className="text-white/40 text-sm">Drop your CSV file here</p>
                <p className="text-white/20 text-xs mt-1">or click to browse</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.txt,.tsv"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFileLoad(f); }}
                />
              </div>

              {/* Column mapper */}
              {csvHeaders.length > 0 && (
                <div className="space-y-3">
                  <p className="text-white/50 text-xs font-semibold uppercase tracking-wider">
                    Map Columns ({csvRows.length} rows detected, {mappedRows.length} valid)
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {['name', 'phone', 'place', 'source', 'stage'].map(field => (
                      <div key={field}>
                        <label className="label capitalize">{field === 'place' ? 'City / Place' : field}</label>
                        <select
                          className="input text-xs"
                          value={colMap[field] || ''}
                          onChange={e => setColMap(m => ({ ...m, [field]: e.target.value }))}
                        >
                          <option value="">— Skip —</option>
                          {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>

                  {/* Preview */}
                  {mappedRows.length > 0 && (
                    <div className="border border-dark-50 rounded-xl overflow-hidden">
                      <div className="bg-dark-400 px-3 py-2 text-[10px] text-white/30 font-semibold uppercase tracking-wider flex gap-3">
                        <span className="w-32">Name</span><span className="w-28">Phone</span><span className="flex-1">City</span>
                      </div>
                      <div className="divide-y divide-dark-50 max-h-40 overflow-y-auto">
                        {mappedRows.slice(0, 5).map((r, i) => (
                          <div key={i} className="px-3 py-2 flex gap-3 text-xs">
                            <span className="w-32 text-white/70 truncate">{r.name || <span className="text-red-400 italic">missing</span>}</span>
                            <span className="w-28 text-white/40 truncate">{r.phone || '—'}</span>
                            <span className="flex-1 text-white/40 truncate">{r.place || '—'}</span>
                          </div>
                        ))}
                        {mappedRows.length > 5 && (
                          <div className="px-3 py-2 text-xs text-white/20 text-center">
                            +{mappedRows.length - 5} more rows
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Paste & AI tab ────────────────────────────────────────────────── */}
          {tab === 'paste' && (
            <div className="space-y-4">
              <p className="text-white/40 text-xs">
                Paste anything — WhatsApp exports, Excel copy-paste, names and numbers in any order. Contacts are extracted automatically.
              </p>
              <textarea
                className="input resize-none text-sm font-mono text-white/70 leading-relaxed"
                rows={7}
                placeholder={"Rahul Verma, 9876543210, Delhi\nPriya Sharma — Mumbai — 9123456789\nSunita (9988776655) Jaipur\n...anything works"}
                value={pasteText}
                onChange={e => { setPasteText(e.target.value); setParsedLeads([]); setParseError(''); }}
              />
              <button
                type="button"
                onClick={handleParseText}
                disabled={!pasteText.trim()}
                className="btn-primary flex items-center gap-2"
              >
                <AlignLeft size={14} /> Extract Contacts
              </button>
              {parseError && <p className="text-red-400 text-xs">{parseError}</p>}

              {/* Editable preview */}
              {parsedLeads.length > 0 && (
                <div className="space-y-2">
                  <p className="text-green-400 text-xs font-medium flex items-center gap-1.5">
                    <CheckCircle2 size={12} /> {parsedLeads.length} contacts extracted — review and edit below
                  </p>
                  <div className="border border-dark-50 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                    <div className="bg-dark-400 px-3 py-2 text-[10px] text-white/30 font-semibold uppercase tracking-wider grid grid-cols-3 gap-2">
                      <span>Name *</span><span>Phone</span><span>City</span>
                    </div>
                    {parsedLeads.map((l, i) => (
                      <div key={i} className="border-t border-dark-50 px-2 py-1.5 grid grid-cols-3 gap-2">
                        <input className="input py-1 text-xs" value={l.name}  onChange={e => updateParsedLead(i, 'name',  e.target.value)} placeholder="Name *" />
                        <input className="input py-1 text-xs" value={l.phone} onChange={e => updateParsedLead(i, 'phone', e.target.value)} placeholder="Phone" />
                        <input className="input py-1 text-xs" value={l.place} onChange={e => updateParsedLead(i, 'place', e.target.value)} placeholder="City" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Quick type tab ────────────────────────────────────────────────── */}
          {tab === 'quick' && (
            <div className="space-y-3">
              <p className="text-white/40 text-xs">
                Type leads one by one. Press <kbd className="bg-dark-200 border border-dark-50 rounded px-1 text-[10px]">Enter</kbd> or <kbd className="bg-dark-200 border border-dark-50 rounded px-1 text-[10px]">Tab</kbd> after City to jump to the next row. Paste a copied Excel range to fill all at once.
              </p>

              <div className="border border-dark-50 rounded-xl overflow-hidden">
                <div className="bg-dark-400 px-3 py-2 text-[10px] text-white/30 font-semibold uppercase tracking-wider grid grid-cols-3 gap-2">
                  <span>Name *</span><span>Phone</span><span>City / Place</span>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-dark-50/50">
                  {quickRows.map((row, i) => {
                    const isDone = row.name.trim() && i < quickRows.length - 1;
                    return (
                      <div key={i} className={`px-2 py-1.5 grid grid-cols-3 gap-2 transition-colors ${isDone ? 'bg-green-500/3' : ''}`}>
                        <div className="flex items-center gap-1.5">
                          {isDone
                            ? <CheckCircle2 size={12} className="text-green-400 flex-shrink-0" />
                            : <span className="w-3 flex-shrink-0" />}
                          <input
                            data-quick-name
                            className="input py-1 text-xs flex-1"
                            value={row.name}
                            onChange={e => updateQuickRow(i, 'name', e.target.value)}
                            onPaste={i === 0 ? handleQuickPaste : undefined}
                            placeholder={i === 0 ? 'e.g. Rahul Verma' : ''}
                            autoFocus={i === 0}
                          />
                        </div>
                        <input
                          className="input py-1 text-xs"
                          value={row.phone}
                          onChange={e => updateQuickRow(i, 'phone', e.target.value)}
                          placeholder="9876543210"
                          type="tel"
                        />
                        <input
                          className="input py-1 text-xs"
                          value={row.place}
                          onChange={e => updateQuickRow(i, 'place', e.target.value)}
                          placeholder="Delhi"
                          onKeyDown={e => handleQuickKeyDown(e, i, 'place')}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
              <p className="text-white/20 text-[10px]">
                {quickRows.filter(r => r.name.trim()).length} lead{quickRows.filter(r => r.name.trim()).length !== 1 ? 's' : ''} ready
              </p>
            </div>
          )}

          {importError && <p className="text-red-400 text-xs">{importError}</p>}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 pt-3 border-t border-dark-50 flex-shrink-0 space-y-3">
          {/* Assign to staff (admin) */}
          {staffList.length > 0 && (
            <div className="flex items-center gap-3">
              <label className="text-white/40 text-xs whitespace-nowrap">Assign to:</label>
              <select className="input py-1.5 text-xs flex-1" value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
                <option value="">Default (me / auto)</option>
                {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancel</button>
            <button
              type="button"
              onClick={() => doImport(importLeads)}
              disabled={!canImport}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
            >
              {importing
                ? <><Loader2 size={14} className="animate-spin" />Importing…</>
                : <><Upload size={14} />Import {importLeads.length > 0 ? `${importLeads.length} Lead${importLeads.length !== 1 ? 's' : ''}` : 'Leads'}</>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Lead card ──────────────────────────────────────────────────────────────────
interface LeadCardProps {
  lead: Lead;
  today: string;
  isAdmin: boolean;
  onAction: (id: string, patch: Partial<Lead>, checkWin?: boolean) => void;
  isSelectMode?: boolean;
  isSelected?: boolean;
  onSelect?: (id: string) => void;
}

function LeadCard({ lead, today, isAdmin, onAction, isSelectMode, isSelected, onSelect }: LeadCardProps) {
  const navigate = useNavigate();
  const isOverdue  = lead.nextFollowUp && lead.nextFollowUp < today;
  const isDueToday = lead.nextFollowUp === today;
  const heat       = getLeadHeat(lead, today);
  const lastNote   = lead.notes?.length ? lead.notes[lead.notes.length - 1] : null;
  const nxt        = nextStage(lead.stage);

  const handleClick = () => {
    if (isSelectMode && onSelect) { onSelect(lead.id); return; }
    navigate(`/crm/${lead.id}`);
  };

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
      onClick={handleClick}
      className={`card cursor-pointer hover:border-gold/30 transition-all group relative ${
        isSelected    ? 'border-gold/50 bg-gold/3' :
        isOverdue     ? 'border-red-500/20' :
        isDueToday    ? 'border-orange-500/20' : ''
      }`}
    >
      {/* Select mode checkbox */}
      {isSelectMode && (
        <div className={`absolute top-3 left-3 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
          isSelected ? 'bg-gold border-gold' : 'border-white/30 bg-dark-200'
        }`}>
          {isSelected && <CheckCircle2 size={12} className="text-white" />}
        </div>
      )}

      {/* Heat dot — hot leads get an expanding ping ring */}
      {heat === 'hot' ? (
        <span className="absolute top-3 right-3 flex items-center justify-center" title="hot">
          <span className="animate-ping absolute w-2.5 h-2.5 rounded-full bg-red-500 opacity-50" />
          <span className="relative w-2 h-2 rounded-full bg-red-500" style={{ boxShadow: '0 0 8px rgba(239,68,68,0.8)' }} />
        </span>
      ) : (
        <span
          className={`absolute top-3 right-3 w-2 h-2 rounded-full ${HEAT_DOT[heat]}`}
          title={heat}
          style={heat === 'warm' ? { boxShadow: '0 0 7px rgba(251,146,60,0.7)' } : undefined}
        />
      )}

      <div className={`flex items-start gap-3 ${isSelectMode ? 'pl-7' : ''}`}>
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

      {/* Quick actions — hidden in select mode */}
      {!isSelectMode && (
        <div className="flex items-center gap-1.5 mt-2.5 pt-2.5 border-t border-dark-50 translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-200 md:translate-y-1 md:opacity-0">
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
      )}
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
      <div className="px-3 py-2 border-b border-dark-50 flex items-center justify-between">
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
  const [staffFilter,   setStaffFilter]   = useState<string>('all');
  const [loading,       setLoading]       = useState(true);
  const [tab,           setTab]           = useState<'today' | 'all' | LeadStage>('today');
  const [view,          setView]          = useState<'list' | 'kanban'>(() =>
    (localStorage.getItem('crm_view') as 'list' | 'kanban') || 'list'
  );
  const [showAttention, setShowAttention] = useState(true);
  const [celebration,   setCelebration]   = useState(false);
  const [toast,         setToast]         = useState('');

  // New state
  const [search,        setSearch]        = useState('');
  const [sortBy,        setSortBy]        = useState<string>('followup');
  const [page,          setPage]          = useState(0);
  const [selectMode,    setSelectMode]    = useState(false);
  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set());
  const [showImport,    setShowImport]    = useState(false);
  const [bulkLoading,   setBulkLoading]   = useState(false);
  const [followupDate,  setFollowupDate]  = useState('');

  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const load = useCallback(async () => {
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
  }, [teamFilter, staffFilter, isAdmin]);

  useEffect(() => { load(); }, [load]);

  const handleTeamChange = (val: string) => { setTeamFilter(val); setStaffFilter('all'); };

  const filteredStaff = teamFilter === 'all'
    ? staffList
    : staffList.filter(s => teams.find(t => t.id === teamFilter)?.members?.includes(s.id));

  const switchView = (v: 'list' | 'kanban') => {
    setView(v);
    localStorage.setItem('crm_view', v);
  };

  const today = new Date().toISOString().split('T')[0];

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
      load();
      showToast('Action failed — refreshing');
    }
  }, [leads, load]);

  // ── Bulk actions ─────────────────────────────────────────────────────────────
  const handleBulkAction = async (action: string, value?: string) => {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    setBulkLoading(true);
    try {
      await leadsAPI.bulkActions(ids, action, value);
      await load();
      setSelectedIds(new Set());
      if (action === 'delete') {
        setSelectMode(false);
        showToast(`Deleted ${ids.length} leads`);
      } else {
        showToast(`Updated ${ids.length} leads`);
      }
    } catch {
      showToast('Bulk action failed');
    } finally { setBulkLoading(false); }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllPage = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      paginated.forEach(l => next.add(l.id));
      return next;
    });
  };

  // ── Stats ────────────────────────────────────────────────────────────────────
  const thisMonth      = today.slice(0, 7);
  const needsAttn      = leads.filter(l => l.nextFollowUp && l.nextFollowUp <= today && l.stage !== 'won' && l.stage !== 'lost');
  const active         = leads.filter(l => l.stage !== 'won' && l.stage !== 'lost');
  const wonMonth       = leads.filter(l => l.stage === 'won' && l.updatedAt?.startsWith(thisMonth));
  const lostCount      = leads.filter(l => l.stage === 'lost').length;
  const wonCount       = leads.filter(l => l.stage === 'won').length;
  const conversion     = wonCount + lostCount > 0 ? Math.round(wonCount / (wonCount + lostCount) * 100) : 0;
  const overdueTodayCount = leads.filter(l => l.nextFollowUp && l.nextFollowUp < today).length;

  // ── Tab + search + sort + paginate ───────────────────────────────────────────
  const todayLeads = leads.filter(l => l.nextFollowUp && l.nextFollowUp <= today);

  const tabFiltered = (() => {
    if (tab === 'today') return todayLeads;
    if (tab === 'all')   return leads;
    return leads.filter(l => l.stage === tab);
  })();

  const q = search.trim().toLowerCase();
  const searched = q
    ? tabFiltered.filter(l =>
        l.name.toLowerCase().includes(q) ||
        l.phone.includes(search.trim()) ||
        (l.place || '').toLowerCase().includes(q)
      )
    : tabFiltered;

  const sorted = [...searched].sort((a, b) => {
    if (sortBy === 'name')    return a.name.localeCompare(b.name);
    if (sortBy === 'stage')   return STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage);
    if (sortBy === 'newest')  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (sortBy === 'heat') {
      const hOrder = { hot: 0, warm: 1, cold: 2 };
      return hOrder[getLeadHeat(a, today)] - hOrder[getLeadHeat(b, today)];
    }
    // followup (default): nulls last
    const aF = a.nextFollowUp || 'z';
    const bF = b.nextFollowUp || 'z';
    return aF.localeCompare(bF);
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages - 1);
  const paginated  = sorted.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const resetPage = () => setPage(0);

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
    <div className="space-y-4 animate-fade-in pb-24">
      <WinCelebration active={celebration} onDone={() => setCelebration(false)} />
      <Toast msg={toast} />

      {/* ── Bulk Import Modal ──────────────────────────────────────────────────── */}
      {showImport && (
        <BulkImportModal
          staffList={isAdmin ? staffList : []}
          onClose={() => setShowImport(false)}
          onImported={count => {
            setShowImport(false);
            load();
            showToast(`✓ ${count} lead${count !== 1 ? 's' : ''} imported!`);
          }}
        />
      )}

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
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* View toggle */}
          <div className="flex bg-dark-400 border border-dark-50 rounded-lg p-0.5">
            <button
              onClick={() => switchView('list')}
              className={`p-1.5 rounded-md transition-colors ${view === 'list' ? 'bg-gold text-white' : 'text-white/30 hover:text-white'}`}
            ><List size={14} /></button>
            <button
              onClick={() => switchView('kanban')}
              className={`p-1.5 rounded-md transition-colors ${view === 'kanban' ? 'bg-gold text-white' : 'text-white/30 hover:text-white'}`}
            ><LayoutGrid size={14} /></button>
          </div>
          {/* Select mode (list only) */}
          {view === 'list' && (
            <button
              onClick={() => { setSelectMode(s => !s); setSelectedIds(new Set()); }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${
                selectMode ? 'bg-gold/15 border-gold/40 text-gold' : 'border-dark-50 text-white/40 hover:text-white'
              }`}
            >
              <CheckCircle2 size={13} /> {selectMode ? 'Done' : 'Select'}
            </button>
          )}
          {/* Import */}
          <button
            onClick={() => setShowImport(true)}
            className="btn-ghost flex items-center gap-1.5 text-sm"
          >
            <Upload size={14} /> Import
          </button>
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
          onClick={() => { setTab('today'); resetPage(); }}
          className="card text-left hover:border-gold/20 transition-colors cursor-pointer"
        >
          <p className="text-red-400 text-xs font-medium mb-1">🔥 Needs Attention</p>
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

      {/* Search + Sort bar */}
      {view === 'list' && (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              className="input pl-9 pr-8"
              placeholder="Search by name, phone, or city…"
              value={search}
              onChange={e => { setSearch(e.target.value); resetPage(); }}
            />
            {search && (
              <button
                type="button"
                onClick={() => { setSearch(''); resetPage(); }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <select
            className="input w-36 text-sm"
            value={sortBy}
            onChange={e => { setSortBy(e.target.value); resetPage(); }}
          >
            <option value="followup">Follow-up date</option>
            <option value="heat">Heat (hot first)</option>
            <option value="name">Name A–Z</option>
            <option value="stage">Stage</option>
            <option value="newest">Newest first</option>
          </select>
        </div>
      )}

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

      {/* ── KANBAN VIEW ─────────────────────────────────────────────────────────── */}
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

      {/* ── LIST VIEW ───────────────────────────────────────────────────────────── */}
      {view === 'list' && (
        <>
          {/* 🔥 Needs Attention section */}
          {needsAttn.length > 0 && !search && (
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
                      <LeadCard
                        key={l.id} lead={l} today={today} isAdmin={isAdmin} onAction={handleAction}
                        isSelectMode={selectMode} isSelected={selectedIds.has(l.id)} onSelect={toggleSelect}
                      />
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
              onClick={() => { setTab('today'); resetPage(); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                tab === 'today' ? 'bg-gold text-white border-gold' : 'bg-dark-400 border-dark-50 text-white/40 hover:text-white'
              }`}
            >
              <CalendarDays size={11} /> Today
              {todayLeads.length > 0 && (
                <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
                  tab === 'today' ? 'bg-white/20 text-white' : 'bg-red-500/20 text-red-400'
                }`}>{todayLeads.length}</span>
              )}
            </button>
            <button
              onClick={() => { setTab('all'); resetPage(); }}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                tab === 'all' ? 'bg-gold text-white border-gold' : 'bg-dark-400 border-dark-50 text-white/40 hover:text-white'
              }`}
            >All ({leads.length})</button>
            {STAGES.map(s => stageCounts[s] ? (
              <button
                key={s}
                onClick={() => { setTab(s); resetPage(); }}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                  tab === s ? 'bg-gold text-white border-gold' : 'bg-dark-400 border-dark-50 text-white/40 hover:text-white'
                }`}
              >{STAGE_LABELS[s]} ({stageCounts[s]})</button>
            ) : null)}
          </div>

          {/* Search result info */}
          {search && (
            <p className="text-white/30 text-xs">
              {sorted.length === 0
                ? `No leads match "${search}"`
                : `${sorted.length} lead${sorted.length !== 1 ? 's' : ''} match "${search}"`}
            </p>
          )}

          {/* Lead list */}
          {sorted.length === 0 ? (
            <div className="card text-center py-14">
              <Funnel size={36} className="text-white/10 mx-auto mb-3" />
              {search ? (
                <>
                  <p className="text-white/40 font-medium">No leads match "{search}"</p>
                  <button onClick={() => setSearch('')} className="text-gold text-sm mt-2 hover:text-gold/80">Clear search</button>
                </>
              ) : (
                <>
                  <p className="text-white/40 font-medium">
                    {tab === 'today' ? 'No follow-ups due today' :
                     tab === 'all'   ? 'No leads yet' :
                     `No leads in "${STAGE_LABELS[tab as LeadStage]}" stage`}
                  </p>
                  {tab === 'all' && (
                    <div className="flex items-center gap-2 mt-4 justify-center">
                      <button onClick={() => navigate('/crm/new')} className="btn-primary flex items-center gap-2">
                        <Plus size={14} /> Add Lead
                      </button>
                      <button onClick={() => setShowImport(true)} className="btn-ghost flex items-center gap-2">
                        <Upload size={14} /> Import List
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {paginated.map((l, i) => (
                  <div
                    key={l.id}
                    className="animate-fade-in-up"
                    style={{ animationDelay: `${Math.min(i, 7) * 35}ms` }}
                  >
                    <LeadCard
                      lead={l} today={today} isAdmin={isAdmin} onAction={handleAction}
                      isSelectMode={selectMode} isSelected={selectedIds.has(l.id)} onSelect={toggleSelect}
                    />
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <p className="text-white/25 text-xs">
                    {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, sorted.length)} of {sorted.length} leads
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={safePage === 0}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-dark-50 text-white/40 text-xs hover:text-white hover:border-gold/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronLeft size={12} /> Prev
                    </button>
                    <span className="text-white/30 text-xs px-2">
                      {safePage + 1} / {totalPages}
                    </span>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                      disabled={safePage >= totalPages - 1}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-dark-50 text-white/40 text-xs hover:text-white hover:border-gold/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      Next <ChevronRight size={12} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Floating bulk action bar ─────────────────────────────────────────────── */}
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-dark-300/95 backdrop-blur-sm border-t border-gold/20 px-4 py-3 shadow-2xl animate-slide-up">
          <div className="max-w-4xl mx-auto flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 mr-1">
              <span className="text-white font-semibold text-sm">{selectedIds.size} selected</span>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-white/30 hover:text-white transition-colors"
              >
                <X size={14} />
              </button>
            </div>
            <button
              type="button"
              onClick={selectAllPage}
              className="text-gold/60 text-xs hover:text-gold transition-colors"
            >
              Select all {paginated.length}
            </button>
            <div className="flex-1" />

            {/* Set stage */}
            <select
              className="input py-1.5 text-xs w-auto"
              defaultValue=""
              onChange={e => { if (e.target.value) handleBulkAction('stage', e.target.value); e.target.value = ''; }}
              disabled={bulkLoading}
            >
              <option value="">Set Stage…</option>
              {STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
            </select>

            {/* Assign staff (admin) */}
            {isAdmin && staffList.length > 0 && (
              <select
                className="input py-1.5 text-xs w-auto"
                defaultValue=""
                onChange={e => { if (e.target.value) handleBulkAction('assign', e.target.value); e.target.value = ''; }}
                disabled={bulkLoading}
              >
                <option value="">Assign Staff…</option>
                {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}

            {/* Set follow-up */}
            <div className="flex items-center gap-1">
              <input
                type="date"
                className="input py-1.5 text-xs w-36"
                value={followupDate}
                onChange={e => setFollowupDate(e.target.value)}
              />
              <button
                type="button"
                onClick={() => { if (followupDate) { handleBulkAction('followup', followupDate); setFollowupDate(''); } }}
                disabled={!followupDate || bulkLoading}
                className="px-2.5 py-1.5 rounded-lg bg-gold/15 text-gold text-xs hover:bg-gold/25 disabled:opacity-40 transition-colors"
              >
                📅 Set
              </button>
            </div>

            {/* Delete */}
            <button
              type="button"
              onClick={() => {
                if (confirm(`Delete ${selectedIds.size} lead${selectedIds.size !== 1 ? 's' : ''}? This cannot be undone.`))
                  handleBulkAction('delete');
              }}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 text-xs hover:bg-red-500/20 disabled:opacity-40 transition-colors"
            >
              {bulkLoading ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
