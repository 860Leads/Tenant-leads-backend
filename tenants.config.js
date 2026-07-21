// Central config for the "tenants" (rental applicant lead capture) module.
// Everything here is env-driven so the module can be toggled or reconfigured
// without touching code. See .env.example for the full list of variables.

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

const config = {
  // Master switch — set TENANTS_MODULE_ENABLED=false to disable every route
  // in this module (returns 503) without removing it from the server.
  enabled: bool(process.env.TENANTS_MODULE_ENABLED, true),

  port: Number(process.env.TENANTS_PORT || process.env.PORT || 4001),

  landlord: {
    email: process.env.LANDLORD_EMAIL || 'greglaflam@gmail.com',
    // E.164 format, e.g. +15551234567. Leave blank to skip SMS entirely.
    phone: process.env.LANDLORD_PHONE || '',
  },

  // Two supported ways to send the landlord notification email — Gmail
  // (an app password on the landlord's own Gmail account, zero extra
  // accounts needed) takes priority if both are set. Resend is kept as an
  // alternate path since the main 860Leads app already uses it.
  email: {
    gmail: {
      user: process.env.GMAIL_USER || '',
      appPassword: process.env.GMAIL_APP_PASSWORD || '',
    },
    resend: {
      apiKey: process.env.RESEND_API_KEY || '',
      from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
    },
  },

  // Reuses the same Twilio account as the main 860Leads app.
  sms: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    fromNumber: process.env.TWILIO_FROM_NUMBER || '',
  },

  googleSheets: {
    serviceAccountEmail: process.env.GOOGLE_SHEETS_CLIENT_EMAIL || '',
    // Private keys are usually stored with literal "\n" sequences in env
    // vars; convert them back to real newlines.
    privateKey: (process.env.GOOGLE_SHEETS_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '',
    tabName: process.env.GOOGLE_SHEETS_TENANT_TAB || 'Tenant Leads',
  },

  makeWebhookUrl: process.env.MAKE_TENANTS_WEBHOOK_URL || '',

  admin: {
    // Required header (x-admin-key) for GET /leads, GET /stats, POST /assign.
    apiKey: process.env.TENANTS_ADMIN_API_KEY || '',
  },

  rateLimit: {
    windowMs: Number(process.env.TENANTS_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
    max: Number(process.env.TENANTS_RATE_LIMIT_MAX || 20),
  },

  // Scoring inputs. Credit is checked separately by the landlord through
  // his residential screening portal, so it plays no part here — income is
  // compared against this listing's rent, employment tenure stands in as
  // the stability signal, and move-in timeline rounds it out.
  scoring: {
    defaultMonthlyRent: Number(process.env.TENANTS_DEFAULT_RENT || 1800),
    incomeToRentRatio: { strong: 3, acceptable: 2.5 },
    moveInDaysThreshold: { strong: 45, acceptable: 90 },
    employmentTenurePoints: {
      under_6_months: 0,
      '6_months_to_1_year': 0,
      '1_to_2_years': 1,
      '2_plus_years': 2, // 2+ years is the strongest stability signal
      unsure: 0,
    },
    bandThresholds: { green: 5, yellow: 3 }, // out of 6 max points
  },
};

module.exports = config;
