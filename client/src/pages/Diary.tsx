import { useEffect, useState } from 'react';
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
import { useVoice } from '../hooks/useVoice';


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
