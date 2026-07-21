# Tenant Leads Backend

Standalone microservice for capturing rental applicant ("tenant") leads —
landing page form, Green/Yellow/Red scoring, Google Sheets logging, and
landlord email/SMS notifications. Runs independently of the main 860Leads
Next.js app; it does not import or depend on any code from that project.

> **Why standalone?** The main 860Leads app is a Next.js/Prisma SaaS product
> where "tenant" already means a *customer account* (multi-tenant isolation
> via Postgres RLS). This module is about *rental applicants* — a different
> domain entirely — so it's kept as its own Express service to avoid naming
> collisions and to stay deployable/toggleable independent of the core app.

## Quickstart

```bash
cd tenant-leads-backend
./scripts/setup.sh          # prompts for credentials, writes .env, validates them
./scripts/test-local.sh     # runs a real submission through the app end-to-end
./scripts/deploy-render.sh  # generates render.yaml + walks you through deploying
```

That's the whole flow — the sections below explain what each script does and
how to do any of it by hand instead.

## What it does

1. Serves a landing page (`public/index.html`) with a tenant application form.
2. `POST /api/tenants/submit` — validates the submission, scores the
   applicant, saves it, and (best-effort, non-blocking) appends it to a
   Google Sheet, emails the landlord, texts the landlord if configured, and
   posts to a Make.com webhook if configured.
3. Admin endpoints to review and triage leads.

Leads are stored in `data/leads.json` (created automatically). This is
enough for lead-gen volume and needs no database — Google Sheets is the
durable/shareable copy.

## Scoring

Green/Yellow/Red, out of 6 points total (2 each). Credit is intentionally
*not* part of this score — Greg runs credit and background checks
separately through his residential screening portal, so the form doesn't
ask for it at all.

- **Income**: monthly income ÷ `TENANTS_DEFAULT_RENT` (the listing's
  asking rent) — ≥3x = 2 pts, ≥2.5x = 1 pt, else 0.
- **Employment tenure**: self-reported band, used as the stability signal
  in credit's place — 2+ years = 2 pts, 1-2 years = 1 pt, under 1 year or
  unsure = 0.
- **Move-in timeline**: ≤45 days = 2 pts, ≤90 days = 1 pt, else 0.

Total ≥5 → GREEN, ≥3 → YELLOW, else RED. All thresholds live in
`config/tenants.config.js`.

## Setup

`./scripts/setup.sh` does all of this interactively — prompts for the
Google Sheets spreadsheet ID and a service account key file, a Gmail
address + app password for landlord notifications, optional Twilio/SMS
and Make.com settings, generates a random admin API key, writes `.env`,
and validates the Sheets/email credentials actually work before it
finishes. Safe to re-run any time — it backs up your existing `.env` and
lets you press Enter to keep any value unchanged (including secrets,
without ever echoing them back).

The rest of this section is what to do by hand if you'd rather not use
the script, or want to understand what it's doing.

```bash
cd tenant-leads-backend
npm install
cp .env.example .env
```

### Email — Gmail (recommended) or Resend

Gmail is the simplest path: use the landlord's own Gmail account with an
**App Password** (not the normal login password) — no separate email
service account needed.

1. Turn on 2-Step Verification on the Gmail account, if not already on.
2. Generate an app password at https://myaccount.google.com/apppasswords
3. Set `GMAIL_USER` (the Gmail address) and `GMAIL_APP_PASSWORD` (the
   16-character app password, spaces stripped) in `.env`.

If deploying alongside the main 860Leads app and you'd rather reuse its
Resend account instead, leave `GMAIL_USER`/`GMAIL_APP_PASSWORD` blank and
set `RESEND_API_KEY`/`RESEND_FROM_EMAIL` — Gmail is tried first if both
are set, Resend is the fallback.

### SMS (optional) — reused from 860Leads

Copy these three values straight from the main app's `.env` if you want
SMS notifications, and set `LANDLORD_PHONE`:

```
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
```

Leave them blank to skip SMS — the submit endpoint still works fine.

### Google Sheets setup (new — nothing to reuse here)

1. In Google Cloud Console, create (or reuse) a project, enable the
   **Google Sheets API**, and create a **Service Account**.
2. Create a JSON key for it and download it. `./scripts/setup.sh` will
   parse `client_email`/`private_key` out of that file for you — or do it
   by hand: `client_email` → `GOOGLE_SHEETS_CLIENT_EMAIL`, `private_key` →
   `GOOGLE_SHEETS_PRIVATE_KEY` (keep the `\n` sequences as-is, the app
   converts them back to real newlines).
3. Create a Google Sheet, add a tab named `Tenant Leads` (or set
   `GOOGLE_SHEETS_TENANT_TAB` to match whatever you name it), and **share
   the sheet with the service account's email as an Editor**.
4. Copy the spreadsheet ID (the long id in the sheet's URL) into
   `GOOGLE_SHEETS_SPREADSHEET_ID`.
5. The header row is written automatically on first submission if the tab
   is empty.

### Make.com setup (new — nothing to reuse here)

1. Create a new Make.com scenario with a **Custom Webhook** trigger.
2. Copy the generated webhook URL into `MAKE_TENANTS_WEBHOOK_URL`.
3. The full lead JSON is POSTed on every submission — build whatever
   downstream automation you want off of it (Slack ping, CRM row, etc.).

### Admin API key

Set `TENANTS_ADMIN_API_KEY` to any long random string (`setup.sh`
generates one automatically). Required as the `x-admin-key` header on all
admin endpoints below.

## Testing

`./scripts/test-local.sh` starts the server, submits a real, clearly
labeled test application through the actual HTTP API, checks the admin
API to confirm Google Sheets/email/SMS each either succeeded or were
cleanly skipped (not silently broken), deletes the test lead from local
storage and the Google Sheet, stops the server, and prints a pass/fail
summary. Exits non-zero if anything configured is actually broken. Safe
to run repeatedly — it cleans up after itself and won't leave test
noise in your real data.

## Running

```bash
npm start          # production
npm run dev         # auto-restart on file changes
```

Visit `http://localhost:4001` for the landing page.

## API

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/tenants/health` | none | `{ ok, enabled }` — module status |
| POST | `/api/tenants/submit` | none (rate-limited) | Submit a tenant application |
| GET | `/api/tenants/leads` | `x-admin-key` | List leads, optional `?band=GREEN\|YELLOW\|RED&status=new\|assigned` |
| GET | `/api/tenants/stats` | `x-admin-key` | Totals, band/status breakdown, conversion rate, 7/30-day counts |
| POST | `/api/tenants/leads/:id/assign` | `x-admin-key` | Body `{ assignedTo, note? }` — marks a lead assigned |
| DELETE | `/api/tenants/leads/:id` | `x-admin-key` | Removes a lead (local storage + the matching Google Sheet row, best-effort) |

Example admin call:

```bash
curl -H "x-admin-key: $TENANTS_ADMIN_API_KEY" http://localhost:4001/api/tenants/stats
```

## Turning it off

Set `TENANTS_MODULE_ENABLED=false` and restart — every `/api/tenants/*`
route (except `/health`) responds `503` without needing to remove or
redeploy anything.

## Deployment

### Render (recommended) — `./scripts/deploy-render.sh`

This generates `render.yaml` (Render's Blueprint config — non-secret
settings are baked in from your `.env`, actual secrets are marked
`sync: false` so they're never written to the file or committed), offers
to get this folder onto its own GitHub repo (asks before running any git
or `gh` command — nothing happens without you confirming), prints the
exact copy-paste steps for the Render dashboard, and polls the resulting
URL's health check until it's live so you get a confirmed working link
back, not just a guess.

Free tier covers this comfortably — it's a single small Node process with
file-based storage. Note: Render's free tier spins a service down after
15 minutes of inactivity and takes ~30-60s to wake back up on the next
request — fine for a lead form, just don't expect instant response on a
cold hit.

Doing it by hand instead: point a new Render web service at this subfolder
as its root directory, build command `npm install`, start command
`npm start`, and set the env vars from `.env.example` in the dashboard.

### Same instance as 860Leads, second process

Run both services on one host under a process manager (e.g. two Render
services on the same account, or two processes behind a reverse proxy).
This app listens on its own port (`PORT`/`TENANTS_PORT`, default 4001) and
doesn't touch the Next.js app's process, port, or database.

### Mounting into another Express app

`routes/tenants.js` exports a plain `express.Router()`, so it can be
mounted into any other Express server:

```js
const tenantsRouter = require('./tenant-leads-backend/routes/tenants');
app.use('/api/tenants', tenantsRouter);
```

(Not applicable to the main 860Leads app directly, since that's Next.js —
this is for mounting into a *different* Express host if one exists.)
