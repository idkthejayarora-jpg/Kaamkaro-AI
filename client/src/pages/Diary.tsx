import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSSE } from '../hooks/useSSE';
import {
  Mic, MicOff, Send, Sparkles, ChevronDown, ChevronUp,
  AlertCircle, Clock, UserPlus, Globe, Trash2, RefreshCw, Languages,
  Filter, Users, Pencil, X, Check, ListTodo, CheckCircle2, Circle,
  ArrowRight,
} from 'lucide-react';
import { diaryAPI, staffAPI, tasksAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { DiaryEntry, Staff, Task } from '../types';

// ── Web Speech API types (not always in TS DOM lib) ───────────────────────────
interface SpeechRecognitionResult {
  isFinal: boolean;
  [index: number]: { transcript: string };
}
interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResult[];
}
interface ISpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart:  (() => void) | null;
  onend:    (() => void) | null;
  onerror:  ((e: { error: string }) => void) | null;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
}
declare global {
  interface Window {
    SpeechRecognition:        new () => ISpeechRecognition;
    webkitSpeechRecognition:  new () => ISpeechRecognition;
  }
}

// en-IN is used for all recording.
// Advantages over hi-IN:
//   • Always returns Roman script — no Devanagari conversion needed
//   • Handles English business words (parcel, payment, video call) correctly
//   • Still recognises Hindi/Hinglish words phonetically in Roman
//   • Eliminates the Devanagari-vs-Roman inconsistency that caused vocab errors
const VOICE_LANG = 'en-IN';

// ── Devanagari → Hinglish (Roman) transliterator ─────────────────────────────
// Chrome's hi-IN speech engine returns Devanagari script. This converts it to
// a readable Roman/Hinglish form so staff can see their words as they speak.
// Algorithm: iterate codepoints; consonants carry an inherent 'a' vowel that is
// flushed before the next consonant, suppressed by VIRAMA (्), and dropped
// silently at word boundaries (mimicking how Hindi is actually pronounced).
const _CONS: Record<string, string> = {
  // Core consonants
  'क':'k','ख':'kh','ग':'g','घ':'gh','ङ':'ng',
  'च':'ch','छ':'chh','ज':'j','झ':'jh','ञ':'ny',
  'ट':'t','ठ':'th','ड':'d','ढ':'dh','ण':'n',
  'त':'t','थ':'th','द':'d','ध':'dh','न':'n',
  'प':'p','फ':'ph','ब':'b','भ':'bh','म':'m',
  'य':'y','र':'r','ल':'l','ळ':'l','व':'v',
  'श':'sh','ष':'sh','स':'s','ह':'h',
  // Nukta variants — crucial for English loanwords
  // Chrome uses these for sounds like "call" (कॉल), "file" (फ़ाइल), "zone" (ज़ोन)
  'ड़':'r','ढ़':'rh','फ़':'f','ज़':'z','क़':'q','ख़':'kh','ग़':'gh',
};
const _MATR: Record<string, string> = {
  // Standard matras
  '\u093E':'a',   // ा  aa-matra  → single 'a' is more natural in Hinglish
  '\u093F':'i',   // ि
  '\u0940':'ee',  // ी
  '\u0941':'u',   // ु
  '\u0942':'oo',  // ू
  '\u0943':'ri',  // ृ
  '\u0947':'e',   // े
  '\u0948':'ai',  // ै
  '\u094B':'o',   // ो
  '\u094C':'au',  // ौ
  '\u0902':'n',   // ं  anusvara
  '\u0903':'h',   // ः  visarga
  '\u0901':'n',   // ँ  chandrabindu
  // ── English-loanword matras (previously missing → caused garbled output) ──
  '\u0949':'o',   // ॉ  short-O  e.g. कॉल → "kol" (call), डॉक्टर → "doctor"
  '\u0945':'e',   // ॅ  short-E  rare but present in some loanwords
  '\u0904':'a',   // ॄ  (rare, completeness)
};
const _IVOW: Record<string, string> = {
  'अ':'a','आ':'aa','इ':'i','ई':'ee','उ':'u','ऊ':'oo',
  'ऋ':'ri','ए':'e','ऐ':'ai','ओ':'o','औ':'au',
  // ── English-loanword independent vowels (previously missing) ──
  'ऑ':'o',   // U+0911 — short-O, used for "order", "off", "officer" etc.
  'ऎ':'e',   // U+090E — short-E (rare)
  'ऒ':'o',   // U+0912 — short-O alternate (rare)
};
const _VIR = '\u094D'; // VIRAMA / halant

function devanagariToRoman(text: string): string {
  if (!text || !/[\u0900-\u097F]/.test(text)) return text;
  let out = '';
  let pA  = false; // pendingA — inherent vowel after a consonant

  for (let i = 0; i < text.length; ) {
    const ch   = text[i];
    const deva = /[\u0900-\u097F]/.test(ch);

    if (!deva) {
      // Non-Devanagari (space / Latin / punctuation) — at word boundary
      // suppress the trailing inherent 'a' (final consonant in Hindi is silent)
      if (/\s/.test(ch)) { pA = false; }
      else if (pA) { out += 'a'; pA = false; }
      out += ch; i++; continue;
    }

    // Virama — suppresses inherent 'a', silent
    if (ch === _VIR) { pA = false; i++; continue; }

    // ── Nukta two-char sequences (base consonant + ़ U+093C) ─────────────
    // Must be checked before single-char consonant lookup
    const nxt = text[i + 1];
    if (nxt === '\u093C') {
      const pair = ch + nxt;
      if (_CONS[pair] !== undefined) {
        if (pA) { out += 'a'; pA = false; }
        out += _CONS[pair]; pA = true; i += 2; continue;
      }
    }

    // Matra
    if (_MATR[ch] !== undefined) { pA = false; out += _MATR[ch]; i++; continue; }

    // Independent vowel
    if (_IVOW[ch] !== undefined) {
      if (pA) { out += 'a'; pA = false; }
      out += _IVOW[ch]; i++; continue;
    }

    // Consonant
    if (_CONS[ch] !== undefined) {
      if (pA) { out += 'a'; pA = false; }
      out += _CONS[ch]; pA = true; i++; continue;
    }

    // Unknown Devanagari codepoint — flush pending 'a' and skip
    if (pA) { out += 'a'; pA = false; }
    i++;
  }
  // End of string: final consonant in Hindi is typically silent — do NOT flush pA

  return out.replace(/\s+/g, ' ').trim();
}

const SENTIMENT_STYLES: Record<string, string> = {
  positive: 'text-green-400 bg-green-500/10 border-green-500/20',
  neutral:  'text-white/40 bg-white/5 border-white/10',
  negative: 'text-red-400 bg-red-500/10 border-red-500/20',
};
const LANG_BADGE: Record<string, string> = {
  hindi:    'हिं · Hindi',
  english:  'EN · English',
  hinglish: 'HG · Hinglish',
};

// ── Diary card ────────────────────────────────────────────────────────────────
function DiaryCard({ entry, onDelete, onReanalyzed, showAuthor, entryTasks, onTaskCompleted }: {
  entry: DiaryEntry;
  onDelete: (id: string) => void;
  onReanalyzed: (updated: DiaryEntry) => void;
  showAuthor?: boolean;
  entryTasks: Task[];
  onTaskCompleted: (taskId: string) => void;
}) {
  const navigate = useNavigate();
  const [expanded,      setExpanded]      = useState(entry.status === 'done' && entry.aiEntries.length > 0);
  const [showOrig,      setShowOrig]      = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [deleteError,   setDeleteError]   = useState('');
  const [reanalyzing,   setReanalyzing]   = useState(false);
  const [editing,       setEditing]       = useState(false);
  const [editContent,   setEditContent]   = useState(entry.content);
  const [editEntries,   setEditEntries]   = useState(entry.aiEntries);
  const [saving,        setSaving]        = useState(false);
  const [completingId,  setCompletingId]  = useState<string | null>(null);

  // Keep edit state in sync if SSE pushes an update while not editing
  useEffect(() => {
    if (!editing) {
      setEditContent(entry.content);
      setEditEntries(entry.aiEntries);
    }
  }, [entry.content, entry.aiEntries, editing]);

  const hasTranslation =
    entry.translatedContent && entry.translatedContent.trim() !== entry.content.trim();

  const handleDelete = async () => {
    if (!confirm('Delete this diary entry? This cannot be undone.')) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await diaryAPI.delete(entry.id);
      onDelete(entry.id);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error || 'Delete failed — please try again.';
      setDeleteError(msg);
      setDeleting(false);
    }
  };

  const handleReanalyze = async () => {
    setReanalyzing(true);
    try {
      const updated = await diaryAPI.reanalyze(entry.id);
      onReanalyzed(updated);
    } catch { /* server will set status=processing; SSE will push the result */ }
    finally { setReanalyzing(false); }
  };

  const handleSaveEdit = async (reanalyze = false) => {
    setSaving(true);
    try {
      await diaryAPI.edit(entry.id, {
        content: editContent,
        aiEntries: reanalyze ? undefined : editEntries,
        reanalyze,
      });
      setEditing(false);
      // SSE will push the final update; optimistic update for content
      onReanalyzed({ ...entry, content: editContent, aiEntries: reanalyze ? [] : editEntries });
    } catch { /* non-fatal */ }
    finally { setSaving(false); }
  };

  const removeAiEntry = (idx: number) => {
    setEditEntries(prev => prev.filter((_, i) => i !== idx));
  };

  const handleCompleteTask = async (taskId: string) => {
    setCompletingId(taskId);
    try {
      await tasksAPI.complete(taskId);
      onTaskCompleted(taskId);
    } catch { /* non-fatal */ }
    finally { setCompletingId(null); }
  };

  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="card">
      {/* ── Header row ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-white/25 text-xs">
              {new Date(entry.createdAt).toLocaleDateString('en-IN', {
                day: 'numeric', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            </span>
            {showAuthor && entry.staffName && (
              <span className="badge bg-gold/10 text-gold border-gold/20 text-[10px]">
                <Users size={8} className="mr-0.5 inline" />
                {entry.staffName}
              </span>
            )}
            {entry.detectedLanguage && (
              <span className="badge bg-purple-500/10 text-purple-400 border-purple-500/20 text-[10px]">
                <Globe size={8} className="mr-0.5 inline" />
                {LANG_BADGE[entry.detectedLanguage] ?? entry.detectedLanguage}
              </span>
            )}
            {entry.status === 'processing' && (
              <span className="badge badge-gold text-[10px] flex items-center gap-1">
                <Clock size={9} className="animate-pulse" /> Analysing…
              </span>
            )}
            {entry.status === 'done' && (
              <span className="badge badge-green text-[10px]">
                {entry.aiEntries.length} {entry.aiEntries.length === 1 ? 'entry' : 'entries'} extracted
              </span>
            )}
            {entry.status === 'error' && (
              <span className="badge badge-red text-[10px]">AI error</span>
            )}
          </div>

          {/* Content — show translation by default, toggle to original */}
          {hasTranslation ? (
            <div>
              <p className="text-white/60 text-sm leading-relaxed line-clamp-3">
                {showOrig ? entry.content : entry.translatedContent}
              </p>
              <button
                onClick={() => setShowOrig(s => !s)}
                className="flex items-center gap-1 text-gold/50 hover:text-gold text-[10px] mt-1.5 transition-colors"
              >
                <Languages size={10} />
                {showOrig ? 'Show translated' : 'Show original'}
              </button>
            </div>
          ) : (
            <p className="text-white/60 text-sm leading-relaxed line-clamp-3">{entry.content}</p>
          )}

          {deleteError && (
            <p className="text-red-400 text-xs mt-1.5 flex items-center gap-1">
              <AlertCircle size={11} />{deleteError}
            </p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
          {(entry.status === 'done' && entry.aiEntries.length > 0 || entryTasks.length > 0) && !editing && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="p-1.5 text-white/30 hover:text-gold transition-colors rounded-lg"
            >
              {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
          )}
          {/* Edit button */}
          {!editing && (
            <button
              onClick={() => { setEditing(true); setExpanded(false); }}
              title="Edit entry"
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-white/10 bg-white/5 text-white/40 hover:bg-white/10 hover:text-white hover:border-white/20 transition-all text-xs font-medium"
            >
              <Pencil size={11} />
              <span className="hidden sm:inline">Edit</span>
            </button>
          )}
          {/* Re-analyze — always available so staff can fix bad extractions */}
          {!editing && (
            <button
              onClick={handleReanalyze}
              disabled={reanalyzing || entry.status === 'processing'}
              title="Re-run AI analysis"
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-gold/20 bg-gold/5 text-gold/50 hover:bg-gold/10 hover:text-gold hover:border-gold/40 transition-all text-xs font-medium disabled:opacity-40"
            >
              {reanalyzing
                ? <div className="w-3 h-3 border border-gold/40 border-t-gold rounded-full animate-spin" />
                : <RefreshCw size={11} />}
              <span className="hidden sm:inline">{reanalyzing ? 'Analysing…' : 'Re-run'}</span>
            </button>
          )}
          {!editing && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:border-red-500/60 transition-all text-xs font-medium disabled:opacity-50"
            >
              {deleting
                ? <div className="w-3 h-3 border border-red-400/50 border-t-red-400 rounded-full animate-spin" />
                : <Trash2 size={11} />}
              <span className="hidden sm:inline">{deleting ? 'Deleting…' : 'Delete'}</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Edit panel ── */}
      {editing && (
        <div className="mt-4 pt-4 border-t border-dark-50/50 space-y-4 animate-fade-in">
          <p className="text-white/40 text-xs font-medium flex items-center gap-1.5">
            <Pencil size={10} className="text-gold" /> Editing entry
          </p>

          {/* Editable content textarea */}
          <textarea
            value={editContent}
            onChange={e => setEditContent(e.target.value)}
            rows={4}
            className="w-full bg-dark-200 border border-dark-50 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50 resize-none leading-relaxed"
          />

          {/* Detected customer links — removable */}
          {editEntries.length > 0 && (
            <div>
              <p className="text-white/30 text-xs mb-2">Detected customers — remove wrong ones:</p>
              <div className="space-y-1.5">
                {editEntries.map((e, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 bg-dark-200 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-5 h-5 rounded-full bg-dark-100 border border-dark-50 flex items-center justify-center flex-shrink-0">
                        <span className="text-white/40 text-[9px] font-bold">{(e.customerName || '?')[0].toUpperCase()}</span>
                      </div>
                      <span className="text-white text-xs font-medium truncate">{e.customerName}</span>
                      {e.spokenName && e.spokenName !== e.customerName && (
                        <span className="text-white/25 text-[10px] truncate">← "{e.spokenName}"</span>
                      )}
                      {e.isNewCustomer && (
                        <span className="badge bg-green-500/10 text-green-400 border-green-500/20 text-[9px] flex-shrink-0">new</span>
                      )}
                    </div>
                    <button
                      onClick={() => removeAiEntry(i)}
                      className="text-white/20 hover:text-red-400 transition-colors flex-shrink-0 p-0.5"
                      title="Remove this customer link"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => handleSaveEdit(true)}
              disabled={saving || !editContent.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gold text-black text-xs font-semibold hover:bg-gold/90 transition-colors disabled:opacity-40"
            >
              {saving ? <div className="w-3 h-3 border border-black/30 border-t-black rounded-full animate-spin" /> : <RefreshCw size={11} />}
              Save & Re-analyze
            </button>
            <button
              onClick={() => handleSaveEdit(false)}
              disabled={saving || !editContent.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/20 bg-white/5 text-white text-xs font-medium hover:bg-white/10 transition-colors disabled:opacity-40"
            >
              <Check size={11} /> Save only
            </button>
            <button
              onClick={() => { setEditing(false); setEditContent(entry.content); setEditEntries(entry.aiEntries); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white/30 hover:text-white text-xs transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── AI-extracted entries ── */}
      {!editing && expanded && entry.aiEntries.length > 0 && (
        <div className="mt-4 pt-4 border-t border-dark-50/50 space-y-3 animate-fade-in">
          <p className="text-white/30 text-xs flex items-center gap-1.5">
            <Sparkles size={11} className="text-gold" />
            Kamal extracted these interactions:
          </p>
          {entry.aiEntries.map((e, i) => (
            <div key={i} className="bg-dark-200 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="w-6 h-6 rounded-full bg-dark-100 border border-dark-50 flex items-center justify-center flex-shrink-0">
                    <span className="text-white/40 text-[10px] font-bold">
                      {(e.customerName || '?')[0].toUpperCase()}
                    </span>
                  </div>
                  <span className="text-white font-medium text-sm">{e.customerName}</span>
                  {e.spokenName && e.spokenName !== e.customerName && (
                    <span className="text-white/25 text-xs">(said: "{e.spokenName}")</span>
                  )}
                  {e.isNewCustomer ? (
                    <span className="flex items-center gap-1 badge bg-green-500/10 text-green-400 border-green-500/20 text-[10px]">
                      <UserPlus size={9} /> New customer added
                    </span>
                  ) : e.matchedCustomerName ? (
                    <span className="badge badge-gold text-[10px]">✓ Matched</span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {e.sentiment && (
                    <span className={`badge text-[10px] border ${SENTIMENT_STYLES[e.sentiment] ?? ''}`}>
                      {e.sentiment}
                    </span>
                  )}
                  <span className="text-white/20 text-[10px]">{Math.round((e.confidence ?? 0) * 100)}%</span>
                </div>
              </div>
              {e.date && (
                <p className="text-white/30 text-xs">
                  {new Date(e.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </p>
              )}
              <p className="text-white/60 text-xs leading-relaxed">{e.notes}</p>
              {e.originalNotes && e.originalNotes !== e.notes && (
                <details className="mt-0.5">
                  <summary className="text-white/25 text-[10px] cursor-pointer hover:text-white/40 select-none">
                    Original text
                  </summary>
                  <p className="text-white/30 text-xs mt-1 leading-relaxed pl-2 border-l border-dark-50">
                    {e.originalNotes}
                  </p>
                </details>
              )}
              {e.actionItems && e.actionItems.length > 0 && (
                <div className="flex gap-1.5 flex-wrap pt-0.5">
                  {e.actionItems.map((a, j) => (
                    <span key={j} className="badge badge-gray text-[10px]">→ {a}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Tasks linked to this diary entry ── */}
      {!editing && expanded && entryTasks.length > 0 && (
        <div className="mt-4 pt-4 border-t border-dark-50/50 space-y-2 animate-fade-in">
          <div className="flex items-center justify-between">
            <p className="text-white/30 text-xs flex items-center gap-1.5">
              <ListTodo size={11} className="text-gold/70" />
              Tasks created from this entry
              <span className="text-white/20 ml-1">
                ({entryTasks.filter(t => t.completed).length}/{entryTasks.length} done)
              </span>
            </p>
            <button
              onClick={() => navigate('/tasks')}
              className="flex items-center gap-1 text-[10px] text-gold/50 hover:text-gold transition-colors"
            >
              View all tasks <ArrowRight size={9} />
            </button>
          </div>

          <div className="space-y-1.5">
            {entryTasks.map(task => {
              const isOverdue = !task.completed && task.dueDate < today;
              const isDone    = task.completed;
              return (
                <div
                  key={task.id}
                  className={`flex items-start gap-2.5 px-3 py-2 rounded-xl border transition-all ${
                    isDone
                      ? 'bg-green-500/5 border-green-500/10 opacity-60'
                      : isOverdue
                        ? 'bg-red-500/5 border-red-500/15'
                        : 'bg-dark-200 border-dark-50/60'
                  }`}
                >
                  {/* Completion toggle */}
                  <button
                    onClick={() => !isDone && handleCompleteTask(task.id)}
                    disabled={isDone || completingId === task.id}
                    className="mt-0.5 flex-shrink-0 text-white/30 hover:text-green-400 transition-colors disabled:cursor-default"
                    title={isDone ? 'Completed' : 'Mark complete'}
                  >
                    {completingId === task.id
                      ? <div className="w-3.5 h-3.5 border border-white/20 border-t-green-400 rounded-full animate-spin" />
                      : isDone
                        ? <CheckCircle2 size={14} className="text-green-400" />
                        : <Circle size={14} />
                    }
                  </button>

                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium leading-snug ${isDone ? 'line-through text-white/30' : 'text-white/80'}`}>
                      {task.title}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {task.customerName && (
                        <span className="text-[10px] text-white/25">{task.customerName}</span>
                      )}
                      <span className={`text-[10px] ${isOverdue ? 'text-red-400' : 'text-white/25'}`}>
                        {isOverdue ? '⚠ Overdue · ' : ''}
                        {new Date(task.dueDate + 'T00:00:00').toLocaleDateString('en-IN', {
                          day: 'numeric', month: 'short',
                        })}
                      </span>
                      {(task.rescheduledCount ?? 0) > 0 && (
                        <span className="text-[10px] text-amber-400/70">
                          rescheduled {task.rescheduledCount}×
                        </span>
                      )}
                    </div>
                    {task.notes && !isDone && (
                      <p className="text-[10px] text-white/25 mt-0.5 truncate">{task.notes}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Hinglish phonetic correction ─────────────────────────────────────────────
// Chrome's hi-IN model often mangles English words spoken in a Hindi sentence.
// These replacements fix the most common patterns without changing real words.
// ── Chrome hi-IN Speech Recognition Error Corrector ──────────────────────────
//
// Chrome's hi-IN engine has FOUR systematic error categories. Fixing by category
// means every new word in that category is automatically covered — not just the
// ones we've seen before.
//
// CATEGORY A — PRONOUN EXPANSION
//   Chrome inserts 'a' between the pronoun stem and the -ka/-ki possessive suffix.
//   Rule: (stem)aka → (stem)ka  and  (stem)akee/(stem)aki → (stem)ki
//   Covers: usaka→uska, unaka→unka, isaka→iska, inaka→inka,
//            jinaka→jinka, kinaka→kinka, kisaka→kiska, apaka→apka, etc.
//
// CATEGORY B — FEMININE PAST TENSE -ee SUFFIX
//   Chrome adds a trailing 'e' to feminine past forms ending in -i.
//   e.g. hui→huee, gayi→gayee, aayi→aayee, boli→bolee, mili→milee
//
// CATEGORY C — INFINITIVE -ana EXPANSION
//   Chrome inserts 'a' before the -na suffix of Hindi infinitives.
//   e.g. nikalna→nikalana, bhejna→bhejana, dekhna→dekhana, bolna→bolana
//   Only business/conversation verbs listed — omit words that are also valid
//   names or have different meanings in -ana form (e.g. milana, sunana).
//
// CATEGORY D — ENGLISH BUSINESS WORDS IN HINDI PHONETICS
//   English words in a Hindi sentence get phonetically transliterated.
//   e.g. parcel→parsal, video call→veediyo kol, payment→paymant
//
// CATEGORY E — HINDI DATE / TIME WORDS
//   parson (day after tomorrow) → parason/parsoon
//
// CATEGORY F — CITY AND PLACE NAME MISSPELLINGS
//   Noida→noeda, Gurgaon→gurgoan, etc.
//
function fixTranscript(raw: string): string {
  let t = raw;

  // ── STAGE 1: Multi-word phrases — must run before single-word rules ───────
  t = t.replace(/\b(?:veediyo|vidiyo|veedeo|video)\s+(?:kol|kawl)\b/gi, 'video call');
  t = t.replace(/\bvideo\s+call\b/gi,          'video call');     // already correct — keep
  t = t.replace(/\bwhats?\s+app\b/gi,          'WhatsApp');
  t = t.replace(/\bwhat\s+sap\b/gi,            'WhatsApp');
  t = t.replace(/\bbaat?\s+huee\b/gi,          'baat hui');
  t = t.replace(/\bfollo\s+up\b/gi,            'follow-up');
  t = t.replace(/\bpa[yi]\s+se\b/gi,           'paise');
  // maal: "ka man/mal/mall liya/bheja/diya/gaya/mila/aaya/nahi/ready/deliver/nikala"
  t = t.replace(/\bka\s+ma(?:n|l{1,2})\s+(liya|bheja|diya|gaya|mila|aaya|nahi|ready|deliver|nikala(?:na)?)\b/gi,
    (_m, verb) => `ka maal ${verb.replace('nikalana', 'nikalna')}`);
  t = t.replace(/\bma(?:n|l{1,2})\s+(bheja|aaya|diya|gaya|mila|manga|nahi|ready|deliver|nikala(?:na)?)\b/gi,
    (_m, verb) => `maal ${verb.replace('nikalana', 'nikalna')}`);

  // ── STAGE 2 (CATEGORY A): Pronoun expansion — systematic regex ───────────
  // All Hindi possessives whose stem ends before -ka/-ki get an extra 'a' inserted.
  // Single rule covers: us, un, is, in, jin, kin, kis, ap, hab, tum, inhe, unhe
  t = t.replace(/\b(us|un|is|in|jin|kin|kis|ap|hab|tum)aka\b/gi,  '$1ka');
  t = t.replace(/\b(us|un|is|in|jin|kin|kis|ap|hab|tum)akee\b/gi, '$1ki');
  t = t.replace(/\b(us|un|is|in|jin|kin|kis|ap|hab|tum)aki\b/gi,  '$1ki');
  // Extended forms Chrome also produces
  t = t.replace(/\bmujhaka\b/gi,   'mujhko');
  t = t.replace(/\bhumaka\b/gi,    'humko');
  t = t.replace(/\btumhaka\b/gi,   'tumhara');

  // ── STAGE 3 (CATEGORY B): Feminine past tense -ee suffix ─────────────────
  // Only unambiguous words — avoid "dee", "lee", "dee" which are also names.
  t = t.replace(/\bhuee\b/gi,      'hui');
  t = t.replace(/\bgayee\b/gi,     'gayi');
  t = t.replace(/\baayee\b/gi,     'aayi');
  t = t.replace(/\baaee\b/gi,      'aayi');
  t = t.replace(/\bbolee\b/gi,     'boli');
  t = t.replace(/\bkaree\b/gi,     'kari');
  t = t.replace(/\bmilee\b/gi,     'mili');
  t = t.replace(/\bbhejee\b/gi,    'bheji');
  t = t.replace(/\bpayee\b/gi,     'payi');
  t = t.replace(/\bdikee\b/gi,     'diki');

  // ── STAGE 4 (CATEGORY C): Hindi infinitive -ana expansion ────────────────
  // Only business/conversation verbs where -ana form is not an independent word.
  t = t.replace(/\bnikalana\b/gi,    'nikalna');
  t = t.replace(/\bnikalane\b/gi,    'nikalne');
  t = t.replace(/\bbhejana\b/gi,     'bhejna');
  t = t.replace(/\bdekhana\b/gi,     'dekhna');
  t = t.replace(/\bbolana\b/gi,      'bolna');
  t = t.replace(/\blikhana\b/gi,     'likhna');
  t = t.replace(/\bpadhana\b/gi,     'padhna');
  t = t.replace(/\bkhelana\b/gi,     'khelna');
  t = t.replace(/\bpahunchana\b/gi,  'pahunchna');
  t = t.replace(/\bbechana\b/gi,     'bechna');
  t = t.replace(/\bkharidana\b/gi,   'kharidna');
  t = t.replace(/\bdikhana\b(?!\s+(?:do|dena))/gi, 'dikhna'); // "dikhana do" = show it
  t = t.replace(/\bsikhaana\b/gi,    'sikhna');
  t = t.replace(/\bchalaana\b/gi,    'chalana');   // chalana = drive/run (correct form)
  t = t.replace(/\bpakadana\b/gi,    'pakadna');

  // ── STAGE 5 (CATEGORY D): English business words in Hindi phonetics ───────
  // video
  t = t.replace(/\bveediyo\b/gi,        'video');
  t = t.replace(/\bvidiyo\b/gi,         'video');
  t = t.replace(/\bveedeo\b/gi,         'video');
  // karni (do/make — infinitive used in future context)
  t = t.replace(/\bkaranee\b/gi,        'karni');
  t = t.replace(/\bkarnee\b/gi,         'karni');
  t = t.replace(/\bkarani\b(?!\s*mata)/gi, 'karni');
  // parcel
  t = t.replace(/\bpar(?:sal|sel|cal)\b/gi, 'parcel');
  // payment
  t = t.replace(/\bpai?mant\b/gi,       'payment');
  // delivery
  t = t.replace(/\bdeli(?:vari|vary|every|ievery)\b/gi, 'delivery');
  // dispatch
  t = t.replace(/\bdis?pach\b/gi,       'dispatch');
  t = t.replace(/\bdespatch\b/gi,       'dispatch');
  // receipt
  t = t.replace(/\bri?sipt\b/gi,        'receipt');
  t = t.replace(/\breceet\b/gi,         'receipt');
  // sample
  t = t.replace(/\bsam(?:pal|pel)\b/gi, 'sample');
  // advance
  t = t.replace(/\badvans[ae]?\b/gi,    'advance');
  // confirm
  t = t.replace(/\bcon(?:farm|ferm)\b/gi, 'confirm');
  // appointment
  t = t.replace(/\bapointmant?\b/gi,    'appointment');
  // invoice
  t = t.replace(/\binvoic\b/gi,         'invoice');
  t = t.replace(/\binwoise\b/gi,        'invoice');
  // WhatsApp
  t = t.replace(/\bwhatsapp\b/gi,       'WhatsApp');
  // follow-up
  t = t.replace(/\bfollowup\b/gi,       'follow-up');
  // rupaye
  t = t.replace(/\brupaiy?e\b/gi,       'rupaye');
  t = t.replace(/\brupaee\b/gi,         'rupaye');
  // installment
  t = t.replace(/\binstallemant\b/gi,   'installment');
  t = t.replace(/\binstallmant\b/gi,    'installment');
  // commission
  t = t.replace(/\bcomis+ion\b/gi,      'commission');
  // courier
  t = t.replace(/\bk[ou]+rier\b/gi,     'courier');
  // transport
  t = t.replace(/\btansport\b/gi,       'transport');
  // meeting
  t = t.replace(/\bmeating\b/gi,        'meeting');
  // quotation
  t = t.replace(/\bkote(?:shan|than)\b/gi, 'quotation');

  // ── STAGE 5b (CATEGORY D continued): more business words ────────────────────
  // balance
  t = t.replace(/\bbal[ae]ns\b/gi,       'balance');
  // order
  t = t.replace(/\bordar\b/gi,           'order');
  // feedback
  t = t.replace(/\bfeeadback\b/gi,       'feedback');
  // follow (when Chrome splits or garbles it before "up")
  t = t.replace(/\bfoolow\b/gi,          'follow');
  // paise (money)
  t = t.replace(/\bpayse\b/gi,           'paise');
  // report
  t = t.replace(/\bripor[dt]\b/gi,       'report');
  // stock
  t = t.replace(/\bstaak\b/gi,           'stock');
  // cheque / check
  t = t.replace(/\bchek\b/gi,            'cheque');
  t = t.replace(/\bchekka\b/gi,          'cheque');
  // account
  t = t.replace(/\bakaaunt\b/gi,         'account');
  t = t.replace(/\bakaunt\b/gi,          'account');
  // transfer
  t = t.replace(/\btransefar\b/gi,       'transfer');
  // problem
  t = t.replace(/\bprabalam\b/gi,        'problem');
  t = t.replace(/\bprobalam\b/gi,        'problem');

  // ── STAGE 5c (CATEGORY C continued): more -ana infinitives ──────────────────
  t = t.replace(/\bjodana\b/gi,          'jodna');
  t = t.replace(/\bkhodana\b/gi,         'khodna');
  t = t.replace(/\bchadana\b/gi,         'chadhna');    // upload / climb
  t = t.replace(/\bsunana\b(?!\s+do)/gi, 'sunna');      // listen — "sunana do" = let them hear
  t = t.replace(/\bbatana\b(?!\s+do)/gi, 'batana');     // keep — "batana do" = keep it (valid)
  t = t.replace(/\bbhejwana\b/gi,        'bhijwana');   // get sent (causative)
  t = t.replace(/\bmanawana\b/gi,        'manwana');    // get agreed

  // ── STAGE 6 (CATEGORY E): Date / time words ───────────────────────────────
  t = t.replace(/\bpara?so+n?s?\b/gi,   'parson');   // day after tomorrow
  t = t.replace(/\bparsoo\b/gi,         'parson');
  t = t.replace(/\bkal\s+tak\b/gi,      'kal tak');  // normalise no-op guard
  t = t.replace(/\baaj\s+tak\b/gi,      'aaj tak');

  // ── STAGE 7 (CATEGORY F): City and place names ────────────────────────────
  t = t.replace(/\bnoeda\b/gi,          'Noida');
  t = t.replace(/\bnoyda\b/gi,          'Noida');
  t = t.replace(/\bnoda\b(?!l)/gi,      'Noida');
  t = t.replace(/\bgurg[oa]n\b/gi,      'Gurgaon');
  t = t.replace(/\bfar[ai]d?abad\b/gi,  'Faridabad');
  t = t.replace(/\bgaziabad\b/gi,       'Ghaziabad');
  t = t.replace(/\bghaziyabad\b/gi,     'Ghaziabad');
  t = t.replace(/\bhaidrabad\b/gi,      'Hyderabad');
  t = t.replace(/\bhydrabad\b/gi,       'Hyderabad');
  t = t.replace(/\bahmadabad\b/gi,      'Ahmedabad');
  t = t.replace(/\bbangalor\b/gi,       'Bangalore');
  t = t.replace(/\blaknow\b/gi,         'Lucknow');
  t = t.replace(/\blucnow\b/gi,         'Lucknow');
  t = t.replace(/\bbaranasi\b/gi,       'Varanasi');
  t = t.replace(/\bvaransi\b/gi,        'Varanasi');
  t = t.replace(/\bamri?ta?sar\b/gi,    'Amritsar');
  t = t.replace(/\bindor\b/gi,          'Indore');
  t = t.replace(/\bkanpoor\b/gi,        'Kanpur');
  t = t.replace(/\bjayp[ou][ou]r\b/gi,  'Jaipur');
  t = t.replace(/\bnaagpur\b/gi,        'Nagpur');
  t = t.replace(/\bnagpoor\b/gi,        'Nagpur');
  t = t.replace(/\bsoorat\b/gi,         'Surat');
  t = t.replace(/\bpuuna\b/gi,          'Pune');
  t = t.replace(/\bpuna\b/gi,           'Pune');
  t = t.replace(/\bdilli\b/gi,          'Delhi');
  t = t.replace(/\bdehlee\b/gi,         'Delhi');

  return t;
}

// ── Voice hook ────────────────────────────────────────────────────────────────
// Uses continuous=false + auto-restart on onend so each Chrome session is fresh
// (no replay bug). committedRef persists across restarts within one recording
// session to prevent double-committing the same phrase on rapid-fire onresult.
// interimText is NOT cleared on restart — prevents the "flicker" that made
// the preview look jumpy between sentences.
function useVoice(onFinalText: (text: string) => void) {
  const [listening,   setListening]   = useState(false);
  const [interimText, setInterimText] = useState('');
  const [hasVoice,    setHasVoice]    = useState(false);
  const [voiceError,  setVoiceError]  = useState('');

  const recRef        = useRef<ISpeechRecognition | null>(null);
  const listeningRef  = useRef(false);
  const stoppingRef   = useRef(false);
  const fatalErrorRef = useRef(false);
  const onFinalRef    = useRef(onFinalText);
  const committedRef  = useRef<Set<string>>(new Set());

  useEffect(() => { onFinalRef.current = onFinalText; }, [onFinalText]);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setHasVoice(!!SR);
  }, []);

  useEffect(() => {
    return () => {
      listeningRef.current = false;
      stoppingRef.current  = true;
      try { recRef.current?.abort(); } catch {}
    };
  }, []);

  const getSR = () => window.SpeechRecognition || window.webkitSpeechRecognition;

  // buildRecognition does NOT clear committedRef — that only happens in start().
  // This lets auto-restarts inherit the dedup state from the previous session.
  const buildRecognition = () => {
    const SR = getSR();
    if (!SR) return null;

    const rec = new SR();
    rec.lang            = VOICE_LANG;
    rec.continuous      = false; // fresh session per sentence — no Chrome replay bug
    rec.interimResults  = true;
    rec.maxAlternatives = 1;

    rec.onresult = (ev: SpeechRecognitionEvent) => {
      let fin = '', intr = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) {
          const raw   = r[0].transcript.trim();
          // Step 1: convert Devanagari → Roman (no-op when Chrome already returns Roman)
          // Step 2: fix systematic hi-IN phonetic errors on guaranteed-Roman text
          const roman = devanagariToRoman(raw);
          const t     = fixTranscript(roman);
          if (t && !committedRef.current.has(raw)) {
            committedRef.current.add(raw); // dedup keyed on raw — before any fixes
            fin += t + ' ';
          }
        } else {
          intr += r[0].transcript;
        }
      }
      // Keep interim live; clear only when final arrives so there's no blank gap
      if (fin) setInterimText('');
      else if (intr) setInterimText(fixTranscript(devanagariToRoman(intr)));
      if (fin.trim()) onFinalRef.current(fin.trim());
    };

    rec.onerror = (e: { error: string }) => {
      switch (e.error) {
        case 'no-speech':
        case 'aborted':
          break; // non-fatal — onend will auto-restart
        case 'not-allowed':
        case 'audio-capture':
          fatalErrorRef.current = true;
          listeningRef.current  = false;
          stoppingRef.current   = true;
          setListening(false);
          setVoiceError(
            e.error === 'not-allowed'
              ? 'Microphone permission denied. Allow mic access in browser settings.'
              : 'Microphone not available. Check your audio device.',
          );
          try { rec.abort(); } catch {}
          break;
        case 'network':
          fatalErrorRef.current = true;
          listeningRef.current  = false;
          stoppingRef.current   = true;
          setListening(false);
          setVoiceError('Voice recognition network error. Check your internet connection.');
          try { rec.abort(); } catch {}
          break;
        default:
          console.warn('[Voice] error:', e.error);
      }
    };

    rec.onend = () => {
      if (fatalErrorRef.current) {
        fatalErrorRef.current = false;
        setInterimText('');
        listeningRef.current = false;
        setListening(false);
        stoppingRef.current  = false;
        return;
      }
      // Auto-restart if the user hasn't clicked stop — keeps listening continuously
      // without the Chrome continuous-mode replay bug.
      if (listeningRef.current && !stoppingRef.current) {
        recRef.current = buildRecognition();
        try { recRef.current?.start(); } catch {
          listeningRef.current = false;
          setListening(false);
          setInterimText('');
        }
        return;
      }
      setInterimText('');
      listeningRef.current = false;
      setListening(false);
      stoppingRef.current  = false;
    };

    return rec;
  };

  const start = () => {
    if (!getSR() || listeningRef.current) return;
    setVoiceError('');
    fatalErrorRef.current = false;
    stoppingRef.current   = false;
    listeningRef.current  = true;
    setListening(true);
    setInterimText('');
    committedRef.current.clear(); // fresh dedup set for this recording session
    recRef.current = buildRecognition();
    try { recRef.current?.start(); }
    catch { listeningRef.current = false; setListening(false); }
  };

  const stop = () => {
    stoppingRef.current  = true;
    listeningRef.current = false;
    try { recRef.current?.abort(); } catch {}
  };

  const toggle = () => {
    if (listeningRef.current) stop(); else start();
  };

  return { listening, interimText, hasVoice, voiceError, start, stop, toggle };
}

// ── Main Diary page ───────────────────────────────────────────────────────────
export default function Diary() {
  const [entries,      setEntries]      = useState<DiaryEntry[]>([]);
  const [content,      setContent]      = useState('');
  const [submitting,   setSubmitting]   = useState(false);
  const [error,        setError]        = useState('');
  const [loading,      setLoading]      = useState(true);
  const [staff,        setStaff]        = useState<Staff[]>([]);
  const [tasks,        setTasks]        = useState<Task[]>([]);
  // Admin filters
  const [staffFilter,  setStaffFilter]  = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const { isAdmin } = useAuth();

  // Append voice text to existing content.
  // By the time text reaches here it is already Roman + fixTranscript-corrected
  // (devanagariToRoman + fixTranscript are applied in the onresult handler above).
  const handleVoiceText = (text: string) => {
    setContent(prev => prev.trim() ? prev.trimEnd() + ' ' + text : text);
  };

  const voice = useVoice(handleVoiceText);

  // Initial load
  useEffect(() => {
    const fetches: Promise<unknown>[] = [
      diaryAPI.list()
        .then(d => setEntries(d))
        .catch(() => {}),
      tasksAPI.list({ completed: false })
        .then((ts: Task[]) => setTasks(ts))
        .catch(() => {}),
      // Also fetch completed tasks so we can show them as done in diary cards
      tasksAPI.list({ completed: true })
        .then((ts: Task[]) => setTasks(prev => {
          const ids = new Set(prev.map(t => t.id));
          return [...prev, ...ts.filter(t => !ids.has(t.id))];
        }))
        .catch(() => {}),
    ];
    if (isAdmin) {
      fetches.push(staffAPI.list().then(s => setStaff(s)).catch(() => {}));
    }
    Promise.all(fetches).finally(() => setLoading(false));
  }, [isAdmin]);

  // Real-time updates via SSE (replaces 4-second polling)
  useSSE({
    'diary:updated': (entry) => {
      setEntries(prev => {
        const idx = prev.findIndex(e => e.id === (entry as DiaryEntry).id);
        if (idx === -1) return [entry as DiaryEntry, ...prev];
        const next = [...prev];
        next[idx] = { ...prev[idx], ...(entry as DiaryEntry) };
        return next;
      });
    },
    'diary:deleted': (payload) => {
      setEntries(prev => prev.filter(e => e.id !== (payload as { id: string }).id));
    },
    'task:updated': (task) => {
      setTasks(prev => {
        const idx = prev.findIndex(t => t.id === (task as Task).id);
        if (idx === -1) return [...prev, task as Task];
        const next = [...prev];
        next[idx] = { ...prev[idx], ...(task as Task) };
        return next;
      });
    },
    'task:created': (task) => {
      setTasks(prev => {
        if (prev.some(t => t.id === (task as Task).id)) return prev;
        return [...prev, task as Task];
      });
    },
  });

  // Mark a task complete locally (called from DiaryCard)
  const handleTaskCompleted = (taskId: string) => {
    setTasks(prev => prev.map(t =>
      t.id === taskId
        ? { ...t, completed: true, completedAt: new Date().toISOString() }
        : t,
    ));
  };

  const handleSubmit = async () => {
    const text = content.trim();
    if (!text) { setError('Write or speak something first'); return; }
    if (voice.listening) voice.stop();
    setError('');
    setSubmitting(true);
    try {
      const entry = await diaryAPI.create(text);
      setEntries(prev => [entry, ...prev]);
      setContent('');
    } catch {
      setError('Failed to save entry. Try again.');
    } finally { setSubmitting(false); }
  };

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;

  // Admin filter: apply staff + status filters client-side
  const filteredEntries = entries.filter(e => {
    if (isAdmin && staffFilter !== 'all' && e.staffId !== staffFilter) return false;
    if (statusFilter !== 'all' && e.status !== statusFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Diary</h1>
          <p className="text-white/30 text-sm mt-1">
            Hindi, English, ya Hinglish — kuch bhi likho ya bolo. Kamal AI customers automatically detect aur add karega.
          </p>
        </div>

        {/* Admin-only filters */}
        {isAdmin && (
          <div className="flex items-center gap-2 flex-wrap">
            <Filter size={13} className="text-white/30 flex-shrink-0" />
            {/* Staff filter */}
            <div className="relative">
              <Users size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
              <select
                value={staffFilter}
                onChange={e => setStaffFilter(e.target.value)}
                className="input pl-7 py-1.5 text-xs h-8 pr-8 min-w-[140px]"
              >
                <option value="all">All Staff</option>
                {staff.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            {/* Status filter */}
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="input py-1.5 text-xs h-8 min-w-[120px]"
            >
              <option value="all">All Entries</option>
              <option value="done">Saved ✓</option>
              <option value="processing">Processing…</option>
              <option value="error">Errors</option>
            </select>
          </div>
        )}
      </div>

      {/* ── Composer ─────────────────────────────────────────────────────── */}
      <div className="card border-gold/15 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-gold" />
          <span className="text-white/50 text-sm font-medium">Today's Entry</span>
          <span className="text-white/20 text-xs ml-auto">{wordCount} words</span>
        </div>

        <textarea
          className="w-full bg-dark-200 border border-dark-50 text-white placeholder-white/20 rounded-xl px-4 py-3 text-sm leading-relaxed resize-none focus:outline-none focus:border-gold/40 transition-colors min-h-[140px]"
          placeholder={
            `Aaj Rahul Sharma se baat ki, wo interested lag raha tha proposal mein...\n\n` +
            `Tip: Customer ka naam mention karo — Kamal AI automatically detect aur link karega.`
          }
          value={content}
          onChange={e => setContent(e.target.value)}
        />

        {/* Live interim transcript */}
        {voice.listening && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-red-500/5 border border-red-500/20 rounded-xl">
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
              // Show raw interim — no transliteration here.
              // Chrome's interim for Hindi is Devanagari (readable), for Hinglish
              // it's mostly Roman already. Applying devanagariToRoman() to unstable
              // interim was the main source of the "glitchy preview" issue.
              <span className="text-white/35 text-xs italic truncate min-w-0">
                {voice.interimText.slice(-80)}
              </span>
            )}
          </div>
        )}

        {voice.voiceError && (
          <p className="flex items-center gap-2 text-amber-400 text-sm">
            <AlertCircle size={14} />{voice.voiceError}
          </p>
        )}

        {error && (
          <p className="flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle size={14} />{error}
          </p>
        )}

        <div className="flex items-center gap-2 flex-wrap">
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
            onClick={handleSubmit}
            disabled={!content.trim() || submitting}
            className="btn-primary flex items-center gap-2 ml-auto"
          >
            {submitting
              ? <><div className="w-4 h-4 border-2 border-dark-500/30 border-t-dark-500 rounded-full animate-spin" />Saving…</>
              : <><Send size={14} />Save & Analyse</>}
          </button>
        </div>

        {!voice.hasVoice && (
          <p className="text-white/15 text-xs">Voice input not available in this browser (use Chrome for best results)</p>
        )}
      </div>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { n: '1', title: 'Bolo ya likho',     desc: 'Hindi, Hinglish, English — mic button se bolein ya type karein' },
          { n: '2', title: 'AI analyse karta',  desc: 'Kamal customer names dhundta hai — typos aur Hinglish spellings bhi samajh leta hai' },
          { n: '3', title: 'Auto link + create', desc: 'Match mile to link hota hai, na mile to naya customer khud bana deta hai' },
        ].map(({ n, title, desc }) => (
          <div key={n} className="bg-dark-300 border border-dark-50 rounded-xl p-4 flex gap-3">
            <div className="w-6 h-6 rounded-full bg-gold/15 border border-gold/25 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-gold text-[10px] font-bold">{n}</span>
            </div>
            <div>
              <p className="text-white text-sm font-medium">{title}</p>
              <p className="text-white/25 text-xs mt-0.5">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Entry history ─────────────────────────────────────────────────── */}
      {!loading && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-white font-semibold">
              Entry History
              {filteredEntries.length > 0 && (
                <span className="text-white/25 font-normal text-sm ml-2">
                  ({filteredEntries.length}{filteredEntries.length !== entries.length ? ` of ${entries.length}` : ''})
                </span>
              )}
            </h2>
            {/* Clear filters badge */}
            {isAdmin && (staffFilter !== 'all' || statusFilter !== 'all') && (
              <button
                onClick={() => { setStaffFilter('all'); setStatusFilter('all'); }}
                className="text-xs text-gold/60 hover:text-gold transition-colors"
              >
                Clear filters ✕
              </button>
            )}
          </div>
          {filteredEntries.length === 0 ? (
            <div className="card text-center py-12">
              <p className="text-white/25 text-sm">
                {staffFilter !== 'all' || statusFilter !== 'all'
                  ? 'No entries match the selected filters.'
                  : 'Koi entry nahi abhi. Upar likhen ya bolein.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredEntries.map(e => (
                <DiaryCard
                  key={e.id}
                  entry={e}
                  showAuthor={isAdmin && staffFilter === 'all'}
                  onDelete={id => setEntries(prev => prev.filter(x => x.id !== id))}
                  onReanalyzed={updated => setEntries(prev => prev.map(x => x.id === updated.id ? { ...x, ...updated } : x))}
                  entryTasks={tasks.filter(t => t.diaryEntryId === e.id)}
                  onTaskCompleted={handleTaskCompleted}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
