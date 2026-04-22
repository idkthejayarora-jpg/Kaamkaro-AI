import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, MicOff, Send, X, Volume2, VolumeX, Sparkles, CheckCircle, Zap, AlertCircle } from 'lucide-react';
import { aiAPI } from '../lib/api';
import type { KamalMessage } from '../types';

// ── Web Speech API types ──────────────────────────────────────────────────────
interface SRResult { isFinal: boolean; [i: number]: { transcript: string } }
interface SREvent  { resultIndex: number; results: SRResult[] }
interface ISR extends EventTarget {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onstart:  (() => void) | null;
  onend:    (() => void) | null;
  onerror:  ((e: { error: string }) => void) | null;
  onresult: ((e: SREvent) => void) | null;
}
declare global {
  interface Window {
    SpeechRecognition:       new () => ISR;
    webkitSpeechRecognition: new () => ISR;
  }
}

const QUICK_PROMPTS = [
  { label: '📊 Status',     msg: 'What needs my attention right now?' },
  { label: '📞 Overdue',    msg: 'Which customers are overdue for contact?' },
  { label: '✅ Tasks',      msg: 'What tasks are due today?' },
  { label: '🏆 Leaderboard', msg: 'Go to leaderboard' },
  { label: '📋 Follow-ups', msg: 'Go to follow-up queue' },
];

function ActionBadge({ action }: { action: KamalMessage['actionResult'] }) {
  if (!action) return null;
  const cfg: Record<string, { color: string; bg: string; text: string; icon: typeof CheckCircle }> = {
    interaction_logged: { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/10', text: `✓ Logged call with ${action.customer}` },
    task_created:       { icon: CheckCircle, color: 'text-blue-400',  bg: 'bg-blue-500/10',  text: `✓ Task created: ${action.title}` },
    stage_updated:      { icon: Zap,         color: 'text-gold',      bg: 'bg-gold/10',      text: `✓ ${action.customer} → ${action.stage}` },
  };
  const c = cfg[action.type];
  if (!c) return null;
  const Icon = c.icon;
  return (
    <div className={`flex items-center gap-2 mt-1.5 px-2.5 py-1.5 rounded-lg ${c.bg} border border-current/10`}>
      <Icon size={11} className={c.color} />
      <span className={`text-[10px] font-medium ${c.color}`}>{c.text}</span>
    </div>
  );
}

// ── Robust voice hook for Kamal (command mode: commits on first final) ────────
// Production: handles all SpeechRecognition error types; never restarts on
// fatal errors (not-allowed, audio-capture); cleans up with abort() not stop().
function useVoiceCommand(onResult: (text: string) => void) {
  const [listening,   setListening]   = useState(false);
  const [interim,     setInterim]     = useState('');
  const [hasVoice,    setHasVoice]    = useState(false);
  const [voiceError,  setVoiceError]  = useState('');
  const recRef          = useRef<ISR | null>(null);
  const listeningRef    = useRef(false);
  const stoppingRef     = useRef(false);
  const fatalErrorRef   = useRef(false);
  const processedIdxRef = useRef(-1);
  const onResultRef     = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  useEffect(() => {
    setHasVoice(!!(window.SpeechRecognition || window.webkitSpeechRecognition));
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

  const build = useCallback((): ISR | null => {
    const SR = getSR();
    if (!SR) return null;
    processedIdxRef.current = -1;

    const rec = new SR();
    // en-IN handles Hinglish better than hi-IN for command-style short phrases
    // (Chrome code-switches to Hindi words within English grammar)
    rec.lang            = 'en-IN';
    rec.continuous      = false;
    rec.interimResults  = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e: SREvent) => {
      let fin = '', intr = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (i <= processedIdxRef.current) continue;
        if (e.results[i].isFinal) {
          fin += e.results[i][0].transcript + ' ';
          processedIdxRef.current = i;
        } else {
          intr += e.results[i][0].transcript;
        }
      }
      setInterim(intr);
      if (fin.trim()) {
        setInterim('');
        // Commit immediately and stop — command mode, one utterance at a time
        stoppingRef.current  = true;
        listeningRef.current = false;
        onResultRef.current(fin.trim());
        try { rec.abort(); } catch {}
      }
    };

    rec.onerror = (e: { error: string }) => {
      switch (e.error) {
        case 'no-speech':
        case 'aborted':
          break; // expected — ignore
        case 'not-allowed':
        case 'audio-capture':
          fatalErrorRef.current = true;
          listeningRef.current  = false;
          stoppingRef.current   = true;
          setListening(false);
          setVoiceError(
            e.error === 'not-allowed'
              ? 'Mic permission denied'
              : 'Mic not available',
          );
          try { rec.abort(); } catch {}
          break;
        case 'network':
          fatalErrorRef.current = true;
          listeningRef.current  = false;
          stoppingRef.current   = true;
          setListening(false);
          setVoiceError('Voice network error — check connection');
          try { rec.abort(); } catch {}
          break;
        default:
          console.warn('[Kamal voice]', e.error);
      }
    };

    rec.onend = () => {
      setInterim('');
      if (fatalErrorRef.current) {
        fatalErrorRef.current = false;
        return;
      }
      if (listeningRef.current && !stoppingRef.current) {
        // Unexpected stop — restart after brief pause
        setTimeout(() => {
          if (!listeningRef.current || stoppingRef.current) return;
          try { recRef.current = build(); recRef.current?.start(); } catch {}
        }, 150);
        return;
      }
      listeningRef.current = false;
      setListening(false);
      stoppingRef.current = false;
    };

    return rec;
  }, []);

  const start = useCallback(() => {
    if (!getSR() || listeningRef.current) return;
    setVoiceError('');
    fatalErrorRef.current = false;
    listeningRef.current = true;
    stoppingRef.current  = false;
    setListening(true);
    setInterim('');
    recRef.current = build();
    try { recRef.current?.start(); }
    catch { listeningRef.current = false; setListening(false); }
  }, [build]);

  const stop = useCallback(() => {
    stoppingRef.current  = true;
    listeningRef.current = false;
    try { recRef.current?.abort(); } catch {}
  }, []);

  const toggle = () => { if (listeningRef.current) stop(); else start(); };

  return { listening, interim, hasVoice, voiceError, toggle, stop };
}

// ── Main component ────────────────────────────────────────────────────────────
export default function KamalAssistant() {
  const [open,     setOpen]     = useState(false);
  const [messages, setMessages] = useState<KamalMessage[]>([{
    role: 'assistant',
    content: "Hi! I'm Kamal — your AI agent. I can log customer interactions, create tasks, move pipeline stages, navigate the app, and give you live team stats. What do you need?",
    timestamp: new Date(),
  }]);
  const [input,     setInput]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [ttsOn,     setTtsOn]     = useState(false); // TTS off by default
  const [hasTts,    setHasTts]    = useState(false);

  const navigate  = useNavigate();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  const sendMessage = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || loading) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: t, timestamp: new Date() }]);
    setLoading(true);
    try {
      const history = messages.slice(-12).map(m => ({ role: m.role, content: m.content }));
      const res = await aiAPI.chat(t, history);
      const msg: KamalMessage = {
        role: 'assistant', content: res.response, timestamp: new Date(),
        actionResult: res.action ?? null,
      };
      setMessages(prev => [...prev, msg]);
      if (ttsOn && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(res.response.slice(0, 200));
        u.lang = 'en-IN'; u.rate = 1.05;
        const v = window.speechSynthesis.getVoices();
        const preferred = v.find(x => x.lang.startsWith('en') && x.name.includes('Google')) || v.find(x => x.lang.startsWith('en'));
        if (preferred) u.voice = preferred;
        window.speechSynthesis.speak(u);
      }
      if (res.navigate) setTimeout(() => navigate(res.navigate), 600);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: "Network error — please try again.", timestamp: new Date() }]);
    } finally { setLoading(false); }
  }, [loading, messages, navigate, ttsOn]);

  const voice = useVoiceCommand(sendMessage);

  useEffect(() => {
    setHasTts('speechSynthesis' in window);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120);
    else if (voice.listening) voice.stop();
  }, [open]);

  return (
    <>
      {/* Floating button — bottom-20 on mobile to clear iOS home bar + browser nav */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`fixed bottom-20 sm:bottom-6 right-4 sm:right-6 z-50 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 ${
          open ? 'bg-dark-200 border-2 border-gold/50 rotate-0' : 'bg-gold hover:scale-105 animate-pulse-gold'
        }`}
        title="Kamal AI Agent"
      >
        {open ? <X size={20} className="text-gold" /> : <Sparkles size={22} className="text-dark-500" />}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-36 sm:bottom-24 right-3 sm:right-6 z-50 w-[calc(100vw-24px)] sm:w-[340px] md:w-[390px] bg-dark-300 border border-dark-50 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-slide-up" style={{ maxHeight: '75vh', minHeight: '400px' }}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-dark-50 bg-dark-400 flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-gold/20 border border-gold/40 flex items-center justify-center">
                <Sparkles size={14} className="text-gold" />
              </div>
              <div>
                <p className="text-white text-sm font-semibold">Kamal AI Agent</p>
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  <p className="text-white/30 text-[10px]">Live data · Can take actions</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {hasTts && (
                <button onClick={() => setTtsOn(v => !v)} title="Toggle voice response"
                  className={`p-1.5 rounded-lg transition-colors ${ttsOn ? 'text-gold' : 'text-white/30 hover:text-white'}`}>
                  {ttsOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-dark-200 text-white/40 hover:text-white transition-colors">
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="w-6 h-6 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center flex-shrink-0 mr-2 mt-0.5">
                    <Sparkles size={10} className="text-gold" />
                  </div>
                )}
                <div className="max-w-[82%]">
                  <div className={`rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-gold text-dark-500 font-medium rounded-br-sm'
                      : 'bg-dark-200 text-white/85 rounded-bl-sm border border-dark-50'
                  }`}>
                    {msg.content}
                  </div>
                  {msg.actionResult && <ActionBadge action={msg.actionResult} />}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="w-6 h-6 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center mr-2 flex-shrink-0">
                  <Sparkles size={10} className="text-gold" />
                </div>
                <div className="bg-dark-200 border border-dark-50 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1">
                  {[0,1,2].map(i => <div key={i} className="w-1.5 h-1.5 bg-gold/60 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
                </div>
              </div>
            )}

            {voice.listening && (
              <div className="flex justify-center">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-full">
                  <div className="flex items-end gap-0.5">
                    {[3,5,7,5,3].map((h,i) => (
                      <div key={i} className="w-0.5 bg-red-400 rounded-full animate-bounce" style={{ height: `${h}px`, animationDelay: `${i*80}ms` }} />
                    ))}
                  </div>
                  <span className="text-red-400 text-xs">{voice.interim || 'Listening…'}</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Quick prompts */}
          <div className="px-3 pb-2 flex gap-1.5 overflow-x-auto flex-shrink-0 scrollbar-none">
            {QUICK_PROMPTS.map(({ label, msg }) => (
              <button key={label} onClick={() => sendMessage(msg)} disabled={loading}
                className="flex-shrink-0 text-[10px] px-2.5 py-1 rounded-full border border-gold/20 text-gold/60 hover:border-gold/50 hover:text-gold transition-colors disabled:opacity-40 whitespace-nowrap">
                {label}
              </button>
            ))}
          </div>

          {/* Input bar */}
          <div className="p-3 border-t border-dark-50 flex items-center gap-2 flex-shrink-0">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
              placeholder={voice.listening ? 'Listening…' : 'Ask or command Kamal…'}
              disabled={loading}
              className="flex-1 bg-dark-200 border border-dark-50 text-white placeholder-white/25 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gold/40 transition-colors disabled:opacity-60"
            />
            <button
              onClick={voice.toggle}
              title="Voice input (Hindi/English)"
              className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all border ${
                voice.listening
                  ? 'bg-red-500 border-red-500 text-white'
                  : 'bg-dark-200 border-dark-50 text-white/40 hover:text-white hover:border-gold/40'
              }`}
            >
              {voice.listening ? <MicOff size={14} /> : <Mic size={14} />}
            </button>
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              className="w-9 h-9 rounded-xl bg-gold hover:bg-gold-400 disabled:opacity-30 flex items-center justify-center flex-shrink-0 transition-all"
            >
              <Send size={14} className="text-dark-500" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
