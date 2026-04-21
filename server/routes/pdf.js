const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const pdfParse = require('pdf-parse');
const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne, updateOne } = require('../utils/db');
const { authMiddleware } = require('../middleware/auth');
const Anthropic = require('@anthropic-ai/sdk');

const router = express.Router();
router.use(authMiddleware);

const UPLOAD_DIR = path.join(__dirname, '../uploads');
fs.ensureDir(UPLOAD_DIR);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${uuidv4()}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files allowed'));
  },
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// GET /api/pdf — list PDFs for current user
router.get('/', async (req, res) => {
  try {
    const entries = await readDB('pdfEntries');
    const filtered = req.user.role === 'admin'
      ? entries
      : entries.filter(e => e.staffId === req.user.id);
    res.json(filtered.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/pdf/upload
router.post('/upload', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF uploaded' });

    const entry = {
      id: uuidv4(),
      staffId: req.user.id,
      staffName: req.user.name,
      uploadedAt: new Date().toISOString(),
      fileName: req.file.originalname,
      filePath: req.file.filename,
      status: 'processing',
      entries: [],
      rawText: '',
    };

    await insertOne('pdfEntries', entry);
    res.status(202).json({ id: entry.id, message: 'Processing started' });

    // Process async
    processPDF(entry.id, req.file.path, req.user.id).catch(console.error);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// GET /api/pdf/:id — get single PDF result
router.get('/:id', async (req, res) => {
  try {
    const entries = await readDB('pdfEntries');
    const entry = entries.find(e => e.id === req.params.id);
    if (!entry) return res.status(404).json({ error: 'Not found' });
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

async function processPDF(entryId, filePath, staffId) {
  try {
    const buffer = await fs.readFile(filePath);
    const data = await pdfParse(buffer);
    const rawText = data.text;

    const customers = await readDB('customers');
    const staffCustomers = customers.filter(c => c.assignedTo === staffId);
    const customerNames = staffCustomers.map(c => c.name);

    let extractedEntries = [];

    if (process.env.ANTHROPIC_API_KEY) {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const prompt = `You are analyzing a staff member's handwritten diary/notes that has been converted to text via OCR from a PDF.

The staff member's assigned customers are: ${customerNames.length > 0 ? customerNames.join(', ') : 'None listed'}

Here is the diary text:
---
${rawText.slice(0, 8000)}
---

Extract all customer interactions/entries from this text. For each entry, identify:
1. Customer name (match to the list above if possible, or use the name mentioned)
2. Date of interaction (if mentioned)
3. Notes/summary of the interaction
4. Action items (if any)
5. Sentiment (positive/neutral/negative)

Return a JSON array of entries. Each entry should be:
{
  "customerName": "string",
  "matchedCustomerName": "string or null (exact match from the list)",
  "date": "ISO date string or null",
  "notes": "string",
  "actionItems": ["string"],
  "sentiment": "positive|neutral|negative",
  "confidence": 0.0-1.0
}

Return ONLY the JSON array, no other text.`;

      const message = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      });

      try {
        const content = message.content[0].text.trim();
        const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(jsonStr);
        extractedEntries = parsed.map(e => ({
          ...e,
          customerId: staffCustomers.find(c =>
            c.name.toLowerCase() === (e.matchedCustomerName || '').toLowerCase()
          )?.id || null,
        }));
      } catch {
        extractedEntries = [{ customerName: 'Unprocessed', notes: rawText.slice(0, 500), confidence: 0.1 }];
      }
    } else {
      // Fallback: basic text parsing without AI
      const lines = rawText.split('\n').filter(l => l.trim().length > 20);
      extractedEntries = lines.slice(0, 10).map(line => ({
        customerName: 'Unknown',
        customerId: null,
        date: null,
        notes: line.trim(),
        actionItems: [],
        sentiment: 'neutral',
        confidence: 0.3,
      }));
    }

    await updateOne('pdfEntries', entryId, {
      status: 'done',
      entries: extractedEntries,
      rawText: rawText.slice(0, 2000),
      processedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('PDF processing error:', err);
    await updateOne('pdfEntries', entryId, { status: 'error', error: err.message });
  }
}

module.exports = router;
