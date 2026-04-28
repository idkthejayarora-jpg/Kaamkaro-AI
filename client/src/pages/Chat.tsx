import { useEffect, useRef, useState } from 'react';
import {
  Send, Plus, X, Radio, Users, MessageSquare, ChevronLeft,
  Search, Trash2, UserPlus, Check, ArrowLeftRight, Calendar,
  Clock, CheckCircle2, XCircle, AlertTriangle,
} from 'lucide-react';
import { chatAPI, staffAPI, tasksAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useSSE } from '../hooks/useSSE';
import type { ChatConversation, ChatMessage, Staff, Task } from '../types';

// ── New conversation modal ────────────────────────────────────────────────────
function NewConvModal({
  staff, myId, onClose, onCreate,
}: {
  staff: Staff[]; myId: string;
  onClose: () => void; onCreate: (c: ChatConversation) => void;
}) {
  const [mode, setMode]         = useState<'direct' | 'group'>('direct');
  const [selected, setSelected] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [loading, setLoading]   = useState(false);
  const others = staff.filter(s => s.id !== myId);

  const toggle = (id: string) => {
    setSelected(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  };

  const submit = async () => {
    if (selected.length === 0) return;
    setLoading(true);
    try {
      const conv = await chatAPI.createConversation({
        type: mode,
        name: mode === 'group' ? (groupName || 'Group') : undefined,
        members: selected,
      });
      onCreate(conv);
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-dark-300 border border-dark-50 rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-50">
          <h2 className="text-white font-semibold text-sm">New Conversation</h2>
          <button onClick={onClose} className="text-white/30 hover:text-white"><X size={16} /></button>
        </div>

        <div className="flex m-4 mb-3 rounded-xl border border-dark-50 overflow-hidden">
          {(['direct', 'group'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`flex-1 py-2 text-xs font-medium capitalize transition-colors ${
                mode === m ? 'bg-gold text-dark-500' : 'text-white/40 hover:text-white'
              }`}>
              {m === 'direct' ? 'Direct Message' : 'Group Chat'}
            </button>
          ))}
        </div>

        {mode === 'group' && (
          <div className="px-4 mb-3">
            <input className="input text-sm" placeholder="Group name (optional)"
              value={groupName} onChange={e => setGroupName(e.target.value)} />
          </div>
        )}

        <p className="text-white/30 text-xs px-4 mb-2">
          {mode === 'direct' ? 'Select a person to message' : 'Select members to add'}
        </p>

        <div className="px-4 pb-2 space-y-1 max-h-56 overflow-y-auto">
          {others.map(s => {
            const sel = selected.includes(s.id);
            return (
              <button key={s.id}
                onClick={() => mode === 'direct' ? setSelected([s.id]) : toggle(s.id)}
                className={`w-full flex items-center gap-3 p-2.5 rounded-xl transition-colors text-left ${
                  sel ? 'bg-gold/10 border border-gold/30' : 'hover:bg-dark-200'
                }`}>
                <div className="w-7 h-7 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-gold text-xs font-bold">{s.avatar || s.name[0]}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{s.name}</p>
                  <p className="text-white/30 text-xs capitalize">{s.role}</p>
                </div>
                {sel && <Check size={14} className="text-gold flex-shrink-0" />}
              </button>
            );
          })}
          {others.length === 0 && (
            <p className="text-white/25 text-xs text-center py-4">No other staff members</p>
          )}
        </div>

        <div className="px-4 pb-4 mt-2 flex gap-3">
          <button onClick={onClose} className="btn-ghost flex-1 text-sm">Cancel</button>
          <button onClick={submit} disabled={selected.length === 0 || loading}
            className="btn-primary flex-1 text-sm">
            {loading ? 'Creating…' : mode === 'direct' ? 'Message' : `Create Group (${selected.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Broadcast modal ───────────────────────────────────────────────────────────
function BroadcastModal({ onClose }: { onClose: () => void }) {
  const [msg, setMsg]       = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent]     = useState(false);

  const send = async () => {
    if (!msg.trim() || sending) return;
    setSending(true);
    try {
      const { broadcastAPI } = await import('../lib/api');
      await broadcastAPI.send(msg.trim());
      setSent(true);
      setTimeout(onClose, 1200);
    } catch { /* non-fatal */ }
    finally { setSending(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-dark-300 border border-gold/30 rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-50">
          <div className="flex items-center gap-2">
            <Radio size={15} className="text-gold animate-pulse" />
            <span className="text-white font-semibold text-sm">Broadcast to All Staff</span>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-white/40 text-xs">All online staff will see this as a popup notification with a sound alert.</p>
          <textarea value={msg} onChange={e => setMsg(e.target.value)}
            placeholder="Type your broadcast message…" rows={4}
            className="input resize-none w-full" autoFocus
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }} />
        </div>
        <div className="px-5 pb-5 flex gap-3">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button onClick={send} disabled={!msg.trim() || sending}
            className="btn-primary flex-1 flex items-center justify-center gap-2">
            {sent ? <Check size={14} /> : <Radio size={13} />}
            {sent ? 'Sent!' : sending ? 'Sending…' : 'Send Now'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Transfer Task modal ───────────────────────────────────────────────────────
function TransferTaskModal({ conv, staff, myId, onClose, onTransferred }: {
  conv: ChatConversation;
  staff: Staff[];
  myId: string;
  onClose: () => void;
  onTransferred: (msg: ChatMessage) => void;
}) {
  const [tasks, setTasks]           = useState<Task[]>([]);
  const [loading, setLoading]       = useState(true);
  const [selectedTask, setSelectedTask] = useState<string>('');
  const [selectedTo, setSelectedTo] = useState<string>('');
  const [sending, setSending]       = useState(false);
  const [error, setError]           = useState('');

  // Other staff in this conversation (potential recipients)
  const recipients = staff.filter(s => s.id !== myId && conv.members.includes(s.id));

  useEffect(() => {
    tasksAPI.list({ completed: false })
      .then((ts: Task[]) => {
        // Only transferable: my tasks, not already transferred out
        setTasks(ts.filter(t => t.staffId === myId && !t.completed));
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    // Auto-select recipient if direct chat (only one other person)
    if (recipients.length === 1) setSelectedTo(recipients[0].id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (!selectedTask || !selectedTo) { setError('Select a task and recipient'); return; }
    setSending(true);
    setError('');
    try {
      const msg = await tasksAPI.transferRequest(selectedTask, selectedTo, conv.id);
      onTransferred(msg);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to send request');
    } finally { setSending(false); }
  };

  const selectedTaskObj = tasks.find(t => t.id === selectedTask);
  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-dark-300 border border-dark-50 rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-50">
          <div className="flex items-center gap-2">
            <ArrowLeftRight size={15} className="text-gold" />
            <h2 className="text-white font-semibold text-sm">Transfer a Task</h2>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
              <AlertTriangle size={12} /> {error}
            </div>
          )}

          <p className="text-white/40 text-xs">
            The recipient will get an Accept / Decline request in this chat.
            If they accept, the task moves to them — <span className="text-amber-400">no merit points</span> for you on completion.
          </p>

          {/* Select task */}
          <div>
            <label className="label">Your task to transfer</label>
            {loading ? (
              <div className="h-10 bg-dark-200 rounded-xl shimmer" />
            ) : tasks.length === 0 ? (
              <p className="text-white/25 text-sm text-center py-3">No pending tasks to transfer.</p>
            ) : (
              <div className="space-y-1 max-h-44 overflow-y-auto">
                {tasks.map(t => {
                  const overdue = t.dueDate < today;
                  const sel = selectedTask === t.id;
                  return (
                    <button key={t.id} onClick={() => setSelectedTask(t.id)}
                      className={`w-full text-left flex items-start gap-2.5 px-3 py-2.5 rounded-xl border transition-all ${
                        sel ? 'border-gold/40 bg-gold/8' : 'border-dark-50 hover:border-dark-100'
                      }`}>
                      <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${overdue ? 'bg-red-400' : 'bg-gold/50'}`} />
                      <div className="min-w-0">
                        <p className="text-white text-xs font-medium truncate">{t.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {t.customerName && <span className="text-white/25 text-[10px] truncate">{t.customerName}</span>}
                          <span className={`text-[10px] ${overdue ? 'text-red-400' : 'text-white/30'}`}>
                            {overdue ? '⚠ Overdue · ' : ''}
                            {new Date(t.dueDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                          </span>
                        </div>
                      </div>
                      {sel && <Check size={12} className="text-gold flex-shrink-0 mt-0.5 ml-auto" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Select recipient (only shown for group chats) */}
          {recipients.length > 1 && (
            <div>
              <label className="label">Transfer to</label>
              <select className="input" value={selectedTo} onChange={e => setSelectedTo(e.target.value)}>
                <option value="">Select recipient…</option>
                {recipients.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}

          {/* Preview */}
          {selectedTaskObj && selectedTo && (
            <div className="bg-dark-200 rounded-xl px-3 py-2.5 text-xs text-white/50 leading-relaxed border border-dark-50">
              Transferring <span className="text-white font-medium">"{selectedTaskObj.title}"</span> to{' '}
              <span className="text-gold font-medium">{staff.find(s => s.id === selectedTo)?.name}</span>
            </div>
          )}
        </div>

        <div className="px-5 pb-5 flex gap-3">
          <button onClick={onClose} className="btn-ghost flex-1 text-sm">Cancel</button>
          <button onClick={submit} disabled={!selectedTask || !selectedTo || sending || tasks.length === 0}
            className="btn-primary flex-1 text-sm flex items-center justify-center gap-2">
            {sending
              ? <div className="w-4 h-4 border-2 border-dark-500/30 border-t-dark-500 rounded-full animate-spin" />
              : <ArrowLeftRight size={13} />}
            {sending ? 'Sending…' : 'Send Request'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Task transfer bubble ──────────────────────────────────────────────────────
function TaskTransferBubble({ msg, isMe, myId }: { msg: ChatMessage; isMe: boolean; myId: string }) {
  const [acting, setActing] = useState(false);
  const meta = msg.metadata!;
  const time = new Date(msg.sentAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  const today = new Date().toISOString().split('T')[0];
  const isOverdue = meta.taskDueDate < today;

  const isRecipient = meta.toStaffId === myId;

  const handleAccept = async () => {
    setActing(true);
    try { await tasksAPI.transferAccept(meta.taskId, msg.id); }
    catch { /* SSE will update */ }
    finally { setActing(false); }
  };

  const handleDecline = async () => {
    setActing(true);
    try { await tasksAPI.transferDecline(meta.taskId, msg.id); }
    catch { /* SSE will update */ }
    finally { setActing(false); }
  };

  return (
    <div className={`flex items-end gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
      {!isMe && (
        <div className="w-6 h-6 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center flex-shrink-0 mb-0.5">
          <span className="text-gold text-[10px] font-bold">{msg.senderAvatar}</span>
        </div>
      )}
      <div className={`max-w-[82%] ${isMe ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
        {!isMe && <span className="text-white/30 text-[10px] px-1">{msg.senderName}</span>}

        {/* Card */}
        <div className={`rounded-2xl border overflow-hidden ${
          isMe ? 'rounded-br-sm' : 'rounded-bl-sm'
        } ${
          meta.status === 'accepted' ? 'border-green-500/30 bg-green-500/5' :
          meta.status === 'declined' ? 'border-red-500/20 bg-red-500/5' :
          'border-gold/25 bg-gold/5'
        }`}>
          {/* Header */}
          <div className="px-3 pt-2.5 pb-1.5 flex items-center gap-2 border-b border-white/6">
            <ArrowLeftRight size={11} className={
              meta.status === 'accepted' ? 'text-green-400' :
              meta.status === 'declined' ? 'text-red-400/70' :
              'text-gold'
            } />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
              Task Transfer Request
            </span>
            {meta.status !== 'pending' && (
              <span className={`ml-auto text-[10px] font-semibold ${
                meta.status === 'accepted' ? 'text-green-400' : 'text-red-400'
              }`}>
                {meta.status === 'accepted' ? '✓ Accepted' : '✗ Declined'}
              </span>
            )}
          </div>

          {/* Task info */}
          <div className="px-3 py-2.5 space-y-1.5">
            <p className="text-white font-semibold text-sm leading-snug">{meta.taskTitle}</p>
            <div className="flex items-center gap-2 flex-wrap">
              {meta.taskCustomerName && (
                <span className="text-[10px] text-white/35">{meta.taskCustomerName}</span>
              )}
              <span className={`text-[10px] flex items-center gap-1 ${isOverdue ? 'text-red-400' : 'text-white/30'}`}>
                <Calendar size={9} />
                {isOverdue ? '⚠ Overdue · ' : ''}
                {new Date(meta.taskDueDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              </span>
            </div>

            {/* Direction arrow */}
            <div className="flex items-center gap-1.5 text-[10px] text-white/30 pt-0.5">
              <span className="font-medium text-white/50">{meta.fromStaffName}</span>
              <ArrowLeftRight size={9} />
              <span className="font-medium text-white/50">{meta.toStaffName}</span>
            </div>

            {/* Note about merit */}
            {meta.status === 'pending' && (
              <p className="text-[10px] text-amber-400/70 pt-0.5">
                ⚠ Points on completion go to {meta.toStaffName}, not {meta.fromStaffName}
              </p>
            )}
            {meta.status === 'accepted' && (
              <p className="text-[10px] text-green-400/70">
                Task is now with {meta.toStaffName}
              </p>
            )}
            {meta.status === 'declined' && (
              <p className="text-[10px] text-red-400/60">
                {meta.toStaffName} declined — task stays with {meta.fromStaffName}
              </p>
            )}
          </div>

          {/* Accept / Decline (only for recipient, only when pending) */}
          {isRecipient && meta.status === 'pending' && (
            <div className="flex border-t border-white/6">
              <button
                onClick={handleDecline}
                disabled={acting}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors border-r border-white/6 disabled:opacity-40"
              >
                <XCircle size={13} /> Decline
              </button>
              <button
                onClick={handleAccept}
                disabled={acting}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-green-400 hover:bg-green-500/10 transition-colors disabled:opacity-40"
              >
                {acting
                  ? <div className="w-3 h-3 border border-green-400/40 border-t-green-400 rounded-full animate-spin" />
                  : <CheckCircle2 size={13} />}
                Accept
              </button>
            </div>
          )}

          {/* Sender sees pending state */}
          {isMe && meta.status === 'pending' && (
            <div className="px-3 pb-2.5 flex items-center gap-1.5 text-[10px] text-white/25">
              <Clock size={9} className="animate-pulse" /> Waiting for response…
            </div>
          )}
        </div>

        <span className="text-white/20 text-[10px] px-1">{time}</span>
      </div>
    </div>
  );
}

// ── Regular message bubble ────────────────────────────────────────────────────
function Bubble({ msg, isMe, myId }: { msg: ChatMessage; isMe: boolean; myId: string }) {
  if (msg.messageType === 'task_transfer') {
    return <TaskTransferBubble msg={msg} isMe={isMe} myId={myId} />;
  }

  const time = new Date(msg.sentAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  return (
    <div className={`flex items-end gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
      {!isMe && (
        <div className="w-6 h-6 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center flex-shrink-0 mb-0.5">
          <span className="text-gold text-[10px] font-bold">{msg.senderAvatar}</span>
        </div>
      )}
      <div className={`max-w-[75%] ${isMe ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
        {!isMe && <span className="text-white/30 text-[10px] px-1">{msg.senderName}</span>}
        <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${
          isMe
            ? 'bg-gold text-dark-500 rounded-br-sm'
            : 'bg-dark-300 border border-dark-50 text-white rounded-bl-sm'
        }`}>
          {msg.text}
        </div>
        <span className="text-white/20 text-[10px] px-1">{time}</span>
      </div>
    </div>
  );
}

// ── Conversation helpers ──────────────────────────────────────────────────────
function convDisplayName(conv: ChatConversation, staff: Staff[], myId: string): string {
  if (conv.type === 'group') return conv.name || 'Group';
  const otherId = conv.members.find(m => m !== myId);
  return staff.find(s => s.id === otherId)?.name || 'Chat';
}
function convAvatar(conv: ChatConversation, staff: Staff[], myId: string): string {
  if (conv.type === 'group') return '👥';
  const otherId = conv.members.find(m => m !== myId);
  const s = staff.find(x => x.id === otherId);
  return s?.avatar || s?.name[0].toUpperCase() || '?';
}
function convMemberNames(conv: ChatConversation, staff: Staff[], myId: string): string {
  return conv.members
    .filter(m => m !== myId)
    .map(m => staff.find(s => s.id === m)?.name || 'Unknown')
    .join(', ');
}

// ── Main Chat page ────────────────────────────────────────────────────────────
export default function Chat() {
  const { user, isAdmin } = useAuth();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [staff, setStaff]                 = useState<Staff[]>([]);
  const [activeId, setActiveId]           = useState<string | null>(null);
  const [messages, setMessages]           = useState<ChatMessage[]>([]);
  const [draft, setDraft]                 = useState('');
  const [loading, setLoading]             = useState(true);
  const [msgLoading, setMsgLoading]       = useState(false);
  const [sending, setSending]             = useState(false);
  const [search, setSearch]               = useState('');
  const [showNew, setShowNew]             = useState(false);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [showMobileThread, setShowMobileThread] = useState(false);
  const [showTransfer, setShowTransfer]   = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  const activeConv = conversations.find(c => c.id === activeId) || null;

  // Can transfer: staff (not admin) in a direct or group chat with other members
  const canTransfer = !isAdmin && !!activeConv && activeConv.members.filter(m => m !== user!.id).length > 0;

  useEffect(() => {
    Promise.all([
      chatAPI.conversations(),
      staffAPI.list().catch(() => []),
    ]).then(([convs, s]) => {
      setConversations(convs);
      setStaff(s);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!activeId) return;
    setMsgLoading(true);
    chatAPI.messages(activeId)
      .then(setMessages)
      .catch(() => {})
      .finally(() => setMsgLoading(false));
  }, [activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useSSE({
    'chat:message': (data) => {
      const msg = data as ChatMessage;
      setMessages(prev => {
        if (msg.conversationId !== activeId) return prev;
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      setConversations(prev => prev.map(c =>
        c.id === msg.conversationId
          ? { ...c, lastMessageAt: msg.sentAt, lastMessageText: msg.text.slice(0, 80) }
          : c
      ).sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()));
    },
    // Task transfer accept/decline — update the message in place
    'chat:message:updated': (data) => {
      const updated = data as ChatMessage;
      setMessages(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated } : m));
    },
    'chat:conversation': (data) => {
      const conv = data as ChatConversation;
      if (!conv.members.includes(user!.id)) return;
      setConversations(prev => {
        const idx = prev.findIndex(c => c.id === conv.id);
        if (idx === -1) return [conv, ...prev];
        const next = [...prev]; next[idx] = conv;
        return next.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
      });
    },
    'chat:conversation:deleted': (data) => {
      const { id } = data as { id: string };
      setConversations(prev => prev.filter(c => c.id !== id));
      if (activeId === id) { setActiveId(null); setMessages([]); }
    },
  });

  const openConversation = (id: string) => {
    setActiveId(id);
    setShowMobileThread(true);
    setDraft('');
  };

  const send = async () => {
    if (!draft.trim() || !activeId || sending) return;
    const text = draft.trim();
    setDraft('');
    setSending(true);
    const optimistic: ChatMessage = {
      id: `opt-${Date.now()}`,
      conversationId: activeId,
      senderId: user!.id,
      senderName: user!.name,
      senderAvatar: user!.avatar || user!.name[0],
      text,
      sentAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);
    try {
      const real = await chatAPI.sendMessage(activeId, text);
      setMessages(prev => prev.map(m => m.id === optimistic.id ? real : m));
    } catch {
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      setDraft(text);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const handleNewConv = (conv: ChatConversation) => {
    setConversations(prev => {
      if (prev.some(c => c.id === conv.id)) return prev;
      return [conv, ...prev];
    });
    setShowNew(false);
    openConversation(conv.id);
  };

  const handleDelete = async (convId: string) => {
    try {
      await chatAPI.deleteConversation(convId);
      setConversations(prev => prev.filter(c => c.id !== convId));
      if (activeId === convId) { setActiveId(null); setMessages([]); setShowMobileThread(false); }
    } catch { /* non-fatal */ }
  };

  const handleTransferSent = (msg: ChatMessage) => {
    setShowTransfer(false);
    // Add the transfer message to the thread optimistically
    setMessages(prev => {
      if (prev.some(m => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  };

  const filtered = conversations.filter(c => {
    if (!search) return true;
    const name = convDisplayName(c, staff, user!.id).toLowerCase();
    return name.includes(search.toLowerCase());
  });

  if (loading) return (
    <div className="space-y-3">
      {Array(4).fill(0).map((_, i) => <div key={i} className="card h-16 shimmer" />)}
    </div>
  );

  return (
    <div className="animate-fade-in">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Chat</h1>
          <p className="text-white/30 text-sm mt-0.5">{conversations.length} conversations</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button onClick={() => setShowBroadcast(true)}
              className="btn-ghost flex items-center gap-2 text-sm border-gold/20 text-gold/70 hover:text-gold hover:border-gold/40">
              <Radio size={14} />
              <span className="hidden sm:inline">Broadcast</span>
            </button>
          )}
          <button onClick={() => setShowNew(true)}
            className="btn-primary flex items-center gap-2 text-sm">
            <Plus size={15} />
            <span className="hidden sm:inline">New Chat</span>
          </button>
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="flex h-[calc(100vh-14rem)] rounded-2xl border border-dark-50 overflow-hidden bg-dark-400">

        {/* ── Left panel — conversation list ─────────────────────────────── */}
        <div className={`${showMobileThread ? 'hidden' : 'flex'} md:flex flex-col w-full md:w-72 lg:w-80 border-r border-dark-50 flex-shrink-0`}>
          <div className="p-3 border-b border-dark-50">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input className="input pl-8 text-sm py-2" placeholder="Search conversations…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
                <MessageSquare size={32} className="text-white/20" />
                <p className="text-white/30 text-sm">No conversations yet</p>
                <button onClick={() => setShowNew(true)} className="btn-primary text-sm">Start chatting</button>
              </div>
            )}
            {filtered.map(conv => {
              const isActive = conv.id === activeId;
              const name   = convDisplayName(conv, staff, user!.id);
              const avatar = convAvatar(conv, staff, user!.id);
              const time   = conv.lastMessageAt
                ? new Date(conv.lastMessageAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
                : '';
              return (
                <button key={conv.id} onClick={() => openConversation(conv.id)}
                  className={`w-full flex items-center gap-3 px-3 py-3 border-b border-dark-50/50 transition-colors text-left group ${
                    isActive ? 'bg-gold/10 border-l-2 border-l-gold' : 'hover:bg-dark-300'
                  }`}>
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold ${
                    conv.type === 'group' ? 'bg-dark-200 text-white/60' : 'bg-gold/20 border border-gold/30 text-gold'
                  }`}>
                    {conv.type === 'group' ? <Users size={16} className="text-white/40" /> : avatar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-white text-sm font-medium truncate">{name}</p>
                      <span className="text-white/20 text-[10px] flex-shrink-0">{time}</span>
                    </div>
                    <p className="text-white/30 text-xs truncate mt-0.5">
                      {conv.lastMessageText || (conv.type === 'group' ? convMemberNames(conv, staff, user!.id) : '')}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Right panel — thread ───────────────────────────────────────── */}
        <div className={`${showMobileThread ? 'flex' : 'hidden'} md:flex flex-1 flex-col min-w-0`}>
          {!activeConv ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
              <MessageSquare size={40} className="text-white/15" />
              <p className="text-white/30 text-sm">Select a conversation or start a new one</p>
              <button onClick={() => setShowNew(true)} className="btn-primary text-sm">New Chat</button>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-dark-50 flex-shrink-0">
                <button onClick={() => { setShowMobileThread(false); setActiveId(null); }}
                  className="md:hidden text-white/40 hover:text-white mr-1">
                  <ChevronLeft size={18} />
                </button>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold ${
                  activeConv.type === 'group' ? 'bg-dark-200' : 'bg-gold/20 border border-gold/30 text-gold'
                }`}>
                  {activeConv.type === 'group'
                    ? <Users size={15} className="text-white/40" />
                    : convAvatar(activeConv, staff, user!.id)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-sm truncate">
                    {convDisplayName(activeConv, staff, user!.id)}
                  </p>
                  {activeConv.type === 'group' && (
                    <p className="text-white/30 text-xs truncate">
                      {convMemberNames(activeConv, staff, user!.id)}
                    </p>
                  )}
                </div>
                {/* Transfer task button — staff only */}
                {canTransfer && (
                  <button
                    onClick={() => setShowTransfer(true)}
                    title="Transfer a task to this person"
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gold/20 bg-gold/5 text-gold/60 hover:bg-gold/10 hover:text-gold hover:border-gold/40 transition-all text-xs font-medium"
                  >
                    <ArrowLeftRight size={12} />
                    <span className="hidden sm:inline">Transfer Task</span>
                  </button>
                )}
                {(isAdmin || activeConv.createdBy === user!.id) && (
                  <button onClick={() => handleDelete(activeConv.id)}
                    className="p-1.5 text-white/20 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    title="Delete conversation">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {msgLoading && (
                  <div className="flex justify-center py-8">
                    <div className="w-5 h-5 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                {!msgLoading && messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full gap-2">
                    <MessageSquare size={28} className="text-white/15" />
                    <p className="text-white/25 text-sm">No messages yet — say hi!</p>
                    {canTransfer && (
                      <button onClick={() => setShowTransfer(true)}
                        className="mt-2 flex items-center gap-2 text-xs text-gold/60 hover:text-gold border border-gold/20 hover:border-gold/40 px-3 py-1.5 rounded-lg transition-colors">
                        <ArrowLeftRight size={12} /> Transfer a task
                      </button>
                    )}
                  </div>
                )}
                {messages.map(msg => (
                  <Bubble key={msg.id} msg={msg} isMe={msg.senderId === user!.id} myId={user!.id} />
                ))}
                <div ref={bottomRef} />
              </div>

              {/* Input */}
              <div className="px-4 py-3 border-t border-dark-50 flex items-end gap-2 flex-shrink-0">
                {/* Transfer task shortcut button */}
                {canTransfer && (
                  <button
                    onClick={() => setShowTransfer(true)}
                    title="Transfer a task"
                    className="p-2.5 rounded-xl border border-dark-50 text-white/25 hover:text-gold hover:border-gold/30 transition-all flex-shrink-0"
                  >
                    <ArrowLeftRight size={15} />
                  </button>
                )}
                <textarea ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message… (Enter to send)"
                  rows={1}
                  className="input flex-1 resize-none text-sm py-2.5 max-h-28"
                  style={{ overflowY: draft.split('\n').length > 3 ? 'auto' : 'hidden' }} />
                <button onClick={send} disabled={!draft.trim() || sending}
                  className={`p-2.5 rounded-xl transition-all flex-shrink-0 ${
                    draft.trim() && !sending
                      ? 'bg-gold text-dark-500 hover:bg-gold-light'
                      : 'bg-dark-300 text-white/20 cursor-not-allowed'
                  }`}>
                  <Send size={16} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {showNew && (
        <NewConvModal staff={staff} myId={user!.id}
          onClose={() => setShowNew(false)} onCreate={handleNewConv} />
      )}
      {showBroadcast && <BroadcastModal onClose={() => setShowBroadcast(false)} />}
      {showTransfer && activeConv && (
        <TransferTaskModal
          conv={activeConv}
          staff={staff}
          myId={user!.id}
          onClose={() => setShowTransfer(false)}
          onTransferred={handleTransferSent}
        />
      )}
    </div>
  );
}
