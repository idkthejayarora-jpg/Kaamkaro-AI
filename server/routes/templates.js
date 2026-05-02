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
      stage: stage || null,
      type,
      createdBy: req.user.id,
      createdByName: req.user.name,
      usageCount: 0,
      attachments: [],         // { name, originalName, url, mimetype }[]
      createdAt: new Date().toISOString(),
    };
    await insertOne('templates', template);
    await logAudit(req.user.id, req.user.name, 'create', 'template', template.id, `Created template: ${title}`);
    res.status(201).json(template);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Ownership helper — admin can touch any template, staff only their own ───────
function canEdit(user, template) {
  return user.role === 'admin' || template.createdBy === user.id;
}

// POST /api/templates/:id/attach — upload PDF or image as catalogue attachment
router.post('/:id/attach', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded or unsupported type (jpg/png/webp/gif/pdf only)' });
    const templates = await readDB('templates');
    const t = templates.find(x => x.id === req.params.id);
    if (!t) { fs.unlinkSync(req.file.path); return res.status(404).json({ error: 'Template not found' }); }
    if (!canEdit(req.user, t)) { fs.unlinkSync(req.file.path); return res.status(403).json({ error: 'You can only edit your own templates' }); }
    const attachment = {
      name:         req.file.filename,
      originalName: req.file.originalname,
      url:          `/uploads/templates/${req.file.filename}`,
      mimetype:     req.file.mimetype,
    };
    const attachments = [...(t.attachments || []), attachment];
    const updated = await updateOne('templates', req.params.id, { attachments });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Upload failed' });
  }
});

// DELETE /api/templates/:id/attach/:filename — remove one attachment
router.delete('/:id/attach/:filename', async (req, res) => {
  try {
    const templates = await readDB('templates');
    const t = templates.find(x => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (!canEdit(req.user, t)) return res.status(403).json({ error: 'You can only edit your own templates' });
    const filePath = path.join(UPLOAD_DIR, req.params.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    const attachments = (t.attachments || []).filter(a => a.name !== req.params.filename);
    const updated = await updateOne('templates', req.params.id, { attachments });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/templates/:id — owner or admin
router.patch('/:id', async (req, res) => {
  try {
    const templates = await readDB('templates');
    const t = templates.find(x => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (!canEdit(req.user, t)) return res.status(403).json({ error: 'You can only edit your own templates' });
    const { title, content, stage, type } = req.body;
    const updated = await updateOne('templates', req.params.id, { title, content, stage, type });
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

// DELETE /api/templates/:id — owner or admin
router.delete('/:id', async (req, res) => {
  try {
    const templates = await readDB('templates');
    const t = templates.find(x => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (!canEdit(req.user, t)) return res.status(403).json({ error: 'You can only delete your own templates' });
    await deleteOne('templates', req.params.id);
    await logAudit(req.user.id, req.user.name, 'delete', 'template', req.params.id, 'Template deleted');
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
