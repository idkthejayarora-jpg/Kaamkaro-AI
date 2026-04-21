import { useEffect, useState } from 'react';
import { Copy, Webhook, CheckCircle, ExternalLink } from 'lucide-react';
import api from '../lib/api';

interface WebhookInfo {
  url: string;
  secured: boolean;
  instructions: {
    twilio: string;
    format: string;
    supported: string[];
  };
}

export default function WebhookSetup() {
  const [info, setInfo]     = useState<WebhookInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.get('/webhook/info').then(r => setInfo(r.data)).catch(() => {});
  }, []);

  const copyUrl = async () => {
    if (!info) return;
    await navigator.clipboard.writeText(info.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const EXAMPLES = [
    '"Called Raj Kumar, interested, follow up Friday"',
    '"Meeting with Priya Sharma — closed the deal"',
    '"WhatsApp Ankit, no response"',
    '"Email Sunita - negotiating, follow up 2025-02-20"',
  ];

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Webhook size={24} className="text-gold" />
          WhatsApp / SMS Quick-Log
        </h1>
        <p className="text-white/30 text-sm mt-1">
          Send a WhatsApp or SMS message to auto-log interactions without opening the app.
        </p>
      </div>

      {/* Webhook URL */}
      <div className="card">
        <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">Webhook URL</p>
        <div className="flex items-center gap-3 bg-dark-200 border border-dark-50 rounded-xl px-4 py-3">
          <code className="flex-1 text-gold text-sm truncate font-mono">
            {info?.url || 'Loading…'}
          </code>
          <button onClick={copyUrl} className={`p-1.5 rounded-lg transition-all flex-shrink-0 ${copied ? 'text-green-400' : 'text-white/30 hover:text-white'}`}>
            {copied ? <CheckCircle size={16} /> : <Copy size={16} />}
          </button>
        </div>
        {info?.secured && (
          <p className="text-green-400/70 text-xs mt-2 flex items-center gap-1">
            <CheckCircle size={10} /> Secured with WEBHOOK_SECRET
          </p>
        )}
        {!info?.secured && (
          <p className="text-orange-400/70 text-xs mt-2">
            ⚠️ Not secured — add WEBHOOK_SECRET to .env to require a secret token
          </p>
        )}
      </div>

      {/* How it works */}
      <div className="card space-y-4">
        <p className="text-white/40 text-xs font-semibold uppercase tracking-wider">How It Works</p>
        <div className="space-y-3">
          {[
            { step: '1', title: 'Set up Twilio', desc: 'Create a free Twilio account, buy a WhatsApp-enabled number, and set this webhook URL in: Messaging → A Number → When a message comes in.' },
            { step: '2', title: 'Staff send a message', desc: 'Your staff WhatsApp the Twilio number with a natural language message. Include the customer name and what happened.' },
            { step: '3', title: 'Auto-logged', desc: 'Kaamkaro parses the message, matches the customer, logs the interaction, and optionally creates a follow-up task. Staff get a confirmation reply.' },
          ].map(({ step, title, desc }) => (
            <div key={step} className="flex gap-4">
              <div className="w-7 h-7 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center flex-shrink-0 text-gold font-bold text-xs">
                {step}
              </div>
              <div>
                <p className="text-white font-medium text-sm">{title}</p>
                <p className="text-white/40 text-xs mt-0.5 leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        <a href="https://console.twilio.com" target="_blank" rel="noopener noreferrer"
          className="btn-secondary flex items-center gap-2 w-fit text-sm">
          <ExternalLink size={13} />Open Twilio Console
        </a>
      </div>

      {/* Message format examples */}
      <div className="card space-y-3">
        <p className="text-white/40 text-xs font-semibold uppercase tracking-wider">Message Examples</p>
        <div className="space-y-2">
          {EXAMPLES.map((ex, i) => (
            <div key={i} className="bg-dark-200 border border-dark-50 rounded-xl px-4 py-2.5">
              <code className="text-gold/80 text-sm">{ex}</code>
            </div>
          ))}
        </div>
        <div className="text-white/30 text-xs space-y-1">
          <p>• Customer name must match exactly (case-insensitive)</p>
          <p>• Keywords detected: called/message/email/meeting, interested/closed/churned, follow up [day/date]</p>
          <p>• "no response" / "didn't pick" / "unreachable" → responded = false</p>
        </div>
      </div>

      {/* Supported providers */}
      {info?.instructions.supported && (
        <div className="card">
          <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">Supported Providers</p>
          <div className="flex flex-wrap gap-2">
            {info.instructions.supported.map(p => (
              <span key={p} className="badge badge-gray">{p}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
