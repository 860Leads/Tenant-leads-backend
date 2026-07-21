const BAND_EMOJI = { GREEN: '🟢', YELLOW: '🟡', RED: '🔴' };

const EMPLOYMENT_TENURE_LABELS = {
  under_6_months: 'Less than 6 months',
  '6_months_to_1_year': '6 months - 1 year',
  '1_to_2_years': '1 - 2 years',
  '2_plus_years': '2+ years',
  unsure: 'Not sure',
};

function leadSummaryText(lead) {
  const lines = [
    `${BAND_EMOJI[lead.score.band]} ${lead.score.band} lead (${lead.score.totalPoints}/${lead.score.maxPoints} pts)`,
    `Name: ${lead.name}`,
    `Phone: ${lead.phone || 'n/a'}`,
    `Email: ${lead.email}`,
    `Current address: ${lead.currentAddress || 'n/a'}`,
    `Why moving: ${lead.reasonForMoving || 'n/a'}`,
    `Household size: ${lead.householdSize ?? 'n/a'}`,
    `Employer: ${lead.employer || 'n/a'}`,
    `Employment tenure: ${EMPLOYMENT_TENURE_LABELS[lead.employmentTenure] || 'n/a'}`,
    `Current rent: ${lead.currentRent ? `$${lead.currentRent}` : 'n/a'}`,
    `Desired move-in: ${lead.moveInDate || 'n/a'}`,
    `Monthly income: ${lead.monthlyIncome ? `$${lead.monthlyIncome}` : 'n/a'}`,
  ];
  return lines.join('\n');
}

function leadSummaryHtml(lead) {
  const row = (label, value) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#666;">${label}</td><td style="padding:4px 0;"><strong>${value ?? 'n/a'}</strong></td></tr>`;
  return `
    <div style="font-family:sans-serif;max-width:480px;">
      <h2 style="margin-bottom:0;">${BAND_EMOJI[lead.score.band]} ${lead.score.band} tenant lead</h2>
      <p style="color:#666;margin-top:4px;">Score: ${lead.score.totalPoints}/${lead.score.maxPoints}</p>
      <table>
        ${row('Name', lead.name)}
        ${row('Phone', lead.phone)}
        ${row('Email', lead.email)}
        ${row('Current address', lead.currentAddress)}
        ${row('Why moving', lead.reasonForMoving)}
        ${row('Household size', lead.householdSize)}
        ${row('Employer', lead.employer)}
        ${row('Employment tenure', EMPLOYMENT_TENURE_LABELS[lead.employmentTenure])}
        ${row('Current rent', lead.currentRent ? `$${lead.currentRent}` : null)}
        ${row('Desired move-in', lead.moveInDate)}
        ${row('Monthly income', lead.monthlyIncome ? `$${lead.monthlyIncome}` : null)}
      </table>
    </div>`;
}

let cachedGmailTransport = null;
function getGmailTransport(config) {
  if (cachedGmailTransport) return cachedGmailTransport;
  const nodemailer = require('nodemailer');
  cachedGmailTransport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: config.email.gmail.user, pass: config.email.gmail.appPassword },
  });
  return cachedGmailTransport;
}

async function sendViaGmail(lead, config) {
  const transport = getGmailTransport(config);
  await transport.sendMail({
    from: config.email.gmail.user,
    to: config.landlord.email,
    subject: `New ${lead.score.band} tenant lead: ${lead.name}`,
    html: leadSummaryHtml(lead),
    text: leadSummaryText(lead),
  });
}

async function sendViaResend(lead, config) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.email.resend.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.email.resend.from,
      to: config.landlord.email,
      subject: `New ${lead.score.band} tenant lead: ${lead.name}`,
      html: leadSummaryHtml(lead),
      text: leadSummaryText(lead),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
}

/**
 * Emails the landlord. Prefers Gmail (app password, no separate account
 * needed) if configured, falls back to Resend. Best-effort: throws on
 * failure, caller decides how to log/track it.
 */
async function notifyLandlordByEmail(lead, config) {
  if (config.email.gmail.user && config.email.gmail.appPassword) {
    await sendViaGmail(lead, config);
    return { skipped: false, provider: 'gmail' };
  }
  if (config.email.resend.apiKey) {
    await sendViaResend(lead, config);
    return { skipped: false, provider: 'resend' };
  }
  return { skipped: true, reason: 'No email provider configured (GMAIL_USER/GMAIL_APP_PASSWORD or RESEND_API_KEY)' };
}

/**
 * Texts the landlord via the same Twilio account 860Leads already uses.
 * Only fires if TWILIO_* and LANDLORD_PHONE are all configured.
 */
async function notifyLandlordBySms(lead, config) {
  const { accountSid, authToken, fromNumber } = config.sms;
  if (!accountSid || !authToken || !fromNumber || !config.landlord.phone) {
    return { skipped: true, reason: 'Twilio SMS not fully configured' };
  }
  const twilio = require('twilio')(accountSid, authToken);
  await twilio.messages.create({
    to: config.landlord.phone,
    from: fromNumber,
    body: `${BAND_EMOJI[lead.score.band]} New ${lead.score.band} tenant lead: ${lead.name} (${lead.phone || lead.email}). Move-in: ${lead.moveInDate || 'n/a'}.`,
  });
  return { skipped: false };
}

module.exports = { notifyLandlordByEmail, notifyLandlordBySms };
