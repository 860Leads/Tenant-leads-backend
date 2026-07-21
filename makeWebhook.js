/**
 * Posts the lead to a Make.com scenario webhook, following the same
 * "one configurable webhook URL, raw JSON payload" pattern used by
 * 860Leads' other Make.com workflows. Best-effort: throws on failure.
 */
async function postToMakeWebhook(lead, config) {
  if (!config.makeWebhookUrl) {
    return { skipped: true, reason: 'MAKE_TENANTS_WEBHOOK_URL not configured' };
  }
  const res = await fetch(config.makeWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(lead),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Make.com webhook error ${res.status}: ${body}`);
  }
  return { skipped: false };
}

module.exports = { postToMakeWebhook };
