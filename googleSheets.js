const { google } = require('googleapis');

const HEADER_ROW = [
  'Submitted At',
  'Lead ID',
  'Name',
  'Phone',
  'Email',
  'Current Address',
  'Why Moving',
  'Household Size',
  'Employer',
  'Employment Tenure',
  'Current Rent',
  'Move-In Date',
  'Monthly Income',
  'Score',
  'Score Points',
  'Status',
  'Assigned To',
];

function isConfigured(config) {
  return Boolean(
    config.googleSheets.serviceAccountEmail &&
      config.googleSheets.privateKey &&
      config.googleSheets.spreadsheetId,
  );
}

let cachedClient = null;
function getClient(config) {
  if (cachedClient) return cachedClient;
  const auth = new google.auth.JWT({
    email: config.googleSheets.serviceAccountEmail,
    key: config.googleSheets.privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  cachedClient = google.sheets({ version: 'v4', auth });
  return cachedClient;
}

async function ensureHeaderRow(config) {
  const sheets = getClient(config);
  const { tabName, spreadsheetId } = config.googleSheets;
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!A1:Q1`,
  });
  if (existing.data.values && existing.data.values.length > 0) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADER_ROW] },
  });
}

function leadToRow(lead) {
  return [
    lead.submittedAt,
    lead.id,
    lead.name,
    lead.phone || '',
    lead.email,
    lead.currentAddress || '',
    lead.reasonForMoving || '',
    lead.householdSize ?? '',
    lead.employer || '',
    lead.employmentTenure || '',
    lead.currentRent ?? '',
    lead.moveInDate || '',
    lead.monthlyIncome ?? '',
    lead.score.band,
    `${lead.score.totalPoints}/${lead.score.maxPoints}`,
    lead.status,
    lead.assignedTo || '',
  ];
}

/**
 * Appends a tenant lead as a row to the configured "Tenant Leads" tab.
 * Best-effort: throws on failure so the caller can log/track it, but
 * callers should never let this block the applicant-facing response.
 */
async function appendTenantLead(lead, config) {
  if (!isConfigured(config)) {
    return { skipped: true, reason: 'Google Sheets not configured' };
  }
  const sheets = getClient(config);
  await ensureHeaderRow(config);
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.googleSheets.spreadsheetId,
    range: `${config.googleSheets.tabName}!A:Q`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [leadToRow(lead)] },
  });
  return { skipped: false };
}

async function getSheetIdByTabName(sheets, spreadsheetId, tabName) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
  const match = (meta.data.sheets || []).find((s) => s.properties.title === tabName);
  return match ? match.properties.sheetId : null;
}

/**
 * Finds the row for a given lead ID (matched against the "Lead ID" column)
 * and deletes it. Best-effort: throws on failure, returns { deleted:false }
 * if the row can't be found (e.g. already removed).
 */
async function deleteTenantLeadRow(leadId, config) {
  if (!isConfigured(config)) {
    return { skipped: true, reason: 'Google Sheets not configured' };
  }
  const sheets = getClient(config);
  const { tabName, spreadsheetId } = config.googleSheets;

  const sheetId = await getSheetIdByTabName(sheets, spreadsheetId, tabName);
  if (sheetId === null) {
    return { skipped: false, deleted: false, reason: `Tab "${tabName}" not found` };
  }

  const idColumn = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!B:B`, // "Lead ID" is column B
  });
  const rows = idColumn.data.values || [];
  const rowIndex = rows.findIndex((row) => row[0] === leadId);
  if (rowIndex === -1) {
    return { skipped: false, deleted: false, reason: 'Lead ID not found in sheet' };
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 },
          },
        },
      ],
    },
  });
  return { skipped: false, deleted: true };
}

module.exports = { appendTenantLead, deleteTenantLeadRow, isConfigured };
