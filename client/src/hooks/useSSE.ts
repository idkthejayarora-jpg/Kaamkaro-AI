import { useEffect, useRef } from 'react';
import { API_BASE } from '../lib/api';

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
 */
export function useSSE(handlers: Record<string, SSEHandler>) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers; // keep current without re-subscribing

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1000;
    let destroyed = false;

    function connect() {
      const token = localStorage.getItem('token');
      // Pass token as query param (EventSource doesn't support custom headers)
      const url = `${API_BASE}/events${token ? `?token=${token}` : ''}`;
      es = new EventSource(url);

      es.addEventListener('connected', () => {
        retryDelay = 1000; // reset on successful connect
      });

      // Register listeners for all event types
      const eventNames = Object.keys(handlersRef.current);
      for (const name of eventNames) {
        es.addEventListener(name, (ev: MessageEvent) => {
          try {
            const data = JSON.parse(ev.data);
            handlersRef.current[name]?.(data);
          } catch {
            // ignore parse errors
          }
        });
      }

      es.onerror = () => {
        es?.close();
        if (destroyed) return;
        retryTimeout = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, 30000);
          connect();
        }, retryDelay);
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      es?.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — handlers update via ref
}
