// One-off Stripe setup, run inside the production container:
//   bun run scripts/stripe-setup.ts
// Uses STRIPE_SECRET_KEY from the environment. Checks the key and the three tier
// prices, creates the webhook endpoint for SITE_ORIGIN, and saves the signing
// secret to <data dir>/stripe-webhook-secret. Prints pass/fail only, never a secret.

import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const KEY = (process.env.STRIPE_SECRET_KEY ?? "").trim();
const ORIGIN = (process.env.SITE_ORIGIN ?? "").trim().replace(/\/+$/, "");
const DB = process.env.MARKETPLACE_DB_PATH ?? "";
const PRICES = {
  starter: "price_1UUZysRjf5f49qKtnn6PQzBP",
  pro: "price_1UUZysRjf5f49qKtwjZnOEku",
  enterprise: "price_1UUZysRjf5f49qKtWEBgJJKd",
};
const EVENTS = ["checkout.session.completed", "customer.subscription.updated", "customer.subscription.deleted", "invoice.payment_failed"];

if (!KEY) { console.log("FAIL STRIPE_SECRET_KEY is not set in this container"); process.exit(1); }
if (!ORIGIN || !DB) { console.log("FAIL SITE_ORIGIN or MARKETPLACE_DB_PATH is not set"); process.exit(1); }

async function api(method: string, path: string, form?: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": "2024-06-20" },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const json = (await res.json().catch(() => null)) as any;
  return { ok: res.ok, status: res.status, json };
}

let failed = false;
const mode = KEY.startsWith("sk_live_") || KEY.startsWith("rk_live_") ? "live" : KEY.startsWith("sk_test_") || KEY.startsWith("rk_test_") ? "test" : "unknown";
console.log(`key mode: ${mode}`);

for (const [name, id] of Object.entries(PRICES)) {
  const r = await api("GET", `/prices/${id}`);
  const ok = r.ok && r.json?.active === true && r.json?.recurring?.interval === "month";
  console.log(`${ok ? "PASS" : "FAIL"} price ${name}${r.ok ? ` (${r.json?.unit_amount} ${r.json?.currency}/month, active=${r.json?.active})` : ` (${r.json?.error?.message ?? r.status})`}`);
  if (!ok) failed = true;
}
if (failed) { console.log("STOP: price check failed; webhook not created."); process.exit(1); }

const url = `${ORIGIN}/api/stripe/webhook`;
const file = join(dirname(DB), "stripe-webhook-secret");
const list = await api("GET", "/webhook_endpoints?limit=100");
if (!list.ok) { console.log(`FAIL list webhook endpoints (${list.json?.error?.message ?? list.status})`); process.exit(1); }
const existing = (list.json.data as any[]).filter((e) => e.url === url);
if (existing.length && existsSync(file)) { console.log(`PASS webhook already set up (${existing[0].id}) and secret file present`); process.exit(0); }
for (const e of existing) {
  const d = await api("DELETE", `/webhook_endpoints/${e.id}`);
  console.log(`${d.ok ? "removed" : "FAIL removing"} stale endpoint ${e.id}`);
  if (!d.ok) process.exit(1);
}
const form: Record<string, string> = { url, description: "Shop My Neighborhood vendor subscriptions" };
EVENTS.forEach((ev, i) => (form[`enabled_events[${i}]`] = ev));
const created = await api("POST", "/webhook_endpoints", form);
if (!created.ok || !created.json?.secret) { console.log(`FAIL create webhook (${created.json?.error?.message ?? created.status})`); process.exit(1); }
writeFileSync(file, created.json.secret + "\n", { mode: 0o600 });
try { chmodSync(file, 0o600); } catch {}
console.log(`PASS webhook ${created.json.id} created for ${url}; signing secret saved to ${file}`);
