const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne, updateOne, deleteOne } = require('../utils/db');
const { authMiddleware } = require('../middleware/auth');
const { updateStaffStreak } = require('../utils/streak');
const { broadcast } = require('../utils/sse');

let Anthropic;
try { Anthropic = require('@anthropic-ai/sdk'); } catch {}

const router = express.Router();
router.use(authMiddleware);

// Model used for diary analysis — override via ANTHROPIC_MODEL env var on Railway
// claude-opus-4-5 gives the best name extraction; falls back to 3.5-sonnet if unavailable
const AI_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-5';

function getClient() {
  if (!Anthropic || !process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// Wrapper that retries with a safe fallback model if the primary model isn't found
async function callClaude(client, params) {
  try {
    return await client.messages.create({ model: AI_MODEL, ...params });
  } catch (err) {
    const isModelErr = err?.status === 404 || err?.status === 400 ||
      (err?.message || '').toLowerCase().includes('model');
    if (isModelErr && AI_MODEL !== 'claude-3-5-sonnet-20241022') {
      console.warn(`[Diary] Model "${AI_MODEL}" failed (${err.status}), retrying with claude-3-5-sonnet-20241022`);
      return await client.messages.create({ model: 'claude-3-5-sonnet-20241022', ...params });
    }
    throw err;
  }
}

// ── Fuzzy name matching ────────────────────────────────────────────────────────
// Handles typos, Hindi-English transliteration variations, missing vowels, etc.

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array(n + 1).fill(0).map((_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function normalizeName(name) {
  return name
    .toLowerCase()
    .trim()
    // Common Hindi/Hinglish vowel normalizations
    .replace(/ph/g, 'f')
    .replace(/bh/g, 'b')
    .replace(/kh/g, 'k')
    .replace(/gh/g, 'g')
    .replace(/sh/g, 's')
    .replace(/th/g, 't')
    .replace(/dh/g, 'd')
    // Common vowel variations (aa→a, ee→i, oo→u)
    .replace(/aa/g, 'a')
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/ou/g, 'u')
    .replace(/ei/g, 'i')
    .replace(/v/g, 'w')   // vijay/wijay
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameSimilarity(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return 1.0;
  // Token-level match: if all tokens of the shorter name match tokens of the longer
  const ta = na.split(' ');
  const tb = nb.split(' ');
  if (ta.some(t => tb.some(t2 => t === t2 && t.length > 2))) return 0.9;
  // Levenshtein similarity
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

function fuzzyMatchCustomer(spokenName, customers, threshold = 0.72) {
  if (!spokenName || !spokenName.trim()) return null;
  let best = null, bestScore = 0;
  for (const c of customers) {
    const score = nameSimilarity(spokenName, c.name);
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return bestScore >= threshold ? best : null;
}

// ── Routes ─────────────────────────────────────────────────────────────────────

// GET /api/diary
router.get('/', async (req, res) => {
  try {
    let entries = await readDB('diary');
    if (req.user.role === 'staff') {
      entries = entries.filter(e => e.staffId === req.user.id);
    }
    entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/diary/:id
router.get('/:id', async (req, res) => {
  try {
    const entries = await readDB('diary');
    const entry = entries.find(e => e.id === req.params.id);
    if (!entry) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'staff' && entry.staffId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/diary/:id — staff can delete their own entries; admin can delete any
router.delete('/:id', async (req, res) => {
  try {
    const entries = await readDB('diary');
    const entry = entries.find(e => e.id === req.params.id);
    if (!entry) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'staff' && entry.staffId !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete your own entries' });
    }
    await deleteOne('diary', req.params.id);
    broadcast('diary:deleted', { id: req.params.id });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/diary — submit a diary entry (text or transcribed voice)
router.post('/', async (req, res) => {
  try {
    const { content, date } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Content required' });

    const entry = {
      id: uuidv4(),
      staffId: req.user.id,
      staffName: req.user.name,
      content,
      date: date || new Date().toISOString().split('T')[0],
      status: 'processing',
      aiEntries: [],
      translatedContent: null,
      detectedLanguage: null,
      createdAt: new Date().toISOString(),
    };

    await insertOne('diary', entry);
    await updateStaffStreak(req.user.id);

    // Respond immediately so the UI is snappy
    res.status(202).json(entry);

    // Process async in background
    processDiaryEntry(entry.id, content, req.user.id, req.user.name).catch(console.error);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Core AI processing ─────────────────────────────────────────────────────────

/**
 * Robustly extract a JSON object from an AI response string.
 * Handles: markdown fences, leading/trailing text, nested objects.
 */
function extractJSON(text) {
  // Strip markdown fences
  let s = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // Try direct parse first (happy path)
  try { return JSON.parse(s); } catch {}

  // Find the outermost {...} block
  const start = s.indexOf('{');
  const end   = s.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch {}
  }

  return null;
}

async function processDiaryEntry(entryId, content, staffId, staffName) {
  try {
    const allCustomers = await readDB('customers');
    const customerList = allCustomers.map(c => ({ id: c.id, name: c.name }));

    const client = getClient();

    if (!client) {
      // ── No API key: extract names via regex heuristics + create new customers ──
      console.warn('[Diary] No ANTHROPIC_API_KEY — using local name-extraction fallback');

      const FALLBACK_STOPS = new Set([
        'general','client','customer','sir','madam','bhai','ji','the','and','but','for',
        'with','okay','done','yes','no','call','meeting','office','today','tomorrow',
        'morning','evening','aaj','kal','subah','shaam','unka','unhe','wo','woh',
        'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
      ]);

      // Extract: capitalised words AND common Hindi name patterns
      const candidateNames = new Set();
      // English-style capitalised words (min 3 chars)
      const capWords = content.match(/\b[A-Z][a-z]{2,}\b/g) || [];
      capWords.forEach(w => candidateNames.add(w));
      // Multi-word: "Rahul Kumar", "Priya Singh" etc.
      const bigramMatches = content.match(/\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/g) || [];
      bigramMatches.forEach(w => candidateNames.add(w));

      const now2 = new Date().toISOString();
      const entries = [];
      const createdInFallback = [];

      for (const name of candidateNames) {
        const nameLower = name.toLowerCase().trim();
        if (FALLBACK_STOPS.has(nameLower) || name.length < 3) continue;

        // Try fuzzy match against existing customers
        let resolved = fuzzyMatchCustomer(name, [...allCustomers, ...createdInFallback], 0.78);

        if (resolved) {
          // Update lastContact on match
          try { await updateOne('customers', resolved.id, { lastContact: now2 }); } catch {}
        } else {
          // Create new customer
          try {
            const newCust = {
              id: uuidv4(), name: titleCase(name), phone: '', email: '',
              assignedTo: staffId, status: 'lead', lastContact: now2,
              notes: `Auto-created from diary entry by ${staffName} (no AI key)`,
              notesList: [], tags: ['diary-import'], dealValue: null, createdAt: now2,
            };
            await insertOne('customers', newCust);
            allCustomers.push(newCust);
            createdInFallback.push(newCust);
            resolved = newCust;
            broadcast('customer:created', newCust);
            console.log(`[Diary fallback] ✅ Created customer: "${newCust.name}"`);
          } catch (err) {
            console.error('[Diary fallback] Failed to create customer:', err.message);
            continue;
          }
        }

        entries.push({
          spokenName: name,
          customerName: resolved.name,
          customerId: resolved.id,
          matchedCustomerName: resolved.name,
          matchedCustomerId: resolved.id,
          isNewCustomer: createdInFallback.some(c => c.id === resolved.id),
          date: null,
          notes: `Diary entry logged — AI analysis requires ANTHROPIC_API_KEY to be set on Railway.`,
          originalNotes: content.slice(0, 300),
          actionItems: [],
          sentiment: 'neutral',
          confidence: 0.4,
        });
      }

      if (entries.length === 0) {
        entries.push({
          spokenName: 'General', customerName: 'General', customerId: null,
          matchedCustomerName: null, isNewCustomer: false, date: null,
          notes: 'No customer names detected. Set ANTHROPIC_API_KEY on Railway for full AI analysis.',
          originalNotes: content.slice(0, 400),
          actionItems: ['Set ANTHROPIC_API_KEY in Railway environment variables'],
          sentiment: 'neutral', confidence: 0.2,
        });
      }

      const finalEntry = await updateOne('diary', entryId, {
        status: 'done', aiEntries: entries,
        translatedContent: null, detectedLanguage: 'hinglish',
        processedAt: new Date().toISOString(),
      });
      broadcast('diary:updated', finalEntry);
      return;
    }

    // ── AI path ────────────────────────────────────────────────────────────────
    const customerRef = customerList.length > 0
      ? customerList.map(c => `"${c.name}" [id:${c.id}]`).join('\n')
      : '(none yet — treat every name as a new customer)';

    const prompt = `You are a sales CRM assistant. Analyze this sales staff diary entry and extract structured data.

DIARY ENTRY:
"""
${content.slice(0, 5000)}
"""

KNOWN CUSTOMERS (match against these, use exact IDs):
${customerRef}

INSTRUCTIONS:
1. Detect the language: hindi / english / hinglish
2. Write a clear English translation/summary of the whole entry (2-4 sentences, professional tone — do NOT copy the raw text)
3. Find every customer or person mentioned (even briefly)
4. For each person: fuzzy-match against known customers (handle typos, nicknames, surname-only refs like "sharma ji", Hindi spellings like vijay/bijay)
5. For each customer entry write:
   - "notes": 1-2 sentence professional SUMMARY of what happened (what was discussed, outcome, next steps) — do NOT copy raw text verbatim
   - "actionItems": concrete follow-up actions if any
   - "sentiment": positive / neutral / negative based on how the interaction went

Respond ONLY with this JSON, no other text:
{
  "detectedLanguage": "hindi|english|hinglish",
  "translatedContent": "2-4 sentence professional English summary of the entire diary entry",
  "entries": [
    {
      "spokenName": "name as written in diary",
      "matchedCustomerName": "exact name from known list or null",
      "matchedCustomerId": "exact id from known list or null",
      "isNewCustomer": false,
      "date": "YYYY-MM-DD or null",
      "notes": "Professional summary of this interaction — what happened, outcome, mood",
      "originalNotes": "relevant original text snippet",
      "actionItems": ["specific follow-up action"],
      "sentiment": "positive|neutral|negative",
      "confidence": 0.9
    }
  ]
}`;

    const result = await callClaude(client, {
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });

    const rawText = result.content[0].text;
    console.log('[Diary] AI raw response (first 200):', rawText.slice(0, 200));

    let aiResult = extractJSON(rawText);

    if (!aiResult || !Array.isArray(aiResult.entries)) {
      console.error('[Diary] JSON extraction failed. Raw:', rawText.slice(0, 500));
      // Hard fallback: ask the model again with a stricter prompt
      try {
        const retry = await callClaude(client, {
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: `Extract customer names from this diary entry and return ONLY valid JSON:\n"${content.slice(0, 2000)}"\n\nReturn exactly this structure:\n{"detectedLanguage":"hinglish","translatedContent":"Brief professional summary","entries":[{"spokenName":"name as written","matchedCustomerName":null,"matchedCustomerId":null,"isNewCustomer":true,"date":null,"notes":"What happened with this customer","originalNotes":"","actionItems":[],"sentiment":"neutral","confidence":0.7}]}`
          }],
        });
        aiResult = extractJSON(retry.content[0].text);
      } catch {}
    }

    // Ultimate fallback if both attempts fail
    if (!aiResult) {
      aiResult = {
        detectedLanguage: 'hinglish',
        translatedContent: 'Could not auto-translate — see original entry.',
        entries: [],
      };
    }

    // ── Post-AI: resolve + auto-create customers ────────────────────────────
    // Words that look like names but aren't — don't auto-create these as customers
    const STOP_NAMES = new Set([
      'general','client','customer','sir','madam','bhai','ji','unka','unhe','wo','woh',
      'aaj','kal','subah','shaam','office','meeting','call','today','tomorrow','morning',
      'done','ok','okay','yes','no','the','and','but','for','with',
    ]);

    const newCustomers  = [];
    const resolvedEntries = [];
    const now = new Date().toISOString();

    for (const e of (aiResult.entries || [])) {
      const spokenName = (e.spokenName || '').trim();
      const nameLower  = spokenName.toLowerCase();
      const isGeneric  = !spokenName || STOP_NAMES.has(nameLower) || spokenName.length < 3;

      // Step 1: trust the AI's matched customer ID if it gave one
      let resolvedCustomer = null;
      if (e.matchedCustomerId) {
        resolvedCustomer = allCustomers.find(c => c.id === e.matchedCustomerId) || null;
        if (resolvedCustomer) console.log(`[Diary] AI matched "${spokenName}" → "${resolvedCustomer.name}"`);
      }

      // Step 2: server-side fuzzy match as safety net (catches cases where AI got ID wrong)
      if (!resolvedCustomer && !isGeneric) {
        resolvedCustomer = fuzzyMatchCustomer(spokenName, [...allCustomers, ...newCustomers]);
        if (resolvedCustomer) {
          console.log(`[Diary] Fuzzy matched "${spokenName}" → "${resolvedCustomer.name}"`);
        }
      }

      // Step 3: no match → auto-create as new customer assigned to this staff member
      if (!resolvedCustomer && !isGeneric) {
        try {
          const newCust = {
            id: uuidv4(),
            name: titleCase(spokenName),
            phone: '',
            email: '',
            assignedTo: staffId,
            status: 'lead',
            lastContact: now,
            notes: `Auto-created from diary entry by ${staffName}`,
            notesList: [],
            tags: ['diary-import'],
            dealValue: null,
            createdAt: now,
          };
          await insertOne('customers', newCust);
          resolvedCustomer = newCust;
          newCustomers.push(newCust);
          allCustomers.push(newCust);
          // Push to Customers page in real-time so it appears instantly
          broadcast('customer:created', newCust);
          console.log(`[Diary] ✅ Auto-created customer: "${newCust.name}"`);
        } catch (err) {
          console.error('[Diary] ❌ Failed to create customer:', err.message);
        }
      }

      // Step 4: update lastContact on existing customers found in diary
      if (resolvedCustomer && !newCustomers.find(c => c.id === resolvedCustomer.id)) {
        try {
          await updateOne('customers', resolvedCustomer.id, { lastContact: now });
        } catch {}
      }

      const isNew   = newCustomers.some(c => c.id === resolvedCustomer?.id);
      const summary = e.notes && e.notes.trim().length > 10 ? e.notes.trim() : `Interaction logged from diary entry on ${new Date().toLocaleDateString('en-IN')}`;

      resolvedEntries.push({
        spokenName:          spokenName || 'General',
        customerName:        resolvedCustomer?.name || spokenName || 'General',
        customerId:          resolvedCustomer?.id   || null,
        matchedCustomerName: resolvedCustomer?.name || null,
        isNewCustomer:       isNew,
        autoCreatedId:       isNew ? resolvedCustomer?.id : null,
        date:                e.date        || null,
        notes:               summary,
        originalNotes:       e.originalNotes || e.notes || '',
        actionItems:         Array.isArray(e.actionItems) ? e.actionItems : [],
        sentiment:           ['positive','neutral','negative'].includes(e.sentiment) ? e.sentiment : 'neutral',
        confidence:          typeof e.confidence === 'number' ? e.confidence : 0.5,
      });
    }

    // Log auto-created customers count
    if (newCustomers.length > 0) {
      console.log(`[Diary] ✅ Created ${newCustomers.length} new customers from entry by ${staffName}`);
    }

    const finalEntry = await updateOne('diary', entryId, {
      status: 'done',
      aiEntries: resolvedEntries,
      translatedContent: aiResult.translatedContent || null,
      detectedLanguage: aiResult.detectedLanguage || null,
      processedAt: new Date().toISOString(),
    });

    // 🔴 Real-time push — all connected browser tabs get this instantly
    broadcast('diary:updated', finalEntry);

  } catch (err) {
    const errMsg = err?.message || String(err);
    const errStatus = err?.status || err?.statusCode || 'unknown';
    console.error(`[Diary] ❌ Processing error (HTTP ${errStatus}): ${errMsg}`);
    if (err?.error) console.error('[Diary] API error body:', JSON.stringify(err.error));
    // Store the actual error so the UI can show it
    const userFacingError = errStatus === 401
      ? 'Invalid ANTHROPIC_API_KEY — check Railway environment variables'
      : errStatus === 404 || (errMsg.includes('model'))
        ? `Model "${AI_MODEL}" not found — set ANTHROPIC_MODEL env var on Railway`
        : errStatus === 429
          ? 'API rate limit hit — will retry automatically on re-analyze'
          : errMsg.slice(0, 200);
    const errEntry = await updateOne('diary', entryId, {
      status: 'error',
      error: userFacingError,
    });
    broadcast('diary:updated', errEntry);
  }
}

// POST /api/diary/:id/reanalyze — re-run AI analysis on an existing entry
router.post('/:id/reanalyze', async (req, res) => {
  try {
    const entries = await readDB('diary');
    const entry = entries.find(e => e.id === req.params.id);
    if (!entry) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'staff' && entry.staffId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await updateOne('diary', req.params.id, {
      status: 'processing', aiEntries: [], translatedContent: null,
      detectedLanguage: null, error: null,
    });
    const updated = { ...entry, status: 'processing', aiEntries: [], translatedContent: null, detectedLanguage: null };
    broadcast('diary:updated', updated);
    res.json(updated);
    processDiaryEntry(req.params.id, entry.content, entry.staffId, entry.staffName).catch(console.error);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

function titleCase(str) {
  return str.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
}

module.exports = router;
