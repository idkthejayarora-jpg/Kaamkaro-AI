import { useEffect, useRef } from 'react';

type SSEHandler = (data: unknown) => void;

/**
 * Subscribe to one or more Server-Sent Events from /api/events.
 *
 * Usage:
 *   useSSE({
 *     'diary:updated': (entry) => setEntries(prev => upsert(prev, entry)),
 *     'diary:deleted': ({ id }) => setEntries(prev => prev.filter(e => e.id !== id)),
 *   });
 *
 * The hook reconnects automatically on disconnect (exponential back-off).
 * When the page is hidden (e.g. app in background on mobile) SSE is paused to
 * save battery and connections. It reconnects immediately on visibility restore.
 */
export function useSSE(handlers: Record<string, SSEHandler>) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers; // keep current without re-subscribing

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    // Start at 3s — Railway proxy has a ~60s idle timeout so connections drop;
    // reconnect quickly but not so fast we spam the server
    let retryDelay = 3000;
    let destroyed = false;
    let paused = false;

    function disconnect() {
      if (retryTimeout) { clearTimeout(retryTimeout); retryTimeout = null; }
      es?.close();
      es = null;
    }

    function connect() {
      if (destroyed || paused) return;
      const token = localStorage.getItem('kk_token');
      const url = `/api/events${token ? `?token=${token}` : ''}`;
      es = new EventSource(url);

      es.addEventListener('connected', () => {
        retryDelay = 3000; // reset on successful connect
      });

      // Register all event listeners declared by the consumer
      const eventNames = Object.keys(handlersRef.current);
      for (const name of eventNames) {
        es.addEventListener(name, (ev: MessageEvent) => {
          try {
            const data = JSON.parse(ev.data);
            handlersRef.current[name]?.(data);
          } catch { /* ignore malformed events */ }
        });
      }

      es.onerror = () => {
        es?.close();
        es = null;
        if (destroyed || paused) return;
        retryTimeout = setTimeout(() => {
          // Cap at 15s — no need to wait long, Railway just drops idle conns
          retryDelay = Math.min(retryDelay * 1.5, 15000);
          connect();
        }, retryDelay);
      };
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        // Page went to background — pause SSE to save battery/connections
        paused = true;
        disconnect();
      } else {
        // Page became visible — reconnect immediately
        paused = false;
        retryDelay = 3000; // reset back-off
        connect();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Only connect if page is already visible
    if (document.visibilityState !== 'hidden') {
      connect();
    } else {
      paused = true;
    }

    return () => {
      destroyed = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — handlers update via ref
}
