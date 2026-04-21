const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne, updateOne, deleteOne } = require('../utils/db');
const { authMiddleware } = require('../middleware/auth');
const { updateStaffStreak } = require('../utils/streak');

let Anthropic;
try { Anthropic = require('@anthropic-ai/sdk'); } catch {}

const router = express.Router();
router.use(authMiddleware);

function getClient() {
  if (!Anthropic || !process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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

async function processDiaryEntry(entryId, content, staffId, staffName) {
  try {
    // Load ALL customers — AI will fuzzy-match across the entire DB
    const allCustomers = await readDB('customers');

    const customerList = allCustomers.map(c => ({
      id: c.id,
      name: c.name,
      assignedTo: c.assignedTo,
    }));

    const client = getClient();
    let aiResult = null;

    if (client) {
      const prompt = `You are Kamal AI, analyzing a sales staff member's daily work diary.
The entry may be written in Hindi, English, or Hinglish (mixed Hindi-English). Your job is to understand it fully regardless of language.

EXISTING CUSTOMERS IN DATABASE:
${customerList.length > 0
  ? customerList.map(c => `- "${c.name}" (id: ${c.id})`).join('\n')
  : '(No customers yet)'}

DIARY ENTRY (may be in Hindi / Hinglish / English):
---
${content.slice(0, 6000)}
---

YOUR TASKS:
1. Detect language (hindi / english / hinglish)
2. Translate the FULL entry to clear, professional English
3. Extract EVERY customer interaction or mention — even brief ones
4. For each customer name found:
   - Match against the existing customer list using fuzzy logic (handle typos, Hindi spellings, short forms, nicknames)
   - If "rahul" → likely "Rahul Sharma" if that exists; "vikrum" → "Vikram"; "sharma ji" → match surname
   - If genuinely NO match exists (not just a typo), mark as new customer
5. Summarize each interaction in clear English
6. Extract action items from the entry

IMPORTANT MATCHING RULES:
- Be aggressive in matching — prefer matching over creating new
- Common mistakes to handle: doubled letters (Meera/Mira), missing letters (Arun/Arjun), Hindi spellings (Vijay/Bijay, Suresh/Suresh)
- First-name only mentions should match against known customers by first name
- "client", "customer", "unka", "unhe", "wo", "woh" refer to the last mentioned customer

Return ONLY valid JSON (no markdown, no explanation):
{
  "detectedLanguage": "hindi|english|hinglish",
  "translatedContent": "Full English translation of the diary entry, natural and professional",
  "entries": [
    {
      "spokenName": "exact name/reference as written in diary",
      "matchedCustomerName": "matched name from DB list, or null if new",
      "matchedCustomerId": "matched id from DB list, or null if new",
      "isNewCustomer": true,
      "date": "YYYY-MM-DD or null",
      "notes": "clear English summary of what happened with this customer",
      "originalNotes": "the original Hinglish/Hindi text about this customer",
      "actionItems": ["item1"],
      "sentiment": "positive|neutral|negative",
      "confidence": 0.85
    }
  ]
}`;

      const result = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }],
      });

      try {
        const raw = result.content[0].text.trim()
          .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        aiResult = JSON.parse(raw);
      } catch (parseErr) {
        console.error('Diary AI parse error:', parseErr.message);
        // Fallback: at least return translation attempt
        aiResult = {
          detectedLanguage: 'hinglish',
          translatedContent: null,
          entries: [{ spokenName: 'General', matchedCustomerName: null, matchedCustomerId: null, isNewCustomer: false, date: null, notes: content.slice(0, 300), originalNotes: content.slice(0, 300), actionItems: [], sentiment: 'neutral', confidence: 0.3 }],
        };
      }
    } else {
      // No AI key — do simple line-based extraction with fuzzy matching
      const lines = content.split('\n').filter(l => l.trim().length > 10);
      aiResult = {
        detectedLanguage: 'hinglish',
        translatedContent: null,
        entries: lines.slice(0, 5).map(line => {
          const matched = fuzzyMatchCustomer(
            // grab first capitalized word as likely name
            (line.match(/[A-Z][a-z]+/g) || [])[0] || '',
            allCustomers
          );
          return {
            spokenName: matched?.name || 'General',
            matchedCustomerName: matched?.name || null,
            matchedCustomerId: matched?.id || null,
            isNewCustomer: false,
            date: null,
            notes: line.trim(),
            originalNotes: line.trim(),
            actionItems: [],
            sentiment: 'neutral',
            confidence: 0.35,
          };
        }),
      };
    }

    // ── Post-AI: resolve + auto-create customers ────────────────────────────
    const newCustomers = []; // customers created during this run
    const resolvedEntries = [];

    for (const e of (aiResult.entries || [])) {
      const spokenName = (e.spokenName || '').trim();
      const isGeneric  = !spokenName || spokenName.toLowerCase() === 'general';

      // Step 1: trust the AI's matched customer ID if it gave one
      let resolvedCustomer = null;
      if (e.matchedCustomerId) {
        resolvedCustomer = allCustomers.find(c => c.id === e.matchedCustomerId) || null;
      }

      // Step 2: server-side fuzzy match as a safety net
      // (also searches any customers we created earlier in this same entry)
      if (!resolvedCustomer && !isGeneric) {
        resolvedCustomer = fuzzyMatchCustomer(spokenName, [...allCustomers, ...newCustomers]);
        if (resolvedCustomer) {
          console.log(`[Diary] Fuzzy matched "${spokenName}" → "${resolvedCustomer.name}"`);
        }
      }

      // Step 3: no match found at all → auto-create the customer
      // We do NOT rely on the AI's isNewCustomer flag — the fuzzy match is the truth
      if (!resolvedCustomer && !isGeneric && spokenName.length >= 2) {
        try {
          const newCust = {
            id: uuidv4(),
            name: titleCase(spokenName),
            phone: '',
            email: '',
            assignedTo: staffId,
            status: 'lead',
            lastContact: null,
            notes: `Auto-created from diary entry by ${staffName}`,
            tags: ['diary-import'],
            dealValue: null,
            createdAt: new Date().toISOString(),
          };
          await insertOne('customers', newCust);
          resolvedCustomer = newCust;
          newCustomers.push(newCust);
          allCustomers.push(newCust); // available for rest of this batch
          console.log(`[Diary] ✅ Auto-created customer: "${newCust.name}" for staff ${staffName}`);
        } catch (createErr) {
          console.error('[Diary] ❌ Failed to auto-create customer:', createErr.message);
        }
      }

      const isNew = newCustomers.some(c => c.id === resolvedCustomer?.id);

      resolvedEntries.push({
        spokenName:          spokenName || 'General',
        customerName:        resolvedCustomer?.name || spokenName || 'General',
        customerId:          resolvedCustomer?.id   || null,
        matchedCustomerName: resolvedCustomer?.name || null,
        isNewCustomer:       isNew,
        autoCreatedId:       isNew ? resolvedCustomer?.id : null,
        date:                e.date        || null,
        notes:               e.notes       || '',
        originalNotes:       e.originalNotes || e.notes || '',
        actionItems:         e.actionItems || [],
        sentiment:           e.sentiment   || 'neutral',
        confidence:          e.confidence  || 0.5,
      });
    }

    await updateOne('diary', entryId, {
      status: 'done',
      aiEntries: resolvedEntries,
      translatedContent: aiResult.translatedContent || null,
      detectedLanguage: aiResult.detectedLanguage || null,
      processedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[Diary] Processing error:', err);
    await updateOne('diary', entryId, { status: 'error', error: err.message });
  }
}

function titleCase(str) {
  return str.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
}

module.exports = router;
