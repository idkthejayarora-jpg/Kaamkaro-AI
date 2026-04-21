/**
 * WhatsApp / SMS Quick-Log Webhook
 *
 * Compatible with Twilio, Gupshup, and most WhatsApp Business API providers.
 * POST /api/webhook/log
 *
 * Expected body (Twilio-style):
 *   Body    = message text
 *   From    = sender's phone number (used to match staff)
 *   To      = your Twilio number (ignored)
 *
 * Also accepts raw JSON:
 *   { phone, message }
 *
 * Message format examples (all parsed automatically):
 *   "Called Raj Kumar, interested, follow up Friday"
 *   "Meeting with Priya Sharma — closed deal"
 *   "Message Ankit, no response"
 *   "Email Sunita — will decide next week, follow up 2025-02-15"
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne, updateOne } = require('../utils/db');
const { updateStaffStreak } = require('../utils/streak');

const router = express.Router();

// Webhook secret (set WEBHOOK_SECRET in .env to secure this endpoint)
function verifySecret(req) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return true; // if no secret set, allow all
  return req.query.secret === secret || req.headers['x-webhook-secret'] === secret;
}

const TYPE_MAP = {
  call:    ['call', 'called', 'rang', 'phoned', 'spoke'],
  message: ['message', 'msg', 'whatsapp', 'texted', 'sms', 'chat'],
  email:   ['email', 'emailed', 'mail'],
  meeting: ['meeting', 'met', 'visit', 'visited', 'zoom', 'call meeting'],
};

const STAGE_MAP = {
  contacted:   ['contacted', 'reached out'],
  interested:  ['interested', 'keen', 'excited', 'positive'],
  negotiating: ['negotiating', 'negotiation', 'price discussion', 'discussing'],
  closed:      ['closed', 'deal done', 'won', 'converted', 'sale done'],
  churned:     ['churned', 'lost', 'rejected', 'not interested', 'no response'],
};

function parseMessage(text) {
  const lower = text.toLowerCase();

  // Detect interaction type
  let type = 'call'; // default
  for (const [t, keywords] of Object.entries(TYPE_MAP)) {
    if (keywords.some(k => lower.includes(k))) { type = t; break; }
  }

  // Detect responded
  const noResponse = ['no response', 'no reply', 'didn\'t pick', 'not answered', 'no answer', 'unreachable'];
  const responded = !noResponse.some(k => lower.includes(k));

  // Detect stage update
  let newStage = null;
  for (const [stage, keywords] of Object.entries(STAGE_MAP)) {
    if (keywords.some(k => lower.includes(k))) { newStage = stage; break; }
  }

  // Extract follow-up date
  let followUpDate = null;
  const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) followUpDate = dateMatch[1];
  // "follow up Friday/Monday/tomorrow" — simple day matching
  if (!followUpDate) {
    const dayMatch = lower.match(/follow.?up\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week)/);
    if (dayMatch) {
      const targetDay = dayMatch[1];
      const now = new Date();
      if (targetDay === 'tomorrow') {
        now.setDate(now.getDate() + 1);
        followUpDate = now.toISOString().split('T')[0];
      } else {
        const days = { monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6, sunday:0 };
        if (targetDay in days) {
          const target = days[targetDay];
          const curr   = now.getDay();
          const diff   = (target - curr + 7) % 7 || 7;
          now.setDate(now.getDate() + diff);
          followUpDate = now.toISOString().split('T')[0];
        } else if (targetDay === 'next week') {
          now.setDate(now.getDate() + 7);
          followUpDate = now.toISOString().split('T')[0];
        }
      }
    }
  }

  return { type, responded, newStage, followUpDate, notes: text };
}

// POST /api/webhook/log
router.post('/log', async (req, res) => {
  if (!verifySecret(req)) {
    return res.status(401).send('Unauthorized');
  }

  // Support both Twilio form-encoded and raw JSON
  const phone   = req.body.From   || req.body.phone   || '';
  const message = req.body.Body   || req.body.message  || '';

  if (!message) return res.status(400).json({ error: 'No message' });

  // Normalize phone (strip country code prefixes, keep digits only)
  const normalizedPhone = phone.replace(/\D/g, '').replace(/^(91|1|44)/, '').slice(-10);

  // Find staff by phone
  const users = await readDB('users');
  const staff = await readDB('staff');
  const allUsers = [...users, ...staff];

  const sender = allUsers.find(u => {
    const p = (u.phone || '').replace(/\D/g, '').slice(-10);
    return p === normalizedPhone || u.phone === phone;
  });

  if (!sender) {
    // Respond with TwiML or JSON depending on content-type
    const isTwilio = req.body.From !== undefined;
    if (isTwilio) {
      res.type('text/xml');
      return res.send(`<?xml version="1.0"?><Response><Message>Phone number not registered in Kaamkaro. Contact your admin.</Message></Response>`);
    }
    return res.status(404).json({ error: 'Sender not found in system' });
  }

  // Find customer name in message
  const customers = await readDB('customers');
  let matchedCustomer = null;
  const msgLower = message.toLowerCase();
  for (const c of customers) {
    if (msgLower.includes(c.name.toLowerCase())) {
      // Check staff access
      if (sender.role === 'staff' && c.assignedTo !== sender.id) continue;
      matchedCustomer = c;
      break;
    }
  }

  if (!matchedCustomer) {
    const isTwilio = req.body.From !== undefined;
    if (isTwilio) {
      res.type('text/xml');
      return res.send(`<?xml version="1.0"?><Response><Message>Could not find a matching customer in your list. Check the customer name and try again.</Message></Response>`);
    }
    return res.status(404).json({ error: 'No matching customer found in message' });
  }

  const parsed = parseMessage(message);

  // Log interaction
  const interaction = {
    id: uuidv4(),
    customerId: matchedCustomer.id,
    staffId: sender.id,
    staffName: sender.name,
    type: parsed.type,
    responded: parsed.responded,
    notes: `[Quick-log via webhook] ${parsed.notes}`,
    followUpDate: parsed.followUpDate,
    createdAt: new Date().toISOString(),
    source: 'webhook',
  };
  await insertOne('interactions', interaction);
  await updateOne('customers', matchedCustomer.id, { lastContact: new Date().toISOString() });
  await updateStaffStreak(sender.id);

  // Update stage if detected
  if (parsed.newStage) {
    await updateOne('customers', matchedCustomer.id, { status: parsed.newStage });
  }

  // Auto follow-up task
  if (parsed.followUpDate) {
    await insertOne('tasks', {
      id: uuidv4(),
      staffId: sender.id,
      customerId: matchedCustomer.id,
      customerName: matchedCustomer.name,
      title: `Follow up with ${matchedCustomer.name}`,
      notes: '',
      dueDate: parsed.followUpDate,
      completed: false,
      completedAt: null,
      createdAt: new Date().toISOString(),
      source: 'webhook',
    });
  }

  const isTwilio = req.body.From !== undefined;
  if (isTwilio) {
    const followMsg = parsed.followUpDate ? ` Follow-up task set for ${parsed.followUpDate}.` : '';
    res.type('text/xml');
    return res.send(`<?xml version="1.0"?><Response><Message>✅ Logged ${parsed.type} with ${matchedCustomer.name}. Responded: ${parsed.responded ? 'Yes' : 'No'}.${followMsg}</Message></Response>`);
  }

  res.status(201).json({
    message: 'Interaction logged',
    interaction,
    customer: matchedCustomer.name,
    stage: parsed.newStage,
    followUpDate: parsed.followUpDate,
  });
});

// GET /api/webhook/info — returns webhook configuration info
router.get('/info', async (req, res) => {
  const host = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3001}`;
  res.json({
    url: `${host}/api/webhook/log`,
    secured: !!process.env.WEBHOOK_SECRET,
    instructions: {
      twilio: 'Set this URL as your WhatsApp/SMS webhook in Twilio Console → Messaging → A Number → When a message comes in.',
      format: 'Send messages like: "Called Raj Kumar, interested, follow up Friday" or "Email Priya - closed deal"',
      supported: ['Twilio', 'Gupshup', 'Kaleyra', 'Any Webhook that sends Body + From fields'],
    },
  });
});

module.exports = router;
