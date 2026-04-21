// ─────────────────────────────────────────────────────────────────────────────
// Server-Sent Events (SSE) broadcaster
// Usage: require('./utils/sse').broadcast('diary:updated', { id: '...' })
// ─────────────────────────────────────────────────────────────────────────────

const clients = new Set();

/**
 * Register a new SSE client response object.
 * Sends headers and a welcome event.
 */
function addClient(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Nginx: disable buffering
  res.flushHeaders();

  // Keep-alive ping every 25 seconds (prevents proxy timeouts)
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(ping); }
  }, 25000);

  // Send a connected event
  res.write(`event: connected\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);

  clients.add(res);

  // Clean up when client disconnects
  res.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

/**
 * Broadcast an event to all connected SSE clients.
 * @param {string} event  - Event name (e.g. "diary:updated", "task:updated")
 * @param {object} data   - JSON-serialisable payload
 */
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch { clients.delete(res); }
  }
}

module.exports = { addClient, broadcast };
