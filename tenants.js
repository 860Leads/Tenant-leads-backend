const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');

const config = require('../config/tenants.config');
const { scoreTenant } = require('../lib/scoring');
const store = require('../lib/store');
const { appendTenantLead, deleteTenantLeadRow } = require('../lib/googleSheets');
const { notifyLandlordByEmail, notifyLandlordBySms } = require('../lib/notify');
const { postToMakeWebhook } = require('../lib/makeWebhook');

const router = express.Router();

router.use(express.json());

// Public health check — reports module status even when disabled, so it
// can be used as a toggle indicator without needing admin auth.
router.get('/health', (req, res) => {
  res.json({ ok: true, enabled: config.enabled });
});

// Master toggle: when disabled, every other route in this module 503s
// without touching the rest of the host server.
router.use((req, res, next) => {
  if (!config.enabled) {
    return res.status(503).json({ error: 'Tenant leads module is currently disabled' });
  }
  next();
});

function requireAdmin(req, res, next) {
  if (!config.admin.apiKey) {
    return res.status(503).json({ error: 'Admin API key not configured on server' });
  }
  if (req.get('x-admin-key') !== config.admin.apiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

const submitLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions from this address, please try again later.' },
});

const submitSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  email: z.string().trim().email().max(200),
  currentAddress: z.string().trim().max(300).optional().or(z.literal('')),
  reasonForMoving: z.string().trim().max(1000).optional().or(z.literal('')),
  householdSize: z.coerce.number().int().nonnegative().optional(),
  employer: z.string().trim().max(200).optional().or(z.literal('')),
  employmentTenure: z
    .enum(['under_6_months', '6_months_to_1_year', '1_to_2_years', '2_plus_years', 'unsure'])
    .optional(),
  currentRent: z.coerce.number().nonnegative().optional(),
  moveInDate: z.string().trim().max(30).optional().or(z.literal('')),
  monthlyIncome: z.coerce.number().nonnegative().optional(),
  // Honeypot: real users never fill this in (hidden via CSS on the form).
  website: z.string().optional().or(z.literal('')),
});

router.post('/submit', submitLimiter, async (req, res, next) => {
  try {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid submission', details: parsed.error.flatten() });
    }
    const data = parsed.data;

    // Bot caught the honeypot — respond as if successful, do nothing else.
    if (data.website) {
      return res.status(201).json({ ok: true });
    }

    const score = scoreTenant(data, config);
    const lead = {
      id: crypto.randomUUID(),
      name: data.name,
      phone: data.phone || '',
      email: data.email.toLowerCase(),
      currentAddress: data.currentAddress || '',
      reasonForMoving: data.reasonForMoving || '',
      householdSize: data.householdSize ?? null,
      employer: data.employer || '',
      employmentTenure: data.employmentTenure || 'unsure',
      currentRent: data.currentRent ?? null,
      moveInDate: data.moveInDate || '',
      monthlyIncome: data.monthlyIncome ?? null,
      score,
      status: 'new',
      assignedTo: '',
      source: 'landing_page',
      submittedAt: new Date().toISOString(),
      integrations: {},
    };

    await store.createLead(lead);

    // None of these should ever fail the applicant's response — track
    // outcomes per-integration so admins can see what did/didn't sync.
    const settled = await Promise.allSettled([
      appendTenantLead(lead, config),
      notifyLandlordByEmail(lead, config),
      notifyLandlordBySms(lead, config),
      postToMakeWebhook(lead, config),
    ]);
    const toResult = (r) => (r.status === 'fulfilled' ? r.value : { skipped: false, error: r.reason.message });
    const [sheets, email, sms, webhook] = settled.map(toResult);
    const integrations = { sheets, email, sms, webhook };
    await store.updateLead(lead.id, { integrations });

    res.status(201).json({ ok: true, id: lead.id, band: score.band });
  } catch (err) {
    next(err);
  }
});

router.get('/leads', requireAdmin, async (req, res, next) => {
  try {
    const { band, status } = req.query;
    const leads = await store.listLeads({ band, status });
    res.json({ count: leads.length, leads });
  } catch (err) {
    next(err);
  }
});

router.get('/stats', requireAdmin, async (req, res, next) => {
  try {
    res.json(await store.getStats());
  } catch (err) {
    next(err);
  }
});

const assignSchema = z.object({
  assignedTo: z.string().trim().min(1).max(200),
  note: z.string().trim().max(2000).optional(),
});

router.post('/leads/:id/assign', requireAdmin, async (req, res, next) => {
  try {
    const parsed = assignSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const lead = await store.getLead(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const updated = await store.updateLead(req.params.id, {
      status: 'assigned',
      assignedTo: parsed.data.assignedTo,
      assignedAt: new Date().toISOString(),
      notes: parsed.data.note ? [lead.notes, parsed.data.note].filter(Boolean).join('\n') : lead.notes,
    });
    res.json({ ok: true, lead: updated });
  } catch (err) {
    next(err);
  }
});

router.delete('/leads/:id', requireAdmin, async (req, res, next) => {
  try {
    const lead = await store.getLead(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await store.deleteLead(req.params.id);

    let sheet;
    try {
      sheet = await deleteTenantLeadRow(req.params.id, config);
    } catch (err) {
      sheet = { skipped: false, deleted: false, error: err.message };
    }

    res.json({ ok: true, deletedId: req.params.id, sheet });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
