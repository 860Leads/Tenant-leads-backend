const fs = require('fs/promises');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'leads.json');

// Serializes reads/writes so concurrent submissions can't clobber each
// other — fine at lead-gen volume, no database required.
let queue = Promise.resolve();
function sequential(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function readAll() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeAll(leads) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(leads, null, 2), 'utf8');
}

function createLead(data) {
  return sequential(async () => {
    const leads = await readAll();
    leads.push(data);
    await writeAll(leads);
    return data;
  });
}

function listLeads(filters = {}) {
  return sequential(async () => {
    let leads = await readAll();
    if (filters.band) leads = leads.filter((l) => l.score.band === filters.band);
    if (filters.status) leads = leads.filter((l) => l.status === filters.status);
    return leads.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  });
}

function getLead(id) {
  return sequential(async () => {
    const leads = await readAll();
    return leads.find((l) => l.id === id) || null;
  });
}

function updateLead(id, patch) {
  return sequential(async () => {
    const leads = await readAll();
    const index = leads.findIndex((l) => l.id === id);
    if (index === -1) return null;
    leads[index] = { ...leads[index], ...patch };
    await writeAll(leads);
    return leads[index];
  });
}

function deleteLead(id) {
  return sequential(async () => {
    const leads = await readAll();
    const filtered = leads.filter((l) => l.id !== id);
    const deleted = filtered.length !== leads.length;
    if (deleted) await writeAll(filtered);
    return deleted;
  });
}

async function getStats() {
  const leads = await sequential(readAll);
  const byBand = { GREEN: 0, YELLOW: 0, RED: 0 };
  const byStatus = {};
  let assigned = 0;

  for (const lead of leads) {
    byBand[lead.score.band] = (byBand[lead.score.band] || 0) + 1;
    byStatus[lead.status] = (byStatus[lead.status] || 0) + 1;
    if (lead.status !== 'new') assigned += 1;
  }

  const now = Date.now();
  const last7Days = leads.filter((l) => now - new Date(l.submittedAt).getTime() <= 7 * 86400000).length;
  const last30Days = leads.filter((l) => now - new Date(l.submittedAt).getTime() <= 30 * 86400000).length;

  return {
    total: leads.length,
    byBand,
    byStatus,
    assignedCount: assigned,
    conversionRate: leads.length ? Number((assigned / leads.length).toFixed(3)) : 0,
    last7Days,
    last30Days,
  };
}

module.exports = { createLead, listLeads, getLead, updateLead, deleteLead, getStats };
