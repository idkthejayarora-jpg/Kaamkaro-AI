import { useEffect, useRef } from 'react';

type SSEHandler = (data: unknown) => void;

/**
 * Subscribe to one or more Server-Sent Events from /api/events.
 *
 *   useSSE({
 *     'diary:updated': (entry) => setEntries(prev => upsert(prev, entry)),
 *     'diary:deleted': ({ id }) => setEntries(prev => prev.filter(e => e.id !== id)),
 *   });
 *
 * ── Shared connection ────────────────────────────────────────────────────────
 * Every consumer shares ONE underlying EventSource (a module-level singleton),
 * not one connection per hook. Previously each useSSE() opened its own
 * EventSource — with Layout + NotificationsBell always mounted plus the active
 * page, that was 3+ permanent connections, which over HTTP/1.1 holds open most
 * of the browser's ~6-per-host slots and stalls regular API fetches.
 *
 * The manager below reference-counts subscribers, fans a single stream out to
 * all of them, owns the reconnect back-off, and pauses while the tab is hidden.
 * The hook's public API is unchanged.
 */

// ── Singleton connection manager ─────────────────────────────────────────────
const handlerRegistry = new Map<string, Set<SSEHandler>>(); // event name → handlers
const boundEvents = new Set<string>();                       // event names wired to the ES
let es: EventSource | null = null;
let retryTimeout: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 3000;
let paused = false;
let subscriberCount = 0;
let visibilityBound = false;

function bindEvent(name: string) {
  if (boundEvents.has(name) || !es) return;
  boundEvents.add(name);
  es.addEventListener(name, (ev: MessageEvent) => {
    let data: unknown;
    try { data = JSON.parse(ev.data); } catch { return; }
    const set = handlerRegistry.get(name);
    if (set) for (const fn of set) { try { fn(data); } catch { /* ignore consumer errors */ } }
  });
}

function connect() {
  if (paused || subscriberCount === 0 || es) return;
  const token = localStorage.getItem('kk_token');
  es = new EventSource(`/api/events${token ? `?token=${token}` : ''}`);

  es.addEventListener('connected', () => { retryDelay = 3000; });

  // Wire every event name any consumer currently cares about
  boundEvents.clear();
  for (const name of handlerRegistry.keys()) bindEvent(name);

  es.onerror = () => {
    es?.close();
    es = null;
    boundEvents.clear();
    if (paused || subscriberCount === 0) return;
    if (retryTimeout) clearTimeout(retryTimeout);
    retryTimeout = setTimeout(() => {
      retryDelay = Math.min(retryDelay * 1.5, 15000); // cap — Railway just drops idle conns
      connect();
    }, retryDelay);
  };
}

function disconnect() {
  if (retryTimeout) { clearTimeout(retryTimeout); retryTimeout = null; }
  es?.close();
  es = null;
  boundEvents.clear();
}

function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    paused = true;
    disconnect();
  } else {
    paused = false;
    retryDelay = 3000;
    connect();
  }
}

function addSubscriber(handlers: Record<string, SSEHandler>) {
  for (const [name, fn] of Object.entries(handlers)) {
    let set = handlerRegistry.get(name);
    if (!set) { set = new Set(); handlerRegistry.set(name, set); }
    set.add(fn);
    bindEvent(name); // wire it onto a live connection if one already exists
  }
  subscriberCount++;

  if (!visibilityBound) {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    visibilityBound = true;
  }
  if (document.visibilityState !== 'hidden') { paused = false; connect(); }
  else paused = true;
}

function removeSubscriber(handlers: Record<string, SSEHandler>) {
  for (const [name, fn] of Object.entries(handlers)) {
    const set = handlerRegistry.get(name);
    if (set) { set.delete(fn); if (set.size === 0) handlerRegistry.delete(name); }
  }
  subscriberCount = Math.max(0, subscriberCount - 1);
  if (subscriberCount === 0) {
    disconnect();
    if (visibilityBound) {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      visibilityBound = false;
    }
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useSSE(handlers: Record<string, SSEHandler>) {
  // Snapshot stable wrapper fns so handler identity stays constant across renders
  // even though the consumer passes a fresh object literal each time.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const stableRef = useRef<Record<string, SSEHandler> | null>(null);

  if (stableRef.current === null) {
    const names = Object.keys(handlers);
    const stable: Record<string, SSEHandler> = {};
    for (const name of names) stable[name] = (data) => handlersRef.current[name]?.(data);
    stableRef.current = stable;
  }

  useEffect(() => {
    const stable = stableRef.current!;
    addSubscriber(stable);
    return () => removeSubscriber(stable);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- subscribe once; handlers tracked via ref
  }, []);
}
