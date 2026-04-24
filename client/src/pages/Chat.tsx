import { useEffect, useRef, useState } from 'react';
import {
  Send, Plus, X, Radio, Users, MessageSquare, ChevronLeft,
  Search, Trash2, UserPlus, Check,
} from 'lucide-react';
import { chatAPI, staffAPI, broadcastAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useSSE } from '../hooks/useSSE';
import type { ChatConversation, ChatMessage, Staff } from '../types';

// ── New conversation modal ────────────────────────────────────────────────────
function NewConvModal({
  staff, myId, onClose, onCreate,
}: {
  staff: Staff[]; myId: string;
  onClose: () => void; onCreate: (c: ChatConversation) => void;
}) {
  const [mode, setMode]       = useState<'direct' | 'group'>('direct');
  const [selected, setSelected] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [loading, setLoading]  = useState(false);
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

        {/* direct / group toggle */}
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
            <input
              className="input text-sm"
              placeholder="Group name (optional)"
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
            />
          </div>
        )}

        <p className="text-white/30 text-xs px-4 mb-2">
          {mode === 'direct' ? 'Select a person to message' : 'Select members to add'}
        </p>

        <div className="px-4 pb-2 space-y-1 max-h-56 overflow-y-auto">
          {others.map(s => {
            const sel = selected.includes(s.id);
            return (
              <button
                key={s.id}
                onClick={() => mode === 'direct' ? setSelected([s.id]) : toggle(s.id)}
                className={`w-full flex items-center gap-3 p-2.5 rounded-xl transition-colors text-left ${
                  sel ? 'bg-gold/10 border border-gold/30' : 'hover:bg-dark-200'
                }`}
              >
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
          <button
            onClick={submit}
            disabled={selected.length === 0 || loading}
            className="btn-primary flex-1 text-sm"
          >
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
          <textarea
            value={msg}
            onChange={e => setMsg(e.target.value)}
            placeholder="Type your broadcast message…"
            rows={4}
            className="input resize-none w-full"
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
          />
        </div>
        <div className="px-5 pb-5 flex gap-3">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button
            onClick={send}
            disabled={!msg.trim() || sending}
            className="btn-primary flex-1 flex items-center justify-center gap-2"
          >
            {sent ? <Check size={14} /> : <Radio size={13} />}
            {sent ? 'Sent!' : sending ? 'Sending…' : 'Send Now'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Conversation name helper ──────────────────────────────────────────────────
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

// ── Message bubble ────────────────────────────────────────────────────────────
function Bubble({ msg, isMe }: { msg: ChatMessage; isMe: boolean }) {
  const time = new Date(msg.sentAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  return (
    <div className={`flex items-end gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
      {!isMe && (
        <div className="w-6 h-6 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center flex-shrink-0 mb-0.5">
          <span className="text-gold text-[10px] font-bold">{msg.senderAvatar}</span>
        </div>
      )}
      <div className={`max-w-[75%] ${isMe ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
        {!isMe && (
          <span className="text-white/30 text-[10px] px-1">{msg.senderName}</span>
        )}
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

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  const activeConv = conversations.find(c => c.id === activeId) || null;

  // Load conversations + staff on mount
  useEffect(() => {
    Promise.all([
      chatAPI.conversations(),
      staffAPI.list().catch(() => []),
    ]).then(([convs, s]) => {
      setConversations(convs);
      setStaff(s);
    }).finally(() => setLoading(false));
  }, []);

  // Load messages when active conversation changes
  useEffect(() => {
    if (!activeId) return;
    setMsgLoading(true);
    chatAPI.messages(activeId)
      .then(setMessages)
      .catch(() => {})
      .finally(() => setMsgLoading(false));
  }, [activeId]);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Real-time SSE
  useSSE({
    'chat:message': (data) => {
      const msg = data as ChatMessage;
      // Only show if we're in the same conversation OR update preview
      setMessages(prev => {
        if (msg.conversationId !== activeId) return prev;
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      // Update conversation last-message preview
      setConversations(prev => prev.map(c =>
        c.id === msg.conversationId
          ? { ...c, lastMessageAt: msg.sentAt, lastMessageText: msg.text.slice(0, 80) }
          : c
      ).sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()));
    },
    'chat:conversation': (data) => {
      const conv = data as ChatConversation;
      if (!conv.members.includes(user!.id)) return;
      setConversations(prev => {
        const idx = prev.findIndex(c => c.id === conv.id);
        if (idx === -1) return [conv, ...prev];
        const next = [...prev];
        next[idx] = conv;
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
    // Optimistic message
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
            <button
              onClick={() => setShowBroadcast(true)}
              className="btn-ghost flex items-center gap-2 text-sm border-gold/20 text-gold/70 hover:text-gold hover:border-gold/40"
            >
              <Radio size={14} />
              <span className="hidden sm:inline">Broadcast</span>
            </button>
          )}
          <button
            onClick={() => setShowNew(true)}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <Plus size={15} />
            <span className="hidden sm:inline">New Chat</span>
          </button>
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="flex h-[calc(100vh-14rem)] rounded-2xl border border-dark-50 overflow-hidden bg-dark-400">

        {/* ── Left panel — conversation list ─────────────────────────────── */}
        <div className={`${showMobileThread ? 'hidden' : 'flex'} md:flex flex-col w-full md:w-72 lg:w-80 border-r border-dark-50 flex-shrink-0`}>
          {/* Search */}
          <div className="p-3 border-b border-dark-50">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input
                className="input pl-8 text-sm py-2"
                placeholder="Search conversations…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* List */}
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
              const name = convDisplayName(conv, staff, user!.id);
              const avatar = convAvatar(conv, staff, user!.id);
              const time = conv.lastMessageAt
                ? new Date(conv.lastMessageAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
                : '';
              return (
                <button
                  key={conv.id}
                  onClick={() => openConversation(conv.id)}
                  className={`w-full flex items-center gap-3 px-3 py-3 border-b border-dark-50/50 transition-colors text-left group ${
                    isActive ? 'bg-gold/10 border-l-2 border-l-gold' : 'hover:bg-dark-300'
                  }`}
                >
                  {/* Avatar */}
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold ${
                    conv.type === 'group'
                      ? 'bg-dark-200 text-white/60'
                      : 'bg-gold/20 border border-gold/30 text-gold'
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
                <button
                  onClick={() => { setShowMobileThread(false); setActiveId(null); }}
                  className="md:hidden text-white/40 hover:text-white mr-1"
                >
                  <ChevronLeft size={18} />
                </button>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold ${
                  activeConv.type === 'group'
                    ? 'bg-dark-200'
                    : 'bg-gold/20 border border-gold/30 text-gold'
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
                {/* Delete (admin or creator) */}
                {(isAdmin || activeConv.createdBy === user!.id) && (
                  <button
                    onClick={() => handleDelete(activeConv.id)}
                    className="p-1.5 text-white/20 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    title="Delete conversation"
                  >
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
                  </div>
                )}
                {messages.map(msg => (
                  <Bubble key={msg.id} msg={msg} isMe={msg.senderId === user!.id} />
                ))}
                <div ref={bottomRef} />
              </div>

              {/* Input */}
              <div className="px-4 py-3 border-t border-dark-50 flex items-end gap-2 flex-shrink-0">
                <textarea
                  ref={inputRef}
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message… (Enter to send)"
                  rows={1}
                  className="input flex-1 resize-none text-sm py-2.5 max-h-28"
                  style={{ overflowY: draft.split('\n').length > 3 ? 'auto' : 'hidden' }}
                />
                <button
                  onClick={send}
                  disabled={!draft.trim() || sending}
                  className={`p-2.5 rounded-xl transition-all flex-shrink-0 ${
                    draft.trim() && !sending
                      ? 'bg-gold text-dark-500 hover:bg-gold-light'
                      : 'bg-dark-300 text-white/20 cursor-not-allowed'
                  }`}
                >
                  <Send size={16} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {showNew && (
        <NewConvModal
          staff={staff}
          myId={user!.id}
          onClose={() => setShowNew(false)}
          onCreate={handleNewConv}
        />
      )}
      {showBroadcast && <BroadcastModal onClose={() => setShowBroadcast(false)} />}
    </div>
  );
}
