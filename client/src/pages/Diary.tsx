import { useEffect, useState, useRef } from 'react';
import { useSSE } from '../hooks/useSSE';
import {
  Mic, MicOff, Send, Sparkles, ChevronDown, ChevronUp,
  AlertCircle, Clock, UserPlus, Globe, Trash2, RefreshCw, Languages,
} from 'lucide-react';
import { diaryAPI } from '../lib/api';
import type { DiaryEntry } from '../types';

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
  'क':'k','ख':'kh','ग':'g','घ':'gh','ङ':'ng',
  'च':'ch','छ':'chh','ज':'j','झ':'jh','ञ':'ny',
  'ट':'t','ठ':'th','ड':'d','ढ':'dh','ण':'n',
  'त':'t','थ':'th','द':'d','ध':'dh','न':'n',
  'प':'p','फ':'f','ब':'b','भ':'bh','म':'m',
  'य':'y','र':'r','ल':'l','व':'v','श':'sh',
  'ष':'sh','स':'s','ह':'h','ळ':'l',
};
const _MATR: Record<string, string> = {
  '\u093E':'aa','\u093F':'i','\u0940':'ee',
  '\u0941':'u', '\u0942':'oo','\u0943':'ri',
  '\u0947':'e', '\u0948':'ai','\u094B':'o',
  '\u094C':'au','\u0902':'n', '\u0903':'h',
  '\u0901':'n',
};
const _IVOW: Record<string, string> = {
  'अ':'a','आ':'aa','इ':'i','ई':'ee','उ':'u','ऊ':'oo',
  'ऋ':'ri','ए':'e','ऐ':'ai','ओ':'o','औ':'au',
};
const _VIR = '\u094D'; // VIRAMA / halant

function devanagariToRoman(text: string): string {
  if (!text || !/[\u0900-\u097F]/.test(text)) return text;
  let out = '';
  let pA  = false; // pendingA — inherent vowel after a consonant

  for (const ch of text) {
    const deva = /[\u0900-\u097F]/.test(ch);

    if (!deva) {
      // Non-Devanagari (space / Latin / punctuation) — flush & pass through
      if (pA) { out += 'a'; pA = false; }
      out += ch;
      continue;
    }
    if (ch === _VIR)          { pA = false; continue; }          // halant → suppress
    if (_MATR[ch] !== undefined){ pA = false; out += _MATR[ch]; continue; } // matra
    if (_IVOW[ch] !== undefined){ if (pA) { out += 'a'; pA = false; } out += _IVOW[ch]; continue; }
    if (_CONS[ch] !== undefined){ if (pA) { out += 'a'; pA = false; } out += _CONS[ch]; pA = true; continue; }
    // Unknown Devanagari — flush & skip
    if (pA) { out += 'a'; pA = false; }
  }
  // Suppress trailing inherent 'a' (Hindi word-final consonants are silent)
  return out;
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
function DiaryCard({ entry, onDelete, onReanalyzed }: {
  entry: DiaryEntry;
  onDelete: (id: string) => void;
  onReanalyzed: (updated: DiaryEntry) => void;
}) {
  const [expanded,      setExpanded]      = useState(entry.status === 'done' && entry.aiEntries.length > 0);
  const [showOrig,      setShowOrig]      = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [deleteError,   setDeleteError]   = useState('');
  const [reanalyzing,   setReanalyzing]   = useState(false);

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
          {entry.status === 'done' && entry.aiEntries.length > 0 && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="p-1.5 text-white/30 hover:text-gold transition-colors rounded-lg"
            >
              {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
          )}
          {/* Re-analyze — always available so staff can fix bad extractions */}
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
        </div>
      </div>

      {/* ── AI-extracted entries ── */}
      {expanded && entry.aiEntries.length > 0 && (
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

// ── Voice hook ────────────────────────────────────────────────────────────────
// Fixed: each isFinal committed once immediately. processedIdxRef prevents
// Chrome's duplicate onresult events from causing repeated words.
// Production: handles all SpeechRecognition error types; never restarts on
// fatal errors (not-allowed, audio-capture); cleans up with abort() not stop().
function useVoice(onFinalText: (text: string) => void) {
  const [listening,   setListening]   = useState(false);
  const [interimText, setInterimText] = useState('');
  const [hasVoice,    setHasVoice]    = useState(false);
  const [voiceError,  setVoiceError]  = useState('');

  const recRef          = useRef<ISpeechRecognition | null>(null);
  const listeningRef    = useRef(false);
  const stoppingRef     = useRef(false);
  const fatalErrorRef   = useRef(false); // set on errors where restart would be pointless
  const onFinalRef      = useRef(onFinalText);
  const processedIdxRef = useRef(-1);

  useEffect(() => { onFinalRef.current = onFinalText; }, [onFinalText]);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setHasVoice(!!SR);
  }, []);

  // Cleanup on unmount — always abort to free mic
  useEffect(() => {
    return () => {
      listeningRef.current = false;
      stoppingRef.current  = true;
      try { recRef.current?.abort(); } catch {}
    };
  }, []);

  const getSR = () => window.SpeechRecognition || window.webkitSpeechRecognition;

  const buildRecognition = () => {
    const SR = getSR();
    if (!SR) return null;
    processedIdxRef.current = -1;

    const rec = new SR();
    rec.lang            = VOICE_LANG;  // hi-IN handles Hindi + English + Hinglish
    rec.continuous      = false;
    rec.interimResults  = true;
    rec.maxAlternatives = 1;

    rec.onresult = (ev: SpeechRecognitionEvent) => {
      let fin = '', intr = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        // Skip any index we already committed (Chrome occasionally re-fires old finals)
        if (i <= processedIdxRef.current) continue;
        const r = ev.results[i];
        if (r.isFinal) {
          fin += r[0].transcript + ' ';
          processedIdxRef.current = i; // mark committed
        } else {
          intr += r[0].transcript;
        }
      }
      setInterimText(intr);
      // Commit immediately — no accumRef needed, avoids all duplication
      if (fin.trim()) onFinalRef.current(fin.trim());
    };

    rec.onerror = (e: { error: string }) => {
      switch (e.error) {
        case 'no-speech':
          // Silence — ignore, let onend restart as normal
          break;
        case 'aborted':
          // We triggered this — ignore
          break;
        case 'not-allowed':
        case 'audio-capture':
          // Fatal: mic denied or unavailable — stop and tell the user
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
          // Network error with speech API — stop and tell user
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
      setInterimText('');
      if (fatalErrorRef.current) {
        // Fatal error already handled in onerror — do not restart
        fatalErrorRef.current = false;
        return;
      }
      if (listeningRef.current && !stoppingRef.current) {
        // Unexpected stop — wait 200 ms to clear audio buffer, then restart
        setTimeout(() => {
          if (!listeningRef.current || stoppingRef.current) return;
          try {
            recRef.current = buildRecognition();
            recRef.current?.start();
          } catch { /* ignore DOMException if already running */ }
        }, 200);
        return;
      }
      listeningRef.current = false;
      setListening(false);
      stoppingRef.current = false;
    };

    return rec;
  };

  const start = () => {
    if (!getSR() || listeningRef.current) return;
    setVoiceError('');
    fatalErrorRef.current = false;
    stoppingRef.current  = false;
    listeningRef.current = true;
    setListening(true);
    setInterimText('');
    recRef.current = buildRecognition();
    try { recRef.current?.start(); }
    catch { listeningRef.current = false; setListening(false); }
  };

  const stop = () => {
    stoppingRef.current  = true;
    listeningRef.current = false;
    // abort() immediately releases mic; stop() waits for final result (can hang)
    try { recRef.current?.abort(); } catch {}
  };

  const toggle = () => {
    if (listeningRef.current) stop(); else start();
  };

  return { listening, interimText, hasVoice, voiceError, start, stop, toggle };
}

// ── Main Diary page ───────────────────────────────────────────────────────────
export default function Diary() {
  const [entries,    setEntries]    = useState<DiaryEntry[]>([]);
  const [content,    setContent]    = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');
  const [loading,    setLoading]    = useState(true);

  // Append voice text to existing content — transliterate Devanagari → Roman first
  const handleVoiceText = (text: string) => {
    const roman = devanagariToRoman(text);
    setContent(prev => prev.trim() ? prev.trimEnd() + ' ' + roman : roman);
  };

  const voice = useVoice(handleVoiceText);

  // Initial load
  useEffect(() => {
    diaryAPI.list()
      .then(d => { setEntries(d); })
      .catch(() => { /* show empty state — not a crash */ })
      .finally(() => setLoading(false));
  }, []);

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

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white">Diary</h1>
        <p className="text-white/30 text-sm mt-1">
          Hindi, English, ya Hinglish — kuch bhi likho ya bolo. Kamal AI customers automatically detect aur add karega.
        </p>
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
            <span className="text-red-400 text-xs font-medium">Recording…</span>
            {voice.interimText && (
              <span className="text-white/40 text-xs italic truncate">
                {devanagariToRoman(voice.interimText)}
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
          <h2 className="text-white font-semibold mb-3">
            Entry History
            {entries.length > 0 && <span className="text-white/25 font-normal text-sm ml-2">({entries.length})</span>}
          </h2>
          {entries.length === 0 ? (
            <div className="card text-center py-12">
              <p className="text-white/25 text-sm">Koi entry nahi abhi. Upar likhen ya bolein.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {entries.map(e => (
                <DiaryCard
                  key={e.id}
                  entry={e}
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
