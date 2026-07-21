require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const config = require('./config/tenants.config');
const tenantsRouter = require('./routes/tenants');

const app = express();

app.use(
  helmet({
    // Allow the landing page's inline <style>/<script> without a CSP nonce
    // setup — this is a single self-contained static page, not user content.
    contentSecurityPolicy: false,
  }),
);
app.use(cors());

app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/tenants', tenantsRouter);

app.use((err, req, res, next) => {
  console.error('[tenants]', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.port, () => {
  console.log(`tenant-leads-backend listening on :${config.port} (module enabled: ${config.enabled})`);
});
