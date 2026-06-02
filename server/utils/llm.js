/**
 * Unified LLM client — one place every AI call in the app goes through.
 *
 * Why this exists:
 *   1. FUTURE-PROOFING — model IDs were hard-coded in 4 different route files.
 *      Anthropic retires old models on a schedule, so those would silently 404
 *      after a year or two. Here, calls run through a single fallback chain.
 *   2. PROVIDER SWAP — flip to a locally-hosted, OpenAI-compatible model
 *      (Ollama / LM Studio / llama.cpp / vLLM) with env vars, no code changes,
 *      so you can drop token costs entirely whenever you have hardware for it.
 *
 * Switching to local (no Anthropic tokens):
 *     AI_PROVIDER=local
 *     AI_BASE_URL=http://your-host:11434/v1     # Ollama default shown
 *     AI_LOCAL_MODEL=llama3.1                    # any model your server has
 *   (AI_BASE_URL alone also enables local mode.)
 *
 * Staying on Anthropic (default):
 *     ANTHROPIC_API_KEY=...
 *     ANTHROPIC_MODEL=claude-haiku-4-5           # optional; prepended to chain
 *
 * Every call returns the Anthropic response shape — { content: [{ type, text }] } —
 * so existing callers that read `res.content[0].text` keep working unchanged.
 */

let Anthropic;
try { Anthropic = require('@anthropic-ai/sdk'); } catch { /* SDK optional */ }

// Anthropic model preference order — first that works at runtime wins.
const AI_MODELS = [
  process.env.ANTHROPIC_MODEL,    // explicit override, if set
  'claude-haiku-4-5',             // current cheap default
  'claude-3-5-haiku-20241022',    // stable fallback
  'claude-3-haiku-20240307',      // oldest fallback
].filter(Boolean);

// Local OpenAI-compatible endpoint (enabled by AI_PROVIDER=local or AI_BASE_URL).
const LOCAL_BASE  = process.env.AI_BASE_URL
  || (process.env.AI_PROVIDER === 'local' ? 'http://localhost:11434/v1' : null);
const LOCAL_MODEL = process.env.AI_LOCAL_MODEL || 'llama3.1';
const LOCAL_KEY   = process.env.AI_LOCAL_API_KEY || 'local'; // most local servers ignore it

const useLocal = () => !!LOCAL_BASE;

// Once billing fails on Anthropic, stop hammering the API for this process.
let _billingFailed = false;
function isBillingErr(err) {
  return err?.status === 400 &&
    String(err?.message || err?.error?.error?.message || '').toLowerCase().includes('credit');
}

/**
 * Returns an opaque client handle, or null when no provider is usable.
 * Callers keep their existing `if (!client) { ...graceful fallback... }` guards.
 */
function getClient() {
  if (useLocal()) return { __local: true };
  if (_billingFailed) return null;
  if (!Anthropic || !process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// Convert Anthropic-style params → OpenAI chat, call local server, return Anthropic shape.
async function localCreate(params) {
  const messages = [];
  if (params.system) messages.push({ role: 'system', content: String(params.system) });
  for (const m of (params.messages || [])) {
    const content = typeof m.content === 'string'
      ? m.content
      : Array.isArray(m.content) ? m.content.map(b => b.text || '').join('\n') : String(m.content || '');
    messages.push({ role: m.role, content });
  }

  const res = await fetch(`${LOCAL_BASE.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LOCAL_KEY}` },
    body: JSON.stringify({
      model:       LOCAL_MODEL,
      messages,
      max_tokens:  params.max_tokens ?? 1024,
      temperature: params.temperature ?? 0.7,
      stream:      false,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const e = new Error(`local LLM ${res.status}: ${body.slice(0, 200)}`);
    e.status = res.status;
    throw e;
  }
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content ?? '';
  return { content: [{ type: 'text', text }], _provider: 'local', usage: json.usage };
}

/**
 * Create a message. `params` is the Anthropic shape minus `model`
 * ({ system?, messages, max_tokens, temperature? }). A `model` in params is
 * ignored — the chain/local config decides. Returns the Anthropic response shape.
 *
 * `client` is whatever getClient() returned (kept for call-site compatibility).
 */
async function aiCreate(client, params) {
  if (useLocal() || client?.__local) return localCreate(params);

  let lastErr;
  for (const model of AI_MODELS) {
    try {
      return await client.messages.create({ ...params, model });
    } catch (err) {
      if (isBillingErr(err)) { _billingFailed = true; throw err; }
      const status = err?.status;
      if (status === 400 || status === 404 || status === 422) { lastErr = err; continue; } // bad model → try next
      throw err; // auth / rate-limit / network → bubble up
    }
  }
  throw lastErr;
}

module.exports = { getClient, aiCreate, isBillingErr, useLocal, AI_MODELS };
