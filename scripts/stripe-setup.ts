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
import { TIERS } from "../src/lib/tiers";
const PAID = TIERS.filter((t) => t.id !== "free");
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

for (const t of PAID) {
  const key = `smn_${t.id}_monthly`;
  const found = await api("GET", `/prices?lookup_keys[]=${key}&active=true&limit=1`);
  let price = found.ok ? found.json?.data?.[0] : null;
  if (!price) {
    const prod = await api("POST", "/products", { name: `Shop My Neighborhood ${t.name}`, "metadata[tier]": t.id });
    if (!prod.ok) { console.log(`FAIL create product ${t.id} (${prod.json?.error?.message ?? prod.status})`); failed = true; continue; }
    const created = await api("POST", "/prices", { product: prod.json.id, currency: "usd", unit_amount: String(t.priceCents), "recurring[interval]": "month", lookup_key: key });
    if (!created.ok) { console.log(`FAIL create price ${t.id} (${created.json?.error?.message ?? created.status})`); failed = true; continue; }
    price = created.json;
    console.log(`created ${t.id} price`);
  }
  const ok = price.active === true && price.unit_amount === t.priceCents && price.recurring?.interval === "month";
  const matches = price.id === t.stripePriceId;
  console.log(`${ok && matches ? "PASS" : "FAIL"} price ${t.id} ${price.unit_amount} ${price.currency}/month id=${price.id}${matches ? "" : " (tiers.ts must be set to this id)"}`);
  if (!ok || !matches) failed = true;
}
if (failed) { console.log("STOP: price check not clean; webhook not created."); process.exit(1); }

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
