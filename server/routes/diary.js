const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne, updateOne, deleteOne } = require('../utils/db');
const { authMiddleware } = require('../middleware/auth');
const { updateStaffStreak } = require('../utils/streak');
const { broadcast } = require('../utils/sse');

// Anthropic is optional — only used if API key + credits are present
let Anthropic;
try { Anthropic = require('@anthropic-ai/sdk'); } catch {}

const router = express.Router();
router.use(authMiddleware);

const AI_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';

function getClient() {
  if (!Anthropic || !process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ── Fuzzy name matching ────────────────────────────────────────────────────────

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array(n + 1).fill(0).map((_, j) => i === 0 ? j : j === 0 ? i : 0)
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function normalizeName(name) {
  return name.toLowerCase().trim()
    .replace(/ph/g, 'f').replace(/bh/g, 'b').replace(/kh/g, 'k')
    .replace(/gh/g, 'g').replace(/sh/g, 's').replace(/th/g, 't').replace(/dh/g, 'd')
    .replace(/aa/g, 'a').replace(/ee/g, 'i').replace(/oo/g, 'u')
    .replace(/ou/g, 'u').replace(/ei/g, 'i').replace(/v/g, 'w')
    .replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

function nameSimilarity(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return 1.0;
  const ta = na.split(' ');
  const tb = nb.split(' ');
  if (ta.some(t => tb.some(t2 => t === t2 && t.length > 2))) return 0.9;
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

function titleCase(str) {
  return str.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
}

// ── Stop words — words that look like names but aren't ────────────────────────
const STOP_WORDS = new Set([
  'general','client','customer','sir','madam','bhai','ji','unka','unhe','wo','woh',
  'aaj','kal','subah','shaam','office','meeting','call','today','tomorrow','morning',
  'evening','done','ok','okay','yes','no','the','and','but','for','with','this',
  'that','from','have','they','their','monday','tuesday','wednesday','thursday',
  'friday','saturday','sunday','january','february','march','april','may','june',
  'july','august','september','october','november','december',
]);

// ── Built-in NLP functions — zero external dependencies ───────────────────────

/**
 * Detect if text is Hindi (Devanagari), Hinglish (Hindi words in Roman script),
 * or plain English.
 */
function detectLanguage(text) {
  // Devanagari Unicode range → definite Hindi
  if (/[\u0900-\u097F]/.test(text)) return 'hindi';

  const hinglishMarkers = [
    'aaj','kal','baat','kiya','hua','hui','gaya','gaye','mila','mile','milna',
    'nahi','nahin','hai','hain','tha','thi','the','se','ko','ne','ka','ki','ke',
    'aur','lekin','pakki','raazi','khush','naraaz','matlab','thoda','bohot',
    'bahut','phir','sab','abhi','pehle','baad','unse','inse','unka','mujhe',
    'humne','aapne','unhone','wahan','yahan','kab','kaise','kyun','kya',
    'accha','theek','shukriya','bilkul','zaroor',
  ];
  const words = text.toLowerCase().split(/\W+/).filter(Boolean);
  const count = words.filter(w => hinglishMarkers.includes(w)).length;
  return (count >= 2 || (words.length > 5 && count / words.length > 0.08))
    ? 'hinglish'
    : 'english';
}

/**
 * Extract person/customer names from diary text using context patterns.
 * Handles English, Hinglish, and mixed text.
 */
function extractNamesFromText(text) {
  const names = new Set();

  // Context-aware patterns (highest confidence — name appears near action words)
  const contextPatterns = [
    // "called Rahul Kumar", "met Priya", "spoke with Sharma"
    /(?:called|met|meeting with|visited|contacted|spoke with|talked to|baat ki|milne|milaa|mile)\s+([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)/g,
    // "Vijay ne", "Sharma ko", "Rahul se"
    /([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\s+(?:ne|ko|se|ka|ki|ke|bhi)\b/g,
    // "Sharma ji", "Rahul bhai", "Kumar sahab"
    /([A-Za-z]{3,}(?:\s+[A-Za-z]{2,})?)\s+(?:ji|sahab|bhai|sir|madam)\b/gi,
    // "Mr. Gupta", "Mrs. Sharma", "Dr. Verma"
    /(?:Mr|Mrs|Ms|Dr|Shri|Smt)\.?\s+([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)/g,
    // "customer Ravi called" / "client Sunita said"
    /(?:customer|client|party)\s+([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)/gi,
  ];

  for (const pattern of contextPatterns) {
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const name = titleCase(m[1].trim());
      if (!STOP_WORDS.has(name.toLowerCase()) && name.length >= 3) {
        names.add(name);
      }
    }
  }

  // Bigrams: two consecutive capitalized words (e.g. "Rahul Kumar")
  (text.match(/\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/g) || []).forEach(n => {
    if (!STOP_WORDS.has(n.toLowerCase())) names.add(n);
  });

  // Single capitalized words — only if nothing else was found
  if (names.size === 0) {
    (text.match(/\b[A-Z][a-z]{2,}\b/g) || []).forEach(w => {
      if (!STOP_WORDS.has(w.toLowerCase()) && w.length >= 3) names.add(w);
    });
  }

  return [...names];
}

/**
 * Detect sentiment from sales-relevant keyword lists.
 */
function detectSentimentLocal(text) {
  const lower = text.toLowerCase();
  const positive = [
    'deal','confirmed','agreed','interested','happy','closed','success','sold',
    'bought','approved','order','payment','received','signed','contract',
    'pakki','raazi','khush','haan','accha','bilkul','zaroor','positive',
  ];
  const negative = [
    'rejected','angry','upset','cancelled','refused','complaint','problem',
    'issue','failed','loss','dispute','return','refund','delay','pending',
    'naraaz','mana','nahi','nahin','bad','difficult',
  ];
  let score = 0;
  positive.forEach(w => { if (lower.includes(w)) score++; });
  negative.forEach(w => { if (lower.includes(w)) score--; });
  return score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
}

/**
 * Extract actionable follow-up items using keyword pattern matching.
 */
function extractActionItemsLocal(text) {
  const checks = [
    { r: /follow.?up|followup/i,                             a: 'Follow up with customer'  },
    { r: /(?:send|quote|proposal|estimate|quotation|bhej)/i, a: 'Send quote/proposal'      },
    { r: /(?:call back|callback|phone back|ring)/i,          a: 'Call back customer'        },
    { r: /(?:schedule|appointment|milenge|milna hai)/i,      a: 'Schedule meeting'          },
    { r: /(?:payment|invoice|bill|dues|baaki)/i,             a: 'Follow up on payment'      },
    { r: /(?:demo|demonstration|presentation|dikhana)/i,     a: 'Arrange product demo'      },
    { r: /(?:deliver|delivery|dispatch|courier|bhejna)/i,    a: 'Arrange delivery'          },
  ];
  return [...new Set(checks.filter(c => c.r.test(text)).map(c => c.a))].slice(0, 4);
}

/**
 * Build a structured English summary from the extracted NLP data.
 * This is shown as "English Summary" in the UI when no AI translation is available.
 */
function buildEnglishSummary(names, lang, sentiment, actions, staffName) {
  const langLabel = lang === 'hindi' ? 'Hindi' : lang === 'hinglish' ? 'Hindi/Hinglish' : 'English';
  const nameStr   = names.length > 0 ? names.join(', ') : 'no specific customers identified';
  const sentStr   = sentiment === 'positive'
    ? 'Overall positive outcome.'
    : sentiment === 'negative'
    ? 'Some challenges or objections noted.'
    : 'Standard interaction.';
  const actStr = actions.length > 0
    ? ` Next steps: ${actions.join('; ')}.`
    : '';
  return `Entry recorded in ${langLabel} by ${staffName}. Customers mentioned: ${nameStr}. ${sentStr}${actStr}`;
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
  } catch {
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
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/diary/:id
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
  } catch {
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

    // Respond immediately — processing happens async in background
    res.status(202).json(entry);
    processDiaryEntry(entry.id, content, req.user.id, req.user.name).catch(console.error);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/diary/:id/reanalyze
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
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Core processing ────────────────────────────────────────────────────────────

/**
 * Main diary processing function.
 *
 * PHASE 1 (always runs, always completes):
 *   Built-in NLP → extract names, sentiment, actions → auto-create customers →
 *   save entry as 'done' with English summary.
 *
 * PHASE 2 (optional, best-effort):
 *   If ANTHROPIC_API_KEY is set AND credits are available, try AI for a richer
 *   translation and better notes. If AI fails for ANY reason, the Phase-1 result
 *   stands — the diary entry is never left in 'error' state.
 */
async function processDiaryEntry(entryId, content, staffId, staffName) {
  // ── PHASE 1: Built-in NLP ──────────────────────────────────────────────────
  let allCustomers = [];
  try { allCustomers = await readDB('customers'); } catch {}

  const lang        = detectLanguage(content);
  const names       = extractNamesFromText(content);
  const sentiment   = detectSentimentLocal(content);
  const actions     = extractActionItemsLocal(content);
  const summary     = buildEnglishSummary(names, lang, sentiment, actions, staffName);
  const now         = new Date().toISOString();

  const newCustomers = [];
  const localEntries = [];

  for (const name of names) {
    let resolved = fuzzyMatchCustomer(name, [...allCustomers, ...newCustomers], 0.78);

    if (resolved) {
      // Update lastContact timestamp on existing customer
      try { await updateOne('customers', resolved.id, { lastContact: now }); } catch {}
    } else {
      // Auto-create new customer
      try {
        const newCust = {
          id: uuidv4(), name: titleCase(name), phone: '', email: '',
          assignedTo: staffId, status: 'lead', lastContact: now,
          notes: `Auto-created from diary entry by ${staffName}`,
          notesList: [], tags: ['diary-import'], dealValue: null, createdAt: now,
        };
        await insertOne('customers', newCust);
        allCustomers.push(newCust);
        newCustomers.push(newCust);
        resolved = newCust;
        broadcast('customer:created', newCust);
        console.log(`[Diary NLP] ✅ Created customer: "${newCust.name}"`);
      } catch (e) {
        console.error('[Diary NLP] Customer create failed:', e.message);
        continue;
      }
    }

    const isNew = newCustomers.some(c => c.id === resolved.id);
    const noteText = sentiment === 'positive'
      ? 'Positive interaction logged.'
      : sentiment === 'negative'
      ? 'Interaction noted — follow up required.'
      : 'Interaction logged from diary entry.';

    localEntries.push({
      spokenName:          name,
      customerName:        resolved.name,
      customerId:          resolved.id,
      matchedCustomerName: resolved.name,
      matchedCustomerId:   resolved.id,
      isNewCustomer:       isNew,
      autoCreatedId:       isNew ? resolved.id : null,
      date:                null,
      notes:               actions.length > 0 ? `${noteText} Next: ${actions[0]}.` : noteText,
      originalNotes:       content.slice(0, 400),
      actionItems:         actions,
      sentiment,
      confidence:          0.65,
    });
  }

  // If no names found, still log the entry as a general note
  if (localEntries.length === 0) {
    localEntries.push({
      spokenName: 'General', customerName: 'General', customerId: null,
      matchedCustomerName: null, isNewCustomer: false, date: null,
      notes: actions.length > 0
        ? `General activity logged. Next: ${actions[0]}.`
        : 'No specific customer names detected in this entry.',
      originalNotes:  content.slice(0, 400),
      actionItems:    actions,
      sentiment,
      confidence:     0.3,
    });
  }

  // Save immediately — diary is DONE after Phase 1
  const savedEntry = await updateOne('diary', entryId, {
    status:           'done',
    aiEntries:        localEntries,
    translatedContent: summary,
    detectedLanguage:  lang,
    processedAt:       now,
  });
  broadcast('diary:updated', savedEntry);

  if (newCustomers.length > 0) {
    console.log(`[Diary NLP] Created ${newCustomers.length} new customer(s) for ${staffName}`);
  }

  // ── PHASE 2: Optional AI enhancement ──────────────────────────────────────
  // Skipped entirely if no API key. On ANY error, local result stands.
  const client = getClient();
  if (!client) return;

  try {
    const customerRef = allCustomers.length > 0
      ? allCustomers.map(c => `"${c.name}" [id:${c.id}]`).join('\n')
      : '(none yet)';

    const aiPrompt = `You are a bilingual sales CRM assistant fluent in Hindi, Hinglish, and English.

DIARY ENTRY:
"""
${content.slice(0, 4000)}
"""

KNOWN CUSTOMERS:
${customerRef}

Provide a complete, natural English translation of the ENTIRE diary entry (not a summary — full translation sentence by sentence), then extract customer interactions.

Respond ONLY with this JSON:
{
  "detectedLanguage": "hindi|english|hinglish",
  "translatedContent": "Complete natural English translation in first person",
  "entries": [
    {
      "spokenName": "name as written",
      "matchedCustomerName": "exact name from known list or null",
      "matchedCustomerId": "exact id from known list or null",
      "isNewCustomer": false,
      "date": null,
      "notes": "1-2 sentence professional English summary",
      "originalNotes": "original text about this person",
      "actionItems": ["follow-up action"],
      "sentiment": "positive|neutral|negative",
      "confidence": 0.9
    }
  ]
}`;

    let aiResult;
    try {
      const res = await client.messages.create({
        model: AI_MODEL, max_tokens: 3000,
        messages: [{ role: 'user', content: aiPrompt }],
      });
      aiResult = extractJSON(res.content[0].text);
    } catch (err) {
      // Try fallback model on model-not-found errors
      if ((err?.status === 404 || err?.status === 400) && AI_MODEL !== 'claude-3-5-haiku-20241022') {
        const res2 = await client.messages.create({
          model: 'claude-3-5-haiku-20241022', max_tokens: 3000,
          messages: [{ role: 'user', content: aiPrompt }],
        });
        aiResult = extractJSON(res2.content[0].text);
      } else {
        throw err;
      }
    }

    if (!aiResult || !Array.isArray(aiResult.entries) || aiResult.entries.length === 0) {
      return; // Bad response — local result stands
    }

    // Re-run customer resolution with AI-detected names
    const aiNewCustomers = [];
    const aiEntries = [];
    const nowAI = new Date().toISOString();

    for (const e of aiResult.entries) {
      const spokenName = (e.spokenName || '').trim();
      const nameLower  = spokenName.toLowerCase();
      if (!spokenName || STOP_WORDS.has(nameLower) || spokenName.length < 3) continue;

      let resolved = null;
      if (e.matchedCustomerId) {
        resolved = allCustomers.find(c => c.id === e.matchedCustomerId) || null;
      }
      if (!resolved) {
        resolved = fuzzyMatchCustomer(spokenName, [...allCustomers, ...aiNewCustomers]);
      }
      if (!resolved) {
        try {
          const newCust = {
            id: uuidv4(), name: titleCase(spokenName), phone: '', email: '',
            assignedTo: staffId, status: 'lead', lastContact: nowAI,
            notes: `Auto-created from diary entry by ${staffName}`,
            notesList: [], tags: ['diary-import'], dealValue: null, createdAt: nowAI,
          };
          await insertOne('customers', newCust);
          allCustomers.push(newCust);
          aiNewCustomers.push(newCust);
          resolved = newCust;
          broadcast('customer:created', newCust);
          console.log(`[Diary AI] ✅ Created customer: "${newCust.name}"`);
        } catch { continue; }
      } else if (!aiNewCustomers.find(c => c.id === resolved.id)) {
        try { await updateOne('customers', resolved.id, { lastContact: nowAI }); } catch {}
      }

      const isNew = aiNewCustomers.some(c => c.id === resolved.id);
      aiEntries.push({
        spokenName,
        customerName:        resolved.name,
        customerId:          resolved.id,
        matchedCustomerName: resolved.name,
        matchedCustomerId:   resolved.id,
        isNewCustomer:       isNew,
        autoCreatedId:       isNew ? resolved.id : null,
        date:                e.date   || null,
        notes:               e.notes  || '',
        originalNotes:       e.originalNotes || '',
        actionItems:         Array.isArray(e.actionItems) ? e.actionItems : [],
        sentiment:           ['positive','neutral','negative'].includes(e.sentiment) ? e.sentiment : 'neutral',
        confidence:          typeof e.confidence === 'number' ? e.confidence : 0.8,
      });
    }

    if (aiEntries.length > 0) {
      const enhanced = await updateOne('diary', entryId, {
        aiEntries:         aiEntries,
        translatedContent: aiResult.translatedContent || summary,
        detectedLanguage:  aiResult.detectedLanguage  || lang,
      });
      broadcast('diary:updated', enhanced);
      console.log(`[Diary AI] ✅ Enhanced entry ${entryId} with AI translation`);
    }

  } catch (err) {
    // AI failed — local Phase-1 result already saved and broadcast. Just log it.
    const msg = (err?.message || String(err)).slice(0, 120);
    console.warn(`[Diary AI] Enhancement skipped (${err?.status || 'err'}): ${msg}`);
  }
}

/**
 * Robustly extract a JSON object from an AI response string.
 */
function extractJSON(text) {
  let s = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(s); } catch {}
  const start = s.indexOf('{');
  const end   = s.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch {}
  }
  return null;
}

module.exports = router;
