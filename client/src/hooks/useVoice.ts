/**
 * Shared voice/STT hook — used by Diary and CRM Lead detail.
 *
 * Extracts: TypeScript interfaces, VOICE_LANG, devanagariToRoman,
 * fixTranscript, and the useVoice React hook.
 */
import { useEffect, useRef, useState } from 'react';

// ── TypeScript declarations for Web Speech API ────────────────────────────────
interface SpeechRecognitionResult {
  isFinal: boolean;
  [index: number]: { transcript: string };
}
interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResult[];
}
export interface ISpeechRecognition extends EventTarget {
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
    SpeechRecognition:       new () => ISpeechRecognition;
    webkitSpeechRecognition: new () => ISpeechRecognition;
  }
}

// en-IN: always returns Roman script, handles English business words correctly,
// still recognises Hindi/Hinglish phonetically. Best for Hinglish staff input.
export const VOICE_LANG = 'en-IN';

// ── Devanagari → Hinglish (Roman) transliterator ─────────────────────────────
const _CONS: Record<string, string> = {
  'क':'k','ख':'kh','ग':'g','घ':'gh','ङ':'ng',
  'च':'ch','छ':'chh','ज':'j','झ':'jh','ञ':'ny',
  'ट':'t','ठ':'th','ड':'d','ढ':'dh','ण':'n',
  'त':'t','थ':'th','द':'d','ध':'dh','न':'n',
  'प':'p','फ':'ph','ब':'b','भ':'bh','म':'m',
  'य':'y','र':'r','ल':'l','ळ':'l','व':'v',
  'श':'sh','ष':'sh','स':'s','ह':'h',
  'ड़':'r','ढ़':'rh','फ़':'f','ज़':'z','क़':'q','ख़':'kh','ग़':'gh',
};
const _MATR: Record<string, string> = {
  '\u093E':'a','\u093F':'i','\u0940':'ee','\u0941':'u','\u0942':'oo',
  '\u0943':'ri','\u0947':'e','\u0948':'ai','\u094B':'o','\u094C':'au',
  '\u0902':'n','\u0903':'h','\u0901':'n',
  '\u0949':'o','\u0945':'e','\u0904':'a',
};
const _IVOW: Record<string, string> = {
  'अ':'a','आ':'aa','इ':'i','ई':'ee','उ':'u','ऊ':'oo',
  'ऋ':'ri','ए':'e','ऐ':'ai','ओ':'o','औ':'au',
  'ऑ':'o','ऎ':'e','ऒ':'o',
};
const _VIR = '\u094D';

export function devanagariToRoman(text: string): string {
  if (!text || !/[\u0900-\u097F]/.test(text)) return text;
  let out = '';
  let pA  = false;

  for (let i = 0; i < text.length; ) {
    const ch   = text[i];
    const deva = /[\u0900-\u097F]/.test(ch);

    if (!deva) {
      if (/\s/.test(ch)) { pA = false; }
      else if (pA) { out += 'a'; pA = false; }
      out += ch; i++; continue;
    }

    if (ch === _VIR) { pA = false; i++; continue; }

    const nxt = text[i + 1];
    if (nxt === '\u093C') {
      const pair = ch + nxt;
      if (_CONS[pair] !== undefined) {
        if (pA) { out += 'a'; pA = false; }
        out += _CONS[pair]; pA = true; i += 2; continue;
      }
    }

    if (_MATR[ch] !== undefined) { pA = false; out += _MATR[ch]; i++; continue; }
    if (_IVOW[ch] !== undefined) {
      if (pA) { out += 'a'; pA = false; }
      out += _IVOW[ch]; i++; continue;
    }
    if (_CONS[ch] !== undefined) {
      if (pA) { out += 'a'; pA = false; }
      out += _CONS[ch]; pA = true; i++; continue;
    }
    if (pA) { out += 'a'; pA = false; }
    i++;
  }

  return out.replace(/\s+/g, ' ').trim();
}

// ── Hinglish phonetic error corrector ────────────────────────────────────────
export function fixTranscript(raw: string): string {
  let t = raw;

  // STAGE 1: Multi-word phrases
  t = t.replace(/\b(?:veediyo|vidiyo|veedeo|video)\s+(?:kol|kawl|cal)\b/gi, 'video call');
  t = t.replace(/\bvideo\s+call\b/gi,          'video call');
  t = t.replace(/\baudio\s+cal\b/gi,           'audio call');
  t = t.replace(/\bphone\s+cal\b/gi,           'phone call');
  t = t.replace(/\bwhats?\s+app\b/gi,          'WhatsApp');
  t = t.replace(/\bwhat\s+sap\b/gi,            'WhatsApp');
  t = t.replace(/\bbaat?\s+huee\b/gi,          'baat hui');
  t = t.replace(/\bfollo\s+up\b/gi,            'follow-up');
  t = t.replace(/\bpa[yi]\s+se\b/gi,           'paise');
  t = t.replace(/\bka\s+ma(?:n|l{1,2})\s+(liya|bheja|diya|gaya|mila|aaya|nahi|ready|deliver|nikala(?:na)?)\b/gi,
    (_m, verb) => `ka maal ${verb.replace('nikalana', 'nikalna')}`);
  t = t.replace(/\bma(?:n|l{1,2})\s+(bheja|aaya|diya|gaya|mila|manga|nahi|ready|deliver|nikala(?:na)?)\b/gi,
    (_m, verb) => `maal ${verb.replace('nikalana', 'nikalna')}`);

  // STAGE 2 (CATEGORY A): Pronoun expansion
  t = t.replace(/\b(us|un|is|in|jin|kin|kis|ap|hab|tum)aka\b/gi,  '$1ka');
  t = t.replace(/\b(us|un|is|in|jin|kin|kis|ap|hab|tum)akee\b/gi, '$1ki');
  t = t.replace(/\b(us|un|is|in|jin|kin|kis|ap|hab|tum)aki\b/gi,  '$1ki');
  t = t.replace(/\bmujhaka\b/gi,   'mujhko');
  t = t.replace(/\bhumaka\b/gi,    'humko');
  t = t.replace(/\btumhaka\b/gi,   'tumhara');

  // STAGE 3 (CATEGORY B): Feminine past tense
  t = t.replace(/\bhuee\b/gi,   'hui');
  t = t.replace(/\bgayee\b/gi,  'gayi');
  t = t.replace(/\baayee\b/gi,  'aayi');
  t = t.replace(/\baaee\b/gi,   'aayi');
  t = t.replace(/\bbolee\b/gi,  'boli');
  t = t.replace(/\bkaree\b/gi,  'kari');
  t = t.replace(/\bmilee\b/gi,  'mili');
  t = t.replace(/\bbhejee\b/gi, 'bheji');
  t = t.replace(/\bpayee\b/gi,  'payi');
  t = t.replace(/\bdikee\b/gi,  'diki');

  // STAGE 4 (CATEGORY C): Infinitive -ana
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
  t = t.replace(/\bdikhana\b(?!\s+(?:do|dena))/gi, 'dikhna');
  t = t.replace(/\bsikhaana\b/gi,    'sikhna');
  t = t.replace(/\bchalaana\b/gi,    'chalana');
  t = t.replace(/\bpakadana\b/gi,    'pakadna');

  // STAGE 5 (CATEGORY D): English business words
  t = t.replace(/\bveediyo\b/gi,        'video');
  t = t.replace(/\bvidiyo\b/gi,         'video');
  t = t.replace(/\bveedeo\b/gi,         'video');
  t = t.replace(/\bkaranee\b/gi,        'karni');
  t = t.replace(/\bkarnee\b/gi,         'karni');
  t = t.replace(/\bkarani\b(?!\s*mata)/gi, 'karni');
  t = t.replace(/\bpar(?:sal|sel|cal)\b/gi, 'parcel');
  t = t.replace(/\bpai?mant\b/gi,       'payment');
  t = t.replace(/\bdeli(?:vari|vary|every|ievery)\b/gi, 'delivery');
  t = t.replace(/\bdis?pach\b/gi,       'dispatch');
  t = t.replace(/\bdespatch\b/gi,       'dispatch');
  t = t.replace(/\bri?sipt\b/gi,        'receipt');
  t = t.replace(/\breceet\b/gi,         'receipt');
  t = t.replace(/\bsam(?:pal|pel)\b/gi, 'sample');
  t = t.replace(/\badvans[ae]?\b/gi,    'advance');
  t = t.replace(/\bcon(?:farm|ferm)\b/gi, 'confirm');
  t = t.replace(/\bapointmant?\b/gi,    'appointment');
  t = t.replace(/\binvoic\b/gi,         'invoice');
  t = t.replace(/\binwoise\b/gi,        'invoice');
  t = t.replace(/\bwhatsapp\b/gi,       'WhatsApp');
  t = t.replace(/\bfollowup\b/gi,       'follow-up');
  t = t.replace(/\brupaiy?e\b/gi,       'rupaye');
  t = t.replace(/\brupaee\b/gi,         'rupaye');
  t = t.replace(/\binstallemant\b/gi,   'installment');
  t = t.replace(/\binstallmant\b/gi,    'installment');
  t = t.replace(/\bcomis+ion\b/gi,      'commission');
  t = t.replace(/\bk[ou]+rier\b/gi,     'courier');
  t = t.replace(/\btansport\b/gi,       'transport');
  t = t.replace(/\bmeating\b/gi,        'meeting');
  t = t.replace(/\bkote(?:shan|than)\b/gi, 'quotation');
  t = t.replace(/\bbal[ae]ns\b/gi,      'balance');
  t = t.replace(/\bordar\b/gi,          'order');
  t = t.replace(/\bfeeadback\b/gi,      'feedback');
  t = t.replace(/\bfoolow\b/gi,         'follow');
  t = t.replace(/\bpayse\b/gi,          'paise');
  t = t.replace(/\bripor[dt]\b/gi,      'report');
  t = t.replace(/\bstaak\b/gi,          'stock');
  t = t.replace(/\bchek\b/gi,           'cheque');
  t = t.replace(/\bchekka\b/gi,         'cheque');
  t = t.replace(/\bakaaunt\b/gi,        'account');
  t = t.replace(/\bakaunt\b/gi,         'account');
  t = t.replace(/\btransefar\b/gi,      'transfer');
  t = t.replace(/\bprabalam\b/gi,       'problem');
  t = t.replace(/\bprobalam\b/gi,       'problem');

  // STAGE 5c: More -ana infinitives
  t = t.replace(/\bjodana\b/gi,          'jodna');
  t = t.replace(/\bkhodana\b/gi,         'khodna');
  t = t.replace(/\bchadana\b/gi,         'chadhna');
  t = t.replace(/\bsunana\b(?!\s+do)/gi, 'sunna');
  t = t.replace(/\bbatana\b(?!\s+do)/gi, 'batana');
  t = t.replace(/\bbhejwana\b/gi,        'bhijwana');
  t = t.replace(/\bmanawana\b/gi,        'manwana');

  // STAGE 6 (CATEGORY E): Date/time words
  t = t.replace(/\bpara?so+n?s?\b/gi,  'parson');
  t = t.replace(/\bparsoo\b/gi,        'parson');
  t = t.replace(/\bkal\s+tak\b/gi,     'kal tak');
  t = t.replace(/\baaj\s+tak\b/gi,     'aaj tak');

  // STAGE 7 (CATEGORY F): City names
  t = t.replace(/\bnoeda\b/gi,         'Noida');
  t = t.replace(/\bnoyda\b/gi,         'Noida');
  t = t.replace(/\bnoda\b(?!l)/gi,     'Noida');
  t = t.replace(/\bgurg[oa]n\b/gi,     'Gurgaon');
  t = t.replace(/\bfar[ai]d?abad\b/gi, 'Faridabad');
  t = t.replace(/\bgaziabad\b/gi,      'Ghaziabad');
  t = t.replace(/\bghaziyabad\b/gi,    'Ghaziabad');
  t = t.replace(/\bhaidrabad\b/gi,     'Hyderabad');
  t = t.replace(/\bhydrabad\b/gi,      'Hyderabad');
  t = t.replace(/\bahmadabad\b/gi,     'Ahmedabad');
  t = t.replace(/\bbangalor\b/gi,      'Bangalore');
  t = t.replace(/\blaknow\b/gi,        'Lucknow');
  t = t.replace(/\blucnow\b/gi,        'Lucknow');
  t = t.replace(/\bbaranasi\b/gi,      'Varanasi');
  t = t.replace(/\bvaransi\b/gi,       'Varanasi');
  t = t.replace(/\bamri?ta?sar\b/gi,   'Amritsar');
  t = t.replace(/\bindor\b/gi,         'Indore');
  t = t.replace(/\bkanpoor\b/gi,       'Kanpur');
  t = t.replace(/\bjayp[ou][ou]r\b/gi, 'Jaipur');
  t = t.replace(/\bnaagpur\b/gi,       'Nagpur');
  t = t.replace(/\bnagpoor\b/gi,       'Nagpur');
  t = t.replace(/\bsoorat\b/gi,        'Surat');
  t = t.replace(/\bpuuna\b/gi,         'Pune');
  t = t.replace(/\bpuna\b/gi,          'Pune');
  t = t.replace(/\bdilli\b/gi,         'Delhi');
  t = t.replace(/\bdehlee\b/gi,        'Delhi');

  // FINAL: Hindi "kal" (multi-word call already fixed in Stage 1)
  t = t.replace(/\bcal\b/gi, 'kal');

  return t;
}

// ── Voice hook ────────────────────────────────────────────────────────────────
// Uses continuous=false + auto-restart on onend (avoids Chrome replay bug).
// committedRef persists across restarts within one session to prevent double-commits.
export function useVoice(onFinalText: (text: string) => void) {
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

  const buildRecognition = () => {
    const SR = getSR();
    if (!SR) return null;

    const rec = new SR();
    rec.lang            = VOICE_LANG;
    rec.continuous      = false;
    rec.interimResults  = true;
    rec.maxAlternatives = 1;

    rec.onresult = (ev: SpeechRecognitionEvent) => {
      let fin = '', intr = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) {
          const raw   = r[0].transcript.trim();
          const roman = devanagariToRoman(raw);
          const t     = fixTranscript(roman);
          if (t && !committedRef.current.has(raw)) {
            committedRef.current.add(raw);
            fin += t + ' ';
          }
        } else {
          intr += r[0].transcript;
        }
      }
      if (fin) setInterimText('');
      else if (intr) setInterimText(fixTranscript(devanagariToRoman(intr)));
      if (fin.trim()) onFinalRef.current(fin.trim());
    };

    rec.onerror = (e: { error: string }) => {
      switch (e.error) {
        case 'no-speech':
        case 'aborted':
          break;
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
    committedRef.current.clear();
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
