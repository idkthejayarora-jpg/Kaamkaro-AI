/**
 * LeaveModal — staff self-service leave marking.
 *
 * Staff pick a date (today or future), a reason category via pills, and an
 * optional Hinglish voice/text description. Auto-approved on the server, but
 * the UI requires TWO deliberate confirmations before submitting so a leave is
 * never marked by accident.
 */
import { useState } from 'react';
import { AlertTriangle, Home, Plane, Thermometer, User, Mic, X, CalendarDays, Check } from 'lucide-react';
import Modal from './Modal';
import { leavesAPI } from '../lib/api';
import { useVoice } from '../hooks/useVoice';

const REASONS = [
  { key: 'emergency', label: 'Emergency', icon: AlertTriangle, color: '#ef4444' },
  { key: 'family',    label: 'Family',    icon: Home,          color: '#3b82f6' },
  { key: 'sick',      label: 'Sick',      icon: Thermometer,   color: '#f59e0b' },
  { key: 'travel',    label: 'Travelling', icon: Plane,        color: '#6366f1' },
  { key: 'personal',  label: 'Personal',  icon: User,          color: '#94a3b8' },
] as const;

const istToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' });

interface Props {
  onClose: () => void;
  onDone: () => void;
}

export default function LeaveModal({ onClose, onDone }: Props) {
  const [step, setStep]         = useState<'form' | 'confirm'>('form');
  const [confirmArmed, setArmed] = useState(false);
  const [date, setDate]         = useState(istToday());
  const [reason, setReason]     = useState<string>('');
  const [desc, setDesc]         = useState('');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  const { listening, interimText, hasVoice, voiceError, toggle } = useVoice(
    (text) => setDesc(prev => (prev ? prev + ' ' : '') + text),
  );

  const selectedReason = REASONS.find(r => r.key === reason);

  const submit = async () => {
    setSaving(true); setError('');
    try {
      await leavesAPI.markSelf({ date, reasonCategory: reason, reason: desc.trim() });
      onDone();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Could not mark leave';
      setError(msg);
      setStep('form'); setArmed(false);
    } finally {
      setSaving(false);
    }
  };

  const prettyDate = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <Modal onClose={onClose} className="max-w-md">
      <div className="flex items-center justify-between px-5 py-4 border-b border-dark-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-indigo-500/12 border border-indigo-500/20 flex items-center justify-center">
            <CalendarDays size={15} className="text-indigo-300" />
          </div>
          <p className="text-white font-bold text-sm">Mark a Leave</p>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-white/40 hover:text-white transition-colors"><X size={16} /></button>
      </div>

      {step === 'form' ? (
        <div className="p-5 space-y-5 overflow-y-auto">
          {/* Date */}
          <div>
            <label className="text-white/40 text-[10px] uppercase tracking-wider font-bold">Date</label>
            <input
              type="date"
              value={date}
              min={istToday()}
              onChange={e => setDate(e.target.value)}
              className="input mt-1.5 w-full"
            />
          </div>

          {/* Reason pills */}
          <div>
            <label className="text-white/40 text-[10px] uppercase tracking-wider font-bold">Reason</label>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {REASONS.map(({ key, label, icon: Icon, color }) => {
                const active = reason === key;
                return (
                  <button
                    key={key}
                    onClick={() => setReason(key)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-all active:scale-95"
                    style={active
                      ? { background: color + '22', borderColor: color + '88', color }
                      : { background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.55)' }}
                  >
                    <Icon size={13} />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Description with mic */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-white/40 text-[10px] uppercase tracking-wider font-bold">Description <span className="text-white/25 normal-case font-normal">(optional)</span></label>
              {hasVoice && (
                <button
                  onClick={toggle}
                  className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full transition-colors ${listening ? 'bg-red-500/20 text-red-300 animate-pulse' : 'bg-gold/12 text-gold hover:bg-gold/20'}`}
                >
                  <Mic size={12} />
                  {listening ? 'Listening…' : 'Speak (Hinglish)'}
                </button>
              )}
            </div>
            <textarea
              value={desc + (interimText ? (desc ? ' ' : '') + interimText : '')}
              onChange={e => setDesc(e.target.value)}
              rows={3}
              placeholder="e.g. Ghar mein emergency hai, kal aaunga…"
              className="input mt-1.5 w-full resize-none"
            />
            {voiceError && <p className="text-red-400 text-[10px] mt-1">{voiceError}</p>}
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <button
            onClick={() => { if (reason) setStep('confirm'); }}
            disabled={!reason}
            className="btn-primary w-full py-2.5 text-sm disabled:opacity-40"
          >
            Continue
          </button>
        </div>
      ) : (
        /* ── Double confirmation ─────────────────────────────────────────── */
        <div className="p-5 space-y-5">
          <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-4 space-y-2">
            <div className="flex items-center gap-2">
              {selectedReason && <selectedReason.icon size={15} style={{ color: selectedReason.color }} />}
              <p className="text-white font-bold text-sm">{selectedReason?.label} leave</p>
            </div>
            <p className="text-white/55 text-xs">{prettyDate}</p>
            {desc.trim() && <p className="text-white/40 text-xs italic">"{desc.trim()}"</p>}
          </div>

          <p className="text-amber-300/80 text-xs text-center leading-relaxed">
            You'll be marked on leave for this day and won't be counted present.
            <br />Please confirm twice to be sure.
          </p>

          {error && <p className="text-red-400 text-xs text-center">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={() => { setStep('form'); setArmed(false); }}
              disabled={saving}
              className="btn-secondary flex-1 py-2.5 text-sm"
            >
              Back
            </button>
            <button
              onClick={() => { if (!confirmArmed) { setArmed(true); } else { submit(); } }}
              disabled={saving}
              className={`flex-1 py-2.5 text-sm rounded-xl font-bold transition-all active:scale-95 flex items-center justify-center gap-1.5 ${
                confirmArmed
                  ? 'bg-red-500/90 text-white hover:bg-red-500'
                  : 'btn-primary'
              }`}
            >
              {saving ? 'Marking…' : confirmArmed ? (<><Check size={14} /> Tap again to confirm</>) : 'Confirm Leave'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
