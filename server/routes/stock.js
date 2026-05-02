const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne, updateOne, deleteOne } = require('../utils/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ── Stock item vocabulary ─────────────────────────────────────────────────────
// alias (lowercase) → canonical display name
// Longer aliases first so regex matches the most specific term
const ITEM_ALIASES = {
  // Multi-word first (matched before single-word)
  'bridal set':      'Bridal Set',
  'ad set':          'AD Set',
  'jewellery set':   'Jewellery Set',
  'jewelry set':     'Jewellery Set',
  'gold set':        'Gold Set',
  'diamond set':     'Diamond Set',
  'stone set':       'Stone Set',
  'salwar suit':     'Suit',
  'salwar kameez':   'Suit',
  'gold chain':      'Gold Chain',
  'silver chain':    'Silver Chain',
  // Jewelry — single word
  bracelet:   'Bracelet',   bracelets:  'Bracelet',
  bangle:     'Bangle',     bangles:    'Bangle',
  kangan:     'Bangle',     kangans:    'Bangle',
  churi:      'Bangle',     churiyan:   'Bangle',
  choodi:     'Bangle',     choodiya:   'Bangle',
  ring:       'Ring',       rings:      'Ring',
  angoothi:   'Ring',       angoothiyan:'Ring',
  necklace:   'Necklace',   necklaces:  'Necklace',
  haar:       'Necklace',
  mala:       'Necklace',
  earring:    'Earring',    earrings:   'Earring',
  jhumka:     'Earring',    jhumke:     'Earring',
  jhumkaa:    'Earring',
  bali:       'Earring',
  stud:       'Earring',    studs:      'Earring',
  pendant:    'Pendant',    pendants:   'Pendant',
  locket:     'Pendant',    lockets:    'Pendant',
  chain:      'Chain',      chains:     'Chain',
  anklet:     'Anklet',     anklets:    'Anklet',
  payal:      'Anklet',     payals:     'Anklet',
  maangtika:  'Maangtika',  tikka:      'Maangtika',
  tika:       'Maangtika',
  choker:     'Choker',     chokers:    'Choker',
  mangalsutra:'Mangalsutra',
  nath:       'Nath',
  // Sets / combined (single-word aliases)
  set:        'Set',
  // Clothing
  saree:      'Saree',      sarees:     'Saree',
  sari:       'Saree',      saris:      'Saree',
  lehenga:    'Lehenga',    lehengas:   'Lehenga',
  lehanga:    'Lehenga',
  suit:       'Suit',       suits:      'Suit',
  kurti:      'Kurti',      kurtis:     'Kurti',
  fabric:     'Fabric',     fabrics:    'Fabric',
  kapda:      'Fabric',
  dupatta:    'Dupatta',    dupattas:   'Dupatta',
  // Construction / other
  tile:       'Tile',       tiles:      'Tile',
  marble:     'Marble',
  granite:    'Granite',
};

// All stock term keys — used by diary.js to add them to STOP_WORDS
const STOCK_TERMS = new Set(Object.keys(ITEM_ALIASES));

// Units for quantity parsing
const UNITS = [
  'pieces', 'piece', 'pcs', 'pc',
  'sets',   'set',
  'pairs',  'pair',
  'boxes',  'box',
  'packets','packet',
  'nos',    'no',
  'nag',    'kg',
  'meters', 'meter',
  'yards',  'yard',
  'gaj',
];
const UNIT_RE = new RegExp(`\\b(${UNITS.join('|')})\\b`, 'i');

// Sale verbs — presence nearby increases confidence; we detect anyway for business diaries
const SALE_VERB_RE = /\b(liya|liye|diya|diye|diya\s*gaya|diye\s*gaye|bech[ae]?|beche|becha|bech\s*diya|kharida|kharidi|sell|sold|deliver|delivery|supply|gaya|gayi|gaye|mila|mile|aaya|aayi|order|dispatch)\b/i;

/**
 * Detect items + quantities from diary text.
 * Returns: Array<{ item: string (canonical), qty: number, unit: string }>
 * Deduplicates by canonical item name (first match wins per item).
 */
function detectPurchases(text) {
  const lower = text.toLowerCase();
  const results = [];
  const seen = new Set();   // canonical names already found

  // Sort aliases by length desc so multi-word phrases are tried before single words
  const aliases = Object.keys(ITEM_ALIASES).sort((a, b) => b.length - a.length);
  const unitPat = UNITS.join('|');

  for (const alias of aliases) {
    const canonical = ITEM_ALIASES[alias];
    if (seen.has(canonical)) continue;

    const escapedAlias = alias.replace(/\s+/g, '\\s+');

    // Pattern A: [qty] [optional-unit] [item]  e.g. "6 pc bracelet", "10 necklace"
    const reA = new RegExp(
      `(\\d+)\\s*(?:(?:${unitPat})\\s+)?${escapedAlias}`,
      'i'
    );
    let m = reA.exec(lower);
    if (!m) {
      // Pattern B: [item] [qty] [optional-unit]  e.g. "bracelet 6 pc"
      const reB = new RegExp(
        `${escapedAlias}\\s+(\\d+)\\s*(?:${unitPat})?`,
        'i'
      );
      m = reB.exec(lower);
    }

    if (m) {
      const qty = parseInt(m[1], 10);
      if (qty <= 0 || qty > 9999) continue;

      // Require a sale-verb context within 60 chars for "set" / "suit" / "fabric"
      // to avoid false positives (e.g. "set karna hai" is not a sale)
      const ambiguous = new Set(['Set', 'Suit', 'Fabric']);
      if (ambiguous.has(canonical)) {
        const start = Math.max(0, m.index - 60);
        const end   = Math.min(lower.length, m.index + m[0].length + 60);
        const ctx   = lower.slice(start, end);
        if (!SALE_VERB_RE.test(ctx)) continue;
      }

      // Extract unit from match
      const unitMatch = m[0].match(UNIT_RE);
      const unit = unitMatch ? unitMatch[1].toLowerCase() : 'pc';

      seen.add(canonical);
      results.push({ item: canonical, qty, unit });
    }
  }

  return results;
}

/**
 * Add a stock sale entry for a staff member.
 * Finds (or creates) the stock record for this staff+item, appends the history entry.
 * Called from diary.js after processing an entry.
 */
async function addStockEntry({ staffId, staffName, item, qty, unit, date, customerId, customerName, diaryEntryId, note }) {
  const stockItems = await readDB('stockItems');
  const existing = stockItems.find(s => s.staffId === staffId && s.itemName === item);

  const histEntry = {
    id:           uuidv4(),
    date:         date || new Date().toISOString(),
    qty,
    unit:         unit || 'pc',
    customerId:   customerId   || null,
    customerName: customerName || null,
    diaryEntryId: diaryEntryId || null,
    note:         note         || null,
  };

  if (existing) {
    const history   = [...(existing.history || []), histEntry];
    const totalSold = history.reduce((s, h) => s + h.qty, 0);
    await updateOne('stockItems', existing.id, {
      totalSold,
      unit: unit || existing.unit,
      history,
      updatedAt: new Date().toISOString(),
    });
  } else {
    await insertOne('stockItems', {
      id:        uuidv4(),
      staffId,
      staffName,
      itemName:  item,
      totalSold: qty,
      unit:      unit || 'pc',
      history:   [histEntry],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────────

// GET /api/stock — list stock items (admin sees all, staff sees own)
router.get('/', async (req, res) => {
  try {
    let items = await readDB('stockItems');
    if (req.user.role !== 'admin') {
      items = items.filter(s => s.staffId === req.user.id);
    }
    // Optional ?staffId= filter for admin
    if (req.user.role === 'admin' && req.query.staffId) {
      items = items.filter(s => s.staffId === req.query.staffId);
    }
    items.sort((a, b) => a.itemName.localeCompare(b.itemName));
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stock/entry — add a manual stock entry
router.post('/entry', async (req, res) => {
  try {
    const { item, qty, unit, customerId, customerName, note, date, staffId: bodyStaffId } = req.body;
    if (!item || qty == null) return res.status(400).json({ error: 'item and qty are required' });

    const staffId   = req.user.role === 'admin' ? (bodyStaffId || req.user.id) : req.user.id;
    const allStaff  = await readDB('staff');
    const staffRec  = allStaff.find(s => s.id === staffId);
    const staffName = staffRec?.name || req.user.name;

    await addStockEntry({
      staffId, staffName,
      item: String(item).trim(),
      qty:  parseInt(qty, 10),
      unit: unit || 'pc',
      date, customerId, customerName,
      note: note || 'Manual entry',
    });

    const items = await readDB('stockItems');
    const updated = items.find(s => s.staffId === staffId && s.itemName === String(item).trim());
    res.json(updated || { success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/stock/:id — delete entire stock item record
router.delete('/:id', async (req, res) => {
  try {
    const items = await readDB('stockItems');
    const item  = items.find(s => s.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    if (req.user.role !== 'admin' && item.staffId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await deleteOne('stockItems', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/stock/:id/entry/:entryId — remove a single history entry
router.delete('/:id/entry/:entryId', async (req, res) => {
  try {
    const items = await readDB('stockItems');
    const item  = items.find(s => s.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    if (req.user.role !== 'admin' && item.staffId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const history   = (item.history || []).filter(h => h.id !== req.params.entryId);
    const totalSold = history.reduce((s, h) => s + h.qty, 0);
    const updated   = await updateOne('stockItems', req.params.id, {
      history, totalSold, updatedAt: new Date().toISOString(),
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Exports ───────────────────────────────────────────────────────────────────
// The router is the default export (so index.js can mount it with require(...))
// Utility functions are attached as named properties
module.exports = router;
module.exports.detectPurchases = detectPurchases;
module.exports.addStockEntry   = addStockEntry;
module.exports.STOCK_TERMS     = STOCK_TERMS;
