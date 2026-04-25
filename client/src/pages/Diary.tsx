import { useEffect, useState, useRef } from 'react';
import { useSSE } from '../hooks/useSSE';
import {
  Mic, MicOff, Send, Sparkles, ChevronDown, ChevronUp,
  AlertCircle, Clock, UserPlus, Globe, Trash2, RefreshCw, Languages,
  Filter, Users, Pencil, X, Check,
} from 'lucide-react';
import { diaryAPI, staffAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { DiaryEntry, Staff } from '../types';

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

// hi-IN is used for all recording — Chrome's engine handles Hindi, English and
// Hinglish (mixed) automatically in this locale. No manual selection needed.
const VOICE_LANG = 'hi-IN';

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
function DiaryCard({ entry, onDelete, onReanalyzed, showAuthor }: {
  entry: DiaryEntry;
  onDelete: (id: string) => void;
  onReanalyzed: (updated: DiaryEntry) => void;
  showAuthor?: boolean;
}) {
  const [expanded,      setExpanded]      = useState(entry.status === 'done' && entry.aiEntries.length > 0);
  const [showOrig,      setShowOrig]      = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [deleteError,   setDeleteError]   = useState('');
  const [reanalyzing,   setReanalyzing]   = useState(false);
  const [editing,       setEditing]       = useState(false);
  const [editContent,   setEditContent]   = useState(entry.content);
  const [editEntries,   setEditEntries]   = useState(entry.aiEntries);
  const [saving,        setSaving]        = useState(false);

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
          {entry.status === 'done' && entry.aiEntries.length > 0 && !editing && (
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
    </div>
  );
}

// ── Hinglish phonetic correction ─────────────────────────────────────────────
// Chrome's hi-IN model often mangles English words spoken in a Hindi sentence.
// These replacements fix the most common patterns without changing real words.
// Chrome hi-IN consistently expands short Hindi words and phonetically misspells
// English ones. Every pattern here is reproducible — not guesswork.
const HINGLISH_FIXES: [RegExp, string][] = [

  // ── Multi-word phrases — apply first ─────────────────────────────────────
  [/\bveediyo\s+kol\b/gi,          'video call'],
  [/\bvidiyo\s+kol\b/gi,           'video call'],
  [/\bveedeo\s+kol\b/gi,           'video call'],
  [/\bvideo\s+kol\b/gi,            'video call'],
  [/\bvideo\s+kawl\b/gi,           'video call'],
  [/\bwhats\s+app\b/gi,            'WhatsApp'],
  [/\bwhat\s+sap\b/gi,             'WhatsApp'],
  [/\bbat\s+huee\b/gi,             'baat hui'],
  [/\bbaat\s+huee\b/gi,            'baat hui'],

  // maal (goods/stock) — Chrome hears "man" / "mall" / "mal"
  [/\bka\s+man\s+liya\b/gi,        'ka maal liya'],
  [/\bka\s+mal\s+liya\b/gi,        'ka maal liya'],
  [/\bka\s+mall\s+liya\b/gi,       'ka maal liya'],
  [/\bman\s+bheja\b/gi,            'maal bheja'],
  [/\bman\s+aaya\b/gi,             'maal aaya'],
  [/\bman\s+diya\b/gi,             'maal diya'],
  [/\bman\s+gaya\b/gi,             'maal gaya'],
  [/\bman\s+mila\b/gi,             'maal mila'],
  [/\bman\s+manga\b/gi,            'maal manga'],
  [/\bman\s+nahi\b/gi,             'maal nahi'],
  [/\bman\s+ready\b/gi,            'maal ready'],
  [/\bman\s+deliver\b/gi,          'maal deliver'],
  [/\bman\s+nikalna\b/gi,          'maal nikalna'],
  [/\bman\s+nikalana\b/gi,         'maal nikalna'],

  // paise
  [/\bpi\s+se\b/gi,                'paise'],
  [/\bpai\s+se\b/gi,               'paise'],
  [/\bpay\s+se\b/gi,               'paise'],

  // ── Chrome pronoun expansions — VERY consistent pattern ──────────────────
  // Chrome hi-IN always expands short pronouns to their full form
  [/\busaka\b/gi,                  'uska'],
  [/\busakee\b/gi,                 'uski'],
  [/\busaki\b/gi,                  'uski'],
  [/\bunaka\b/gi,                  'unka'],
  [/\bunakee\b/gi,                 'unki'],
  [/\bunaki\b/gi,                  'unki'],
  [/\bisaka\b/gi,                  'iska'],
  [/\bisakee\b/gi,                 'iski'],
  [/\bisaki\b/gi,                  'iski'],
  [/\bapaka\b/gi,                  'apka'],
  [/\bapakee\b/gi,                 'apki'],
  [/\bapaki\b/gi,                  'apki'],
  [/\bmujhaka\b/gi,                'mujhko'],
  [/\btumhaka\b/gi,                'tumhara'],
  [/\bhamara\b/gi,                 'hamara'],   // usually fine
  [/\bhumaka\b/gi,                 'humka'],

  // ── Chrome verb/tense expansions ─────────────────────────────────────────
  // "hui" (happened, f.) → "huee"; "nikalana" → "nikalna" etc.
  [/\bhuee\b/gi,                   'hui'],
  [/\bnikalana\b/gi,               'nikalna'],
  [/\bnikalane\b/gi,               'nikalne'],
  [/\bbhejana\b/gi,                'bhejna'],
  [/\bkhelana\b/gi,                'khelna'],
  [/\bbolana\b/gi,                 'bolna'],
  [/\bbanana\b(?!\s+republic|\s+split|\s+bread)/gi, 'banana'], // keep food "banana"
  [/\bchalna\b/gi,                 'chalna'],   // usually correct
  [/\bdena\b/gi,                   'dena'],     // usually correct
  [/\blena\b/gi,                   'lena'],     // usually correct

  // ── Date / time words ─────────────────────────────────────────────────────
  [/\bparason\b/gi,                'parson'],   // day after tomorrow
  [/\bparsoon\b/gi,                'parson'],
  [/\bparasos\b/gi,                'parson'],
  [/\bparsons\b(?!\s+(?:nose|problem))/gi, 'parson'], // not English "parsons"

  // ── City / place names ────────────────────────────────────────────────────
  [/\bnoeda\b/gi,                  'Noida'],
  [/\bnoyda\b/gi,                  'Noida'],
  [/\bnoda\b(?!l)/gi,              'Noida'],
  [/\bgurgoan\b/gi,                'Gurgaon'],
  [/\bgurgon\b/gi,                 'Gurgaon'],
  [/\bfardabad\b/gi,               'Faridabad'],
  [/\bfaridbad\b/gi,               'Faridabad'],
  [/\bghaziabad\b/gi,              'Ghaziabad'],
  [/\bgaziabad\b/gi,               'Ghaziabad'],
  [/\bhydrabad\b/gi,               'Hyderabad'],
  [/\bhaidrabad\b/gi,              'Hyderabad'],
  [/\bahmadabad\b/gi,              'Ahmedabad'],
  [/\bbangalor\b/gi,               'Bangalore'],

  // ── Business / English terms phonetically spelled in Hindi ────────────────
  [/\bveediyo\b/gi,                'video'],
  [/\bvidiyo\b/gi,                 'video'],
  [/\bveedeo\b/gi,                 'video'],
  [/\bkaranee\b/gi,                'karni'],
  [/\bkarnee\b/gi,                 'karni'],
  [/\bkarani\b(?!\s*mata)/gi,      'karni'],
  [/\bparsal\b/gi,                 'parcel'],
  [/\bparsel\b/gi,                 'parcel'],
  [/\bparcal\b/gi,                 'parcel'],
  [/\bpaymant\b/gi,                'payment'],
  [/\bpaimant\b/gi,                'payment'],
  [/\bdelivari\b/gi,               'delivery'],
  [/\bdelievery\b/gi,              'delivery'],
  [/\brupaiye\b/gi,                'rupaye'],
  [/\brupaee\b/gi,                 'rupaye'],
  [/\bwhatsapp\b/gi,               'WhatsApp'],
  [/\bapointment\b/gi,             'appointment'],
  [/\bapointmant\b/gi,             'appointment'],
  [/\bfollowup\b/gi,               'follow-up'],
  [/\bfollo\s+up\b/gi,             'follow-up'],
  [/\bconfarm\b/gi,                'confirm'],
  [/\bconferm\b/gi,                'confirm'],
  [/\bsampal\b/gi,                 'sample'],
  [/\bsampel\b/gi,                 'sample'],
  [/\badvanse\b/gi,                'advance'],
  [/\badvans\b/gi,                 'advance'],
  [/\binvoic\b/gi,                 'invoice'],
];

function fixTranscript(text: string): string {
  let out = text;
  for (const [pattern, replacement] of HINGLISH_FIXES) {
    out = out.replace(pattern, replacement);
  }
  return out;
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
          const raw = r[0].transcript.trim();
          const t   = fixTranscript(raw);
          if (t && !committedRef.current.has(raw)) {
            committedRef.current.add(raw); // dedup on raw so fixes don't break set membership
            fin += t + ' ';
          }
        } else {
          intr += r[0].transcript;
        }
      }
      // Keep interim live; clear only when final arrives so there's no blank gap
      if (fin) setInterimText('');
      else if (intr) setInterimText(fixTranscript(intr));
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
  // Admin filters
  const [staffFilter,  setStaffFilter]  = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const { isAdmin } = useAuth();

  // Append voice text to existing content — transliterate Devanagari → Roman first
  const handleVoiceText = (text: string) => {
    const roman = devanagariToRoman(text);
    setContent(prev => prev.trim() ? prev.trimEnd() + ' ' + roman : roman);
  };

  const voice = useVoice(handleVoiceText);

  // Initial load
  useEffect(() => {
    const tasks: Promise<unknown>[] = [
      diaryAPI.list()
        .then(d => setEntries(d))
        .catch(() => {}),
    ];
    if (isAdmin) {
      tasks.push(staffAPI.list().then(s => setStaff(s)).catch(() => {}));
    }
    Promise.all(tasks).finally(() => setLoading(false));
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
  });

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
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
