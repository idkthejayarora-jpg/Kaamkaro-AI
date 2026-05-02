const express = require('express');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne, updateOne, deleteOne } = require('../utils/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

// ── File upload setup ─────────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '../uploads/templates');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg','image/png','image/webp','image/gif','application/pdf'].includes(file.mimetype);
    cb(null, ok);
  },
});

const router = express.Router();
router.use(authMiddleware);

// GET /api/templates — all users can read
router.get('/', async (req, res) => {
  try {
    const templates = await readDB('templates');
    res.json(templates);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/templates — all authenticated users can create templates
router.post('/', async (req, res) => {
  try {
    const { title, content, stage, type = 'general' } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'title and content required' });
    const template = {
      id: uuidv4(),
      title,
      content,
      stage: stage || null, // which pipeline stage this is for (optional)
      type,                 // 'general' | 'call' | 'message' | 'email' | 'meeting'
      createdBy: req.user.id,
      createdByName: req.user.name,
      usageCount: 0,
      createdAt: new Date().toISOString(),
    };
    await insertOne('templates', template);
    await logAudit(req.user.id, req.user.name, 'create', 'template', template.id, `Created template: ${title}`);
    res.status(201).json(template);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/templates/:id — admin only
router.patch('/:id', adminOnly, async (req, res) => {
  try {
    const { title, content, stage, type } = req.body;
    const updated = await updateOne('templates', req.params.id, { title, content, stage, type });
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/templates/:id/use — increment usageCount
router.post('/:id/use', async (req, res) => {
  try {
    const templates = await readDB('templates');
    const t = templates.find(x => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    const updated = await updateOne('templates', req.params.id, { usageCount: (t.usageCount || 0) + 1 });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/templates/:id — admin only
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const deleted = await deleteOne('templates', req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    await logAudit(req.user.id, req.user.name, 'delete', 'template', req.params.id, 'Template deleted');
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
