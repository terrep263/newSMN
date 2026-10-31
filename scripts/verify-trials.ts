/**
 * Free Trial Vendor system — behavioural verification matrix.
 *
 * Runs the real server code against a THROWAWAY SQLite database and asserts
 * each case. Stripe is never contacted: calls that would reach Stripe are
 * covered by pure-function checks or by feeding the same code paths a
 * Stripe-shaped event (see the connect-webhook cases).
 *
 *   bun run scripts/verify-trials.ts
 */
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SITE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const VERIFY_DB = resolve(SITE_ROOT, ".data", "verify-trials.db");
const LIVE_DB = resolve(SITE_ROOT, ".data", "marketplace.db");
if (VERIFY_DB === LIVE_DB) throw new Error("refusing to run against the live database");
process.env.MARKETPLACE_DB_PATH = VERIFY_DB;
delete process.env.STRIPE_SECRET_KEY;
mkdirSync(dirname(VERIFY_DB), { recursive: true });
for (const f of [VERIFY_DB, `${VERIFY_DB}-wal`, `${VERIFY_DB}-shm`]) rmSync(f, { force: true });

const { getDb } = await import("../src/server/db");
const trials = await import("../src/server/trials");
const { createVoucher } = await import("../src/server/repository");
const vendorsMod = await import("../src/server/vendors");
const { redeemVoucherCode, confirmVoucherPayment, getVoucherEvents } = await import("../src/server/voucher-lifecycle");
const { TRIAL } = await import("../src/lib/trial-rules");

class Failed extends Error {}
const outcomes: { n: number; ok: boolean }[] = [];
function expect(c: boolean, m: string): void { if (!c) throw new Failed(m); }
async function runCase(n: number, name: string, fn: () => Promise<string> | string): Promise<void> {
  try {
    const d = await fn();
    outcomes.push({ n, ok: true });
    console.log(`PASS  ${String(n).padStart(2, " ")}. ${name}${d ? ` — ${d}` : ""}`);
  } catch (e) {
    outcomes.push({ n, ok: false });
    console.log(`FAIL  ${String(n).padStart(2, " ")}. ${name}\n         ${e instanceof Failed ? e.message : `threw: ${(e as Error).message}`}`);
  }
}

const DAY = 86_400_000;
const db = getDb();
const FINE = "One voucher per visit. Valid for the item described. Not valid with other offers. The paid value never expires; the promotional discount ends with the redemption window.";

let seq = 0;
function makeVendor(citySlug: string, categorySlug: string, claim = true) {
  seq++;
  const v = vendorsMod.insertVendor({
    businessName: `Trial Biz ${seq}`, citySlug, categorySlug, email: `trial${seq}@example.com`,
    phone: null, tier: "free", passwordHash: "x",
  });
  const biz = db
    .query<{ id: number }, (string | number)[]>(
      `INSERT INTO businesses (osm_id, slug, name, category_slug, city_slug, city_name, osm_url, is_claimed, claimed_by_vendor_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'https://example.com', ?, ?, ?, ?) RETURNING id`,
    )
    .get(`osm-${seq}`, `trial-biz-${seq}`, `Trial Biz ${seq}`, categorySlug, citySlug, citySlug, claim ? 1 : 0, claim ? v.id : null, new Date().toISOString(), new Date().toISOString())!;
  if (claim)
    db.query("INSERT INTO listing_claims (business_id, vendor_id, status, method, created_at, decided_at) VALUES (?, ?, 'approved', 'manual', ?, ?)")
      .run(biz.id, v.id, new Date().toISOString(), new Date().toISOString());
  return { vendor: v, businessId: biz.id };
}
function connectStripe(vendorId: number) {
  db.query("UPDATE vendors SET stripe_connect_account_id = ?, stripe_connect_charges_enabled = 1, stripe_connect_details_submitted = 1 WHERE id = ?").run(`acct_test_${vendorId}`, vendorId);
}
function makeBuyer(n: number) {
  return db.query<{ id: number }, [string, string]>("INSERT INTO buyers (name, email, password_hash, created_at) VALUES (?, ?, 'x', datetime('now')) RETURNING id").get(`Buyer ${n}`, `buyer${n}@example.com`)!.id;
}
function draft(over: Record<string, unknown> = {}) {
  return {
    title: "Trial Tasting Special", description: "A verification deal created by the trial test script to exercise the rules.",
    highlights: ["One"], finePrint: FINE, priceCents: 2500, valueCents: 5000, voucherLimit: 100, perCustomerLimit: 5,
    redemptionStart: new Date(Date.now() - DAY).toISOString().slice(0, 10) + "T12:00:00.000Z",
    redemptionEnd: new Date(Date.now() + 60 * DAY).toISOString().slice(0, 10) + "T12:00:00.000Z",
    validDays: [] as string[], blackoutDates: [] as string[],
    redemptionInstructions: "Show your voucher code when you order.", acceptTerms: true, ...over,
  };
}
/** Fully live trial deal for a vendor: request, approve, save deal, approve deal, Stripe on. */
function goLive(citySlug: string, categorySlug: string) {
  const { vendor } = makeVendor(citySlug, categorySlug);
  const r = trials.requestTrial(vendor.id); if (!r.ok) throw new Failed(`request: ${r.message}`);
  const a = trials.approveTrial(r.trial.id); if (!a.ok) throw new Failed(`approve: ${a.message}`);
  connectStripe(vendor.id);
  const d = trials.saveTrialDeal(vendor.id, draft()); if (!d.ok) throw new Failed(`save: ${JSON.stringify(d)}`);
  const rv = trials.reviewTrialDeal(d.id, "approved", null); if (!rv.ok) throw new Failed(`review: ${rv.message}`);
  return { vendor, trialId: r.trial.id, dealId: d.id, slug: d.slug };
}
/** Inserts a Stripe-verified sale directly (the webhook path is covered separately). */
function verifiedSale(dealId: number, buyerId: number, qty = 1, createdAt = new Date().toISOString()) {
  const code = `T${Math.random().toString(36).slice(2, 7).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  db.query(
    `INSERT INTO vouchers (code, deal_id, buyer_name, buyer_email, quantity, amount_cents, status, created_at, confirmed_at, confirmed_via, buyer_id, stripe_payment_intent, order_ref)
     VALUES (?, ?, 'Buyer', 'b@example.com', ?, 2500, 'issued', ?, ?, 'stripe', ?, ?, ?)`,
  ).run(code, dealId, qty, createdAt, createdAt, buyerId, `pi_${code}`, code);
  db.query("UPDATE deals SET vouchers_sold = vouchers_sold + ? WHERE id = ?").run(qty, dealId);
  return code;
}

// =============================================================== ELIGIBILITY
await runCase(1, "no approved claim → trial request refused with the claim message", () => {
  const { vendor } = makeVendor("leesburg", "restaurants-cafes", false);
  const r = trials.requestTrial(vendor.id);
  expect(!r.ok, "expected refusal");
  expect(/Claim your business listing/.test((r as any).message), `message: ${(r as any).message}`);
  return (r as any).message;
});

let t1 = 0; let v1 = 0;
await runCase(2, "claimed business can request; approval sets expires_at = +6 months and live deadline = +30 days", () => {
  const { vendor } = makeVendor("leesburg", "restaurants-cafes"); v1 = vendor.id;
  const r = trials.requestTrial(vendor.id); expect(r.ok, "request failed");
  t1 = (r as any).trial.id;
  const a = trials.approveTrial(t1); expect(a.ok, `approve: ${(a as any).message}`);
  const t = trials.getTrial(t1)!;
  const months = (new Date(t.expires_at!).getUTCFullYear() - new Date(t.approved_at!).getUTCFullYear()) * 12 + new Date(t.expires_at!).getUTCMonth() - new Date(t.approved_at!).getUTCMonth();
  const days = Math.round((new Date(t.live_deadline_at!).getTime() - new Date(t.approved_at!).getTime()) / DAY);
  expect(t.status === "active" && months === 6 && days === 30, `status ${t.status}, ${months} months, ${days} days`);
  return `active; ${months} months; ${days} days`;
});

await runCase(3, "a second request from the same business/vendor is refused (one trial per business)", () => {
  const r = trials.requestTrial(v1);
  expect(!r.ok && /already used its one free trial/.test((r as any).message), `got ${JSON.stringify(r)}`);
  return (r as any).message;
});

await runCase(4, "another business in the same city+category is refused (one per category)", () => {
  const { vendor } = makeVendor("leesburg", "restaurants-cafes");
  const r = trials.requestTrial(vendor.id);
  expect(!r.ok && /Another business in your category/.test((r as any).message), `got ${JSON.stringify(r)}`);
  return (r as any).message;
});

await runCase(5, "Leesburg cap of 3: the 4th approval is refused; other cities are unaffected", () => {
  for (const cat of ["bars-nightlife", "local-retail-boutiques"]) {
    const { vendor } = makeVendor("leesburg", cat);
    const r = trials.requestTrial(vendor.id); expect(r.ok, "request");
    const a = trials.approveTrial((r as any).trial.id); expect(a.ok, `approve ${cat}`);
  }
  expect(trials.cityUsage("leesburg") === 3, `usage ${trials.cityUsage("leesburg")}`);
  const { vendor } = makeVendor("leesburg", "auto-repair-detailing");
  const r = trials.requestTrial(vendor.id);
  expect(!r.ok && /full in Leesburg/.test((r as any).message), `4th request: ${JSON.stringify(r)}`);
  const { vendor: other } = makeVendor("tavares", "restaurants-cafes");
  const r2 = trials.requestTrial(other.id);
  expect(r2.ok, "tavares should be open");
  return `leesburg 3/3 full; tavares open`;
});

await runCase(6, "no live deal after 30 days → sweep lapses the trial and frees the slot and category", () => {
  const { vendor } = makeVendor("eustis", "grocery-markets");
  const r = trials.requestTrial(vendor.id); const id = (r as any).trial.id; trials.approveTrial(id);
  const res = trials.sweepTrials(Date.now() + 31 * DAY);
  const t = trials.getTrial(id)!;
  expect(t.status === "lapsed" && t.end_reason === "lapsed", `status ${t.status}`);
  const { vendor: again } = makeVendor("eustis", "grocery-markets");
  expect(trials.requestTrial(again.id).ok, "category should be free again after a lapse");
  return `lapsed=${res.lapsed}; category freed`;
});

// ============================================================== THE TRIAL DEAL
let live: ReturnType<typeof goLive>;
await runCase(7, "price over $75 and limit over 100 are refused; the deal is created paused + pending review", () => {
  const { vendor } = makeVendor("mount-dora", "fitness-personal-training");
  const r = trials.requestTrial(vendor.id); trials.approveTrial((r as any).trial.id);
  const bad = trials.saveTrialDeal(vendor.id, draft({ priceCents: 7600, valueCents: 20000, voucherLimit: 101 }));
  expect(!bad.ok && /at most \$75/.test((bad as any).fields.price) && /at most 100/.test((bad as any).fields.voucherLimit), JSON.stringify(bad));
  const ok = trials.saveTrialDeal(vendor.id, draft()); expect(ok.ok, JSON.stringify(ok));
  const d = db.query<any, [number]>("SELECT status, review_state, paused_reason FROM deals WHERE id = ?").get((ok as any).id)!;
  expect(d.status === "paused" && d.review_state === "pending", JSON.stringify(d));
  const gate = trials.trialSaleGate((ok as any).id, 1);
  expect(!gate.ok, "gate must refuse an unreviewed deal");
  return `price ${(bad as any).fields.price} | created ${d.status}/${d.review_state}`;
});

await runCase(8, "a second trial deal is not possible: saving again edits the one deal", () => {
  const { vendor } = makeVendor("umatilla", "professional-services");
  const r = trials.requestTrial(vendor.id); trials.approveTrial((r as any).trial.id);
  const a = trials.saveTrialDeal(vendor.id, draft()); const b = trials.saveTrialDeal(vendor.id, draft({ title: "Another Title Entirely" }));
  const n = db.query<{ n: number }, [number]>("SELECT COUNT(*) n FROM deals WHERE vendor_id = ?").get(vendor.id)!.n;
  expect(a.ok && b.ok && (a as any).id === (b as any).id && n === 1, `deals: ${n}`);
  return `1 deal row`;
});

await runCase(9, "legacy createVoucher refuses a trial deal (no free-voucher hole)", () => {
  live = goLive("lady-lake", "spas-massage-wellness");
  const res = createVoucher({ slug: live.slug, buyerName: "Eve", buyerEmail: "eve@example.com", quantity: 1 });
  expect(!res.ok && (res as any).error === "unavailable", JSON.stringify(res));
  const n = db.query<{ n: number }, [number]>("SELECT COUNT(*) n FROM vouchers WHERE deal_id = ?").get(live.dealId)!.n;
  expect(n === 0, `${n} vouchers were created`);
  return "refused: unavailable, 0 vouchers created";
});

await runCase(10, "approved deal without Stripe waits; it goes live the moment Stripe can take payments", () => {
  const { vendor } = makeVendor("clermont", "hair-nails-barber-shops");
  const r = trials.requestTrial(vendor.id); trials.approveTrial((r as any).trial.id);
  const d = trials.saveTrialDeal(vendor.id, draft()) as any;
  trials.reviewTrialDeal(d.id, "approved", null);
  let row = db.query<any, [number]>("SELECT status, paused_reason FROM deals WHERE id = ?").get(d.id)!;
  expect(row.status === "paused" && row.paused_reason === "awaiting_stripe", JSON.stringify(row));
  expect(trials.getTrial((r as any).trial.id)!.first_live_at === null, "first_live_at set too early");
  connectStripe(vendor.id);
  expect(trials.publishTrialDealIfReady(d.id), "should publish");
  row = db.query<any, [number]>("SELECT status FROM deals WHERE id = ?").get(d.id)!;
  expect(row.status === "published" && !!trials.getTrial((r as any).trial.id)!.first_live_at, "not live");
  return "awaiting_stripe → published; first_live_at set";
});

await runCase(11, "editing a key field sends the deal back to review (paused); a blackout date does not", () => {
  const minor = trials.saveTrialDeal(live.vendor.id, draft({ blackoutDates: [new Date(Date.now() + 20 * DAY).toISOString().slice(0, 10)] })) as any;
  let row = db.query<any, [number]>("SELECT status, review_state FROM deals WHERE id = ?").get(live.dealId)!;
  expect(minor.ok && !minor.needsReview && row.status === "published" && row.review_state === "approved", `minor: ${JSON.stringify(row)} result ${JSON.stringify(minor)}`);
  const major = trials.saveTrialDeal(live.vendor.id, draft({ blackoutDates: [new Date(Date.now() + 20 * DAY).toISOString().slice(0, 10)], priceCents: 3000 })) as any;
  row = db.query<any, [number]>("SELECT status, review_state, paused_reason FROM deals WHERE id = ?").get(live.dealId)!;
  expect(major.ok && major.needsReview && row.status === "paused" && row.review_state === "pending", `major: ${JSON.stringify(row)}`);
  expect(!trials.trialSaleGate(live.dealId, 1).ok, "gate must refuse while in review");
  trials.reviewTrialDeal(live.dealId, "approved", null);
  expect(trials.trialSaleGate(live.dealId, 1).ok, "gate should reopen after approval");
  return "minor edit stayed live; price change → paused/pending → re-approved → live";
});

await runCase(12, "vendor cannot publish, edit or manually confirm a trial deal through the old paths", () => {
  const vendor = vendorsMod.getVendorById(live.vendor.id)!;
  const pub = vendorsMod.setDealStatus(vendor, live.dealId, "published");
  expect(!pub.ok, "setDealStatus must refuse");
  const upd = vendorsMod.updateDealForVendor(vendor, live.dealId, {} as any);
  expect(!upd.ok, "updateDealForVendor must refuse");
  const code = verifiedSale(live.dealId, makeBuyer(900));
  db.query("UPDATE vouchers SET status='pending_payment', confirmed_at=NULL, stripe_payment_intent=NULL WHERE code=?").run(code);
  const conf = vendorsMod.confirmVoucherForVendor(vendor.id, code);
  expect(!conf.ok && (conf as any).error === "trial_voucher", JSON.stringify(conf));
  return (conf as any).message;
});

// =============================================================== SALE GATE
await runCase(13, "daily limit: the 11th voucher today is refused and raises an alert", () => {
  const g = goLive("tavares", "local-retail-boutiques");
  const b = makeBuyer(1000);
  for (let i = 0; i < TRIAL.maxPerDay; i++) verifiedSale(g.dealId, b);
  const gate = trials.trialSaleGate(g.dealId, 1);
  expect(!gate.ok && /at most 10 vouchers a day/.test((gate as any).reason), JSON.stringify(gate));
  const alert = db.query<any, [number]>("SELECT kind FROM trial_alerts WHERE trial_id = ? AND kind = 'daily_limit'").get(g.trialId);
  expect(!!alert, "no daily_limit alert");
  return (gate as any).reason;
});

await runCase(14, "yesterday's sales don't count toward today's limit", () => {
  const g = goLive("groveland", "restaurants-cafes");
  const b = makeBuyer(1001);
  const yesterday = new Date(Date.now() - 30 * 3_600_000).toISOString();
  for (let i = 0; i < 10; i++) verifiedSale(g.dealId, b, 1, yesterday);
  expect(trials.trialSaleGate(g.dealId, 1).ok, "yesterday's 10 must not block today");
  return "gate open";
});

await runCase(15, "the 100th verified sale ends the trial, pauses the deal, and sold vouchers stay redeemable", () => {
  const g = goLive("minneola", "bars-nightlife");
  const b = makeBuyer(1002);
  const old = new Date(Date.now() - 3 * DAY).toISOString();
  for (let i = 0; i < 99; i++) verifiedSale(g.dealId, b, 1, old);
  const last = verifiedSale(g.dealId, b, 1);
  trials.afterVerifiedSale(g.dealId);
  const t = trials.getTrial(g.trialId)!;
  const d = db.query<any, [number]>("SELECT status, paused_reason FROM deals WHERE id = ?").get(g.dealId)!;
  expect(t.status === "ended" && t.end_reason === "sold_out" && d.status === "paused", `${t.status}/${t.end_reason}/${d.status}`);
  expect(!trials.trialSaleGate(g.dealId, 1).ok, "no more sales after the end");
  const red = redeemVoucherCode(g.vendor.id, last);
  expect(red.ok, `redeem after end: ${JSON.stringify(red)}`);
  return `ended/sold_out; deal paused; voucher ${last} redeemed after the trial ended`;
});

// ============================================================== COMPLAINTS
await runCase(16, "3 complaints from different buyers auto-pause the deal; a repeat from one buyer is refused", () => {
  const g = goLive("montverde", "home-repair-handyman-services");
  const buyers = [1, 2, 3].map((i) => makeBuyer(2000 + i));
  const codes = buyers.map((b) => verifiedSale(g.dealId, b));
  const r1 = trials.fileComplaint(buyers[0]!, codes[0]!, "The service was not what the deal described.");
  const dup = trials.fileComplaint(buyers[0]!, codes[0]!, "Again the service was not as described.");
  expect(r1.ok && !(r1 as any).paused && !dup.ok, `r1 ${JSON.stringify(r1)} dup ${JSON.stringify(dup)}`);
  trials.fileComplaint(buyers[1]!, codes[1]!, "They refused to honour the voucher at all.");
  expect(db.query<any, [number]>("SELECT status FROM deals WHERE id = ?").get(g.dealId)!.status === "published", "paused too early (2 complaints)");
  const r3 = trials.fileComplaint(buyers[2]!, codes[2]!, "Staff said the voucher was not valid here.");
  const d = db.query<any, [number]>("SELECT status, paused_reason FROM deals WHERE id = ?").get(g.dealId)!;
  expect(r3.ok && (r3 as any).paused && d.status === "paused" && d.paused_reason === "complaints", JSON.stringify(d));
  const vend = trials.vendorSetTrialDealPaused(g.vendor.id, false);
  expect(!vend.ok, "vendor must not be able to resume a complaint pause");
  const stranger = trials.fileComplaint(makeBuyer(2999), codes[0]!, "I never bought this but I am reporting it.");
  expect(!stranger.ok, "a non-buyer must not be able to complain");
  return "2 complaints: live; 3rd: auto-paused (complaints); vendor can't resume; non-buyer refused";
});

// ============================================================ END OF TRIAL
await runCase(17, "6 months reached → trial ends with reason expired", () => {
  const g = goLive("astatula", "professional-services");
  trials.sweepTrials(Date.now() + 186 * DAY);
  const t = trials.getTrial(g.trialId)!;
  expect(t.status === "ended" && t.end_reason === "expired", `${t.status}/${t.end_reason}`);
  return "ended/expired";
});

await runCase(18, "paid subscription ends the trial (upgrade); vendor self-terminate and admin terminate work", () => {
  const up = goLive("howey-in-the-hills", "restaurants-cafes");
  vendorsMod.setSubscription(up.vendor.id, { status: "active", tier: "starter" });
  const tu = trials.getTrial(up.trialId)!;
  expect(tu.status === "ended" && tu.end_reason === "upgraded", `${tu.status}/${tu.end_reason}`);
  const self = goLive("fruitland-park", "grocery-markets");
  expect(trials.vendorEndTrial(self.vendor.id).ok, "self end");
  expect(trials.getTrial(self.trialId)!.end_reason === "vendor_ended", "self reason");
  const adm = goLive("clermont", "fitness-personal-training");
  expect(trials.terminateTrial(adm.trialId, "policy").ok, "admin end");
  const ta = trials.getTrial(adm.trialId)!;
  expect(ta.status === "terminated" && ta.end_reason === "admin_terminated", `${ta.status}`);
  return "upgraded / vendor_ended / admin_terminated all recorded";
});

await runCase(19, "alerts: deadline within 7 days and 0 sales after 14 days live are raised once", () => {
  const near = makeVendor("eustis", "bars-nightlife");
  const r = trials.requestTrial(near.vendor.id); trials.approveTrial((r as any).trial.id);
  trials.sweepTrials(Date.now() + 25 * DAY);
  trials.sweepTrials(Date.now() + 26 * DAY);
  const dl = db.query<{ n: number }, [number]>("SELECT COUNT(*) n FROM trial_alerts WHERE trial_id = ? AND kind = 'deadline'").get((r as any).trial.id)!.n;
  expect(dl === 1, `deadline alerts: ${dl}`);
  const g = goLive("tavares", "hair-nails-barber-shops");
  trials.sweepTrials(Date.now() + 15 * DAY);
  trials.sweepTrials(Date.now() + 16 * DAY);
  const ns = db.query<{ n: number }, [number]>("SELECT COUNT(*) n FROM trial_alerts WHERE trial_id = ? AND kind = 'no_sales'").get(g.trialId)!.n;
  expect(ns === 1, `no_sales alerts: ${ns}`);
  return "deadline=1, no_sales=1 (deduped across sweeps)";
});

await runCase(20, "audit log records the lifecycle actions", () => {
  const n = db.query<{ n: number }, []>("SELECT COUNT(DISTINCT action) n FROM trial_audit").get()!.n;
  const acts = db.query<{ action: string }, []>("SELECT DISTINCT action FROM trial_audit ORDER BY action").all().map((r) => r.action);
  expect(n >= 8, `only ${n} distinct actions`);
  return acts.join(", ");
});

// ============================================================ STRIPE CONNECT
// Stripe is never contacted: fetch is replaced with a recorder that answers like Stripe.
const tsMod = await import("../src/server/trial-stripe");
const stripeMod = await import("../src/server/stripe");
process.env.STRIPE_SECRET_KEY = "sk_test_verify_only";
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_connect_verify";
type Call = { url: string; method: string; headers: Record<string, string>; body: string };
const calls: Call[] = [];
const sessions = new Map<string, any>();
const accounts = new Map<string, any>();
let sessionSeq = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(input);
  if (!url.startsWith("https://api.stripe.com")) return realFetch(input, init);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = String(v);
  const body = init.body ? String(init.body) : "";
  calls.push({ url, method: init.method ?? "GET", headers, body });
  const path = new URL(url).pathname.replace("/v1", "");
  const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
  if (path === "/accounts" && init.method === "POST") { accounts.set("acct_new", { id: "acct_new", charges_enabled: false, details_submitted: false }); return json(accounts.get("acct_new")); }
  if (path === "/account_links") return json({ url: "https://connect.stripe.com/setup/verify", expires_at: 0 });
  if (path.startsWith("/accounts/")) return json(accounts.get(path.split("/")[2]!) ?? { id: path.split("/")[2], charges_enabled: false, details_submitted: false });
  if (path === "/checkout/sessions" && init.method === "POST") {
    const p = new URLSearchParams(body);
    const id = `cs_test_${++sessionSeq}`;
    const sess = { id, url: `https://checkout.stripe.com/c/pay/${id}`, expires_at: Number(p.get("expires_at")), payment_status: "unpaid", status: "open", amount_total: Number(p.get("line_items[0][price_data][unit_amount]")) * Number(p.get("line_items[0][quantity]")), currency: "usd", metadata: { voucher_code: p.get("metadata[voucher_code]") }, payment_intent: null };
    sessions.set(id, sess);
    return json(sess);
  }
  if (path.endsWith("/expire")) { const sess = sessions.get(path.split("/")[3]!); if (sess && sess.payment_status !== "paid") sess.status = "expired"; return json(sess ?? {}); }
  if (path.startsWith("/checkout/sessions/")) return json(sessions.get(path.split("/")[3]!) ?? {});
  return new Response(JSON.stringify({ error: { message: `unmocked ${path}` } }), { status: 404 });
}) as typeof fetch;

function paidSession(id: string, over: Record<string, unknown> = {}) {
  const s = sessions.get(id)!; s.payment_status = "paid"; s.status = "complete"; s.payment_intent = `pi_${id}`; Object.assign(s, over); return s;
}

let stripeLive: ReturnType<typeof goLive>;
let buyerA = 0;
let checkoutCode = "";
let checkoutSession = "";
await runCase(21, "checkout is a direct charge on the vendor's own account with NO platform fee", async () => {
  stripeLive = goLive("lady-lake", "grocery-markets");
  buyerA = makeBuyer(3001);
  const r = await tsMod.startTrialCheckout({ buyerId: buyerA, slug: stripeLive.slug, quantity: 2, origin: "https://example.test" });
  expect(r.ok && /checkout\.stripe\.com/.test((r as any).url), JSON.stringify(r));
  const c = calls.filter((x) => x.url.endsWith("/checkout/sessions") && x.method === "POST").pop()!;
  expect(c.headers["stripe-account"] === `acct_test_${stripeLive.vendor.id}`, `Stripe-Account header: ${c.headers["stripe-account"]}`);
  expect(!/application_fee/.test(c.body), "application_fee found in request body");
  expect(/mode=payment/.test(c.body) && /unit_amount%5D=2500/.test(c.body) && /quantity%5D=2/.test(c.body), c.body);
  const v = db.query<any, [number]>("SELECT code, status, quantity, amount_cents, stripe_session_id, checkout_expires_at, buyer_id FROM vouchers WHERE deal_id = ?").get(stripeLive.dealId)!;
  expect(v.status === "pending_payment" && v.amount_cents === 5000 && !!v.stripe_session_id && v.buyer_id === buyerA, JSON.stringify(v));
  checkoutCode = v.code; checkoutSession = v.stripe_session_id;
  return `Stripe-Account=${c.headers["stripe-account"]}; no application_fee; pending voucher ${v.code}`;
});

await runCase(22, "a browser landing on the return URL does NOT validate the voucher", async () => {
  const before = db.query<any, [string]>("SELECT status, confirmed_at FROM vouchers WHERE code = ?").get(checkoutCode)!;
  const out = await tsMod.reconcileTrialVoucher(checkoutCode); // session still unpaid at Stripe
  const after = db.query<any, [string]>("SELECT status, confirmed_at FROM vouchers WHERE code = ?").get(checkoutCode)!;
  expect(out === "pending" && after.status === "pending_payment" && !after.confirmed_at, `${out} ${JSON.stringify(after)}`);
  const red = redeemVoucherCode(stripeLive.vendor.id, checkoutCode);
  expect(!red.ok, "unpaid voucher must not redeem");
  return `reconcile=${out}; redeem refused: ${(red as any).message.slice(0, 50)}`;
});

await runCase(23, "wrong amount, wrong account and unpaid sessions are all rejected", () => {
  const s = sessions.get(checkoutSession)!;
  const wrongAmt = tsMod.applyPaidSession({ ...s, payment_status: "paid", amount_total: 100 }, `acct_test_${stripeLive.vendor.id}`);
  const wrongAcct = tsMod.applyPaidSession({ ...s, payment_status: "paid" }, "acct_someone_else");
  const unpaid = tsMod.applyPaidSession({ ...s, payment_status: "unpaid" }, `acct_test_${stripeLive.vendor.id}`);
  expect(!wrongAmt.ok && !wrongAcct.ok && !unpaid.ok, JSON.stringify({ wrongAmt, wrongAcct, unpaid }));
  const v = db.query<any, [string]>("SELECT status, stripe_payment_intent FROM vouchers WHERE code = ?").get(checkoutCode)!;
  expect(v.status === "pending_payment" && !v.stripe_payment_intent, JSON.stringify(v));
  return `${(wrongAmt as any).reason} | ${(wrongAcct as any).reason} | ${(unpaid as any).reason}`;
});

await runCase(24, "a signed, paid event validates the voucher once; replaying it changes nothing", () => {
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", account: `acct_test_${stripeLive.vendor.id}`, data: { object: paidSession(checkoutSession) } });
  const t = Math.floor(Date.now() / 1000);
  const { createHmac } = require("node:crypto");
  const sig = `t=${t},v1=${createHmac("sha256", "whsec_connect_verify").update(`${t}.${body}`).digest("hex")}`;
  expect(stripeMod.verifyWebhookSignature(body, sig, stripeMod.connectWebhookSecret()), "valid signature rejected");
  expect(!stripeMod.verifyWebhookSignature(body + " ", sig, stripeMod.connectWebhookSecret()), "tampered body accepted");
  expect(!stripeMod.verifyWebhookSignature(body, sig, "whsec_other"), "wrong secret accepted");
  const evt = JSON.parse(body);
  const r1 = tsMod.applyPaidSession(evt.data.object, evt.account);
  const r2 = tsMod.applyPaidSession(evt.data.object, evt.account);
  const v = db.query<any, [string]>("SELECT status, confirmed_via, stripe_payment_intent FROM vouchers WHERE code = ?").get(checkoutCode)!;
  expect(r1.ok && (r1 as any).state === "confirmed" && r2.ok && (r2 as any).state === "already", JSON.stringify({ r1, r2 }));
  expect(v.status === "issued" && v.confirmed_via === "stripe" && !!v.stripe_payment_intent, JSON.stringify(v));
  const events = getVoucherEvents(db.query<{ id: number }, [string]>("SELECT id FROM vouchers WHERE code = ?").get(checkoutCode)!.id).map((e) => e.event);
  expect(events.filter((e) => e === "payment_confirmed").length === 1, `events: ${events.join(",")}`);
  return `issued via stripe; events ${events.join(" → ")}; signature ok / tampered rejected / wrong secret rejected`;
});

await runCase(25, "vendor sees buyer name + code only (never the buyer's email); redemption works", () => {
  const sales = vendorsMod.recentVendorVouchers(stripeLive.vendor.id, 10);
  const row = sales.find((x) => x.code === checkoutCode)!;
  expect(!!row && row.buyer_name === "Buyer 3001" && row.buyer_email === "", `sale row: ${JSON.stringify(row)}`);
  const lookup = vendorsMod.lookupVoucherForVendor(stripeLive.vendor.id, checkoutCode) as any;
  expect(lookup.ok && lookup.voucher.buyer_email === "" && lookup.voucher.buyer_name === "Buyer 3001", JSON.stringify(lookup.voucher ?? lookup));
  const red = redeemVoucherCode(stripeLive.vendor.id, checkoutCode);
  expect(red.ok, JSON.stringify(red));
  return `buyer_name="${row.buyer_name}", buyer_email="" ; redeemed`;
});

await runCase(26, "an abandoned checkout is released after the hold: expired + never redeemable + capacity returned", async () => {
  const g = goLive("tavares", "spas-massage-wellness");
  const b = makeBuyer(3002);
  const r = await tsMod.startTrialCheckout({ buyerId: b, slug: g.slug, quantity: 1, origin: "https://example.test" });
  expect(r.ok, JSON.stringify(r));
  const code = db.query<{ code: string }, [number]>("SELECT code FROM vouchers WHERE deal_id = ?").get(g.dealId)!.code;
  expect(trials.committedQuantity(g.dealId).held === 1, "hold not counted");
  db.query("UPDATE vouchers SET checkout_expires_at = ? WHERE code = ?").run(new Date(Date.now() - 60_000).toISOString(), code);
  const n = await tsMod.reconcileAbandonedCheckouts();
  const v = db.query<any, [string]>("SELECT status, confirmed_at FROM vouchers WHERE code = ?").get(code)!;
  const sold = db.query<{ vouchers_sold: number }, [number]>("SELECT vouchers_sold FROM deals WHERE id = ?").get(g.dealId)!.vouchers_sold;
  expect(n === 1 && v.status === "expired" && !v.confirmed_at && sold === 0, `${n} ${JSON.stringify(v)} sold=${sold}`);
  const red = redeemVoucherCode(g.vendor.id, code);
  expect(!red.ok && /never completed/.test((red as any).message), JSON.stringify(red));
  const sessionId = [...sessions.keys()].pop()!;
  expect(sessions.get(sessionId).status === "expired", "Stripe session was not expired before release");
  return `released; Stripe session expired first; redeem refused: "${(red as any).message.slice(0, 60)}…"; sold counter back to ${sold}`;
});

await runCase(27, "money safety: a session that was paid just before the hold ended is confirmed, not released", async () => {
  const g = goLive("eustis", "restaurants-cafes");
  const b = makeBuyer(3003);
  await tsMod.startTrialCheckout({ buyerId: b, slug: g.slug, quantity: 1, origin: "https://example.test" });
  const code = db.query<{ code: string }, [number]>("SELECT code FROM vouchers WHERE deal_id = ?").get(g.dealId)!.code;
  const sid = db.query<{ stripe_session_id: string }, [string]>("SELECT stripe_session_id FROM vouchers WHERE code = ?").get(code)!.stripe_session_id;
  paidSession(sid); // paid at Stripe, our webhook never arrived
  db.query("UPDATE vouchers SET checkout_expires_at = ? WHERE code = ?").run(new Date(Date.now() - 60_000).toISOString(), code);
  const out = await tsMod.reconcileTrialVoucher(code);
  const v = db.query<any, [string]>("SELECT status, stripe_payment_intent FROM vouchers WHERE code = ?").get(code)!;
  expect(out === "confirmed" && v.status === "issued" && !!v.stripe_payment_intent, `${out} ${JSON.stringify(v)}`);
  return "paid at Stripe + webhook missed → reconcile confirmed it (no lost sale)";
});

await runCase(28, "late payment on a released voucher is honoured and capacity is taken back", async () => {
  const g = goLive("umatilla", "bars-nightlife");
  const b = makeBuyer(3004);
  await tsMod.startTrialCheckout({ buyerId: b, slug: g.slug, quantity: 1, origin: "https://example.test" });
  const row = db.query<{ code: string; stripe_session_id: string }, [number]>("SELECT code, stripe_session_id FROM vouchers WHERE deal_id = ?").get(g.dealId)!;
  trials.releaseUnpaidTrialVoucher(row.code, "test");
  const s = paidSession(row.stripe_session_id);
  const r = tsMod.applyPaidSession(s, `acct_test_${g.vendor.id}`);
  const v = db.query<any, [string]>("SELECT status, confirmed_via FROM vouchers WHERE code = ?").get(row.code)!;
  const sold = db.query<{ vouchers_sold: number }, [number]>("SELECT vouchers_sold FROM deals WHERE id = ?").get(g.dealId)!.vouchers_sold;
  expect(r.ok && v.status === "issued" && sold === 1, `${JSON.stringify(r)} ${JSON.stringify(v)} sold=${sold}`);
  return "expired-unpaid → paid → issued; sold counter restored";
});

await runCase(29, "refund recorded from Stripe (charge.refunded) marks the voucher refunded; vendor cannot fake one", () => {
  const code = checkoutCode; // redeemed in case 25; use a fresh issued one
  const g = goLive("clermont", "professional-services");
  const c = verifiedSale(g.dealId, makeBuyer(3005));
  const pi = db.query<{ stripe_payment_intent: string }, [string]>("SELECT stripe_payment_intent FROM vouchers WHERE code = ?").get(c)!.stripe_payment_intent;
  const manual = vendorsMod.refundVoucherForVendor(g.vendor.id, c);
  expect(!manual.ok && (manual as any).error === "trial_voucher", JSON.stringify(manual));
  const ok = tsMod.applyChargeRefunded({ payment_intent: pi, refunded: true, amount: 2500, amount_refunded: 2500 }, `acct_test_${g.vendor.id}`);
  const wrongAcct = tsMod.applyChargeRefunded({ payment_intent: pi, refunded: true }, "acct_other");
  const v = db.query<any, [string]>("SELECT status FROM vouchers WHERE code = ?").get(c)!;
  expect(ok && v.status === "refunded" && !wrongAcct, `${ok} ${wrongAcct} ${v.status}`);
  void code;
  return "vendor manual refund refused (use Stripe); Stripe refund event → refunded";
});

await runCase(30, "Connect onboarding creates a Standard account once and returns Stripe's hosted link", async () => {
  const { vendor } = makeVendor("minneola", "grocery-markets");
  const r = trials.requestTrial(vendor.id); trials.approveTrial((r as any).trial.id);
  const out = await tsMod.startConnectOnboarding(vendor.id, "https://example.test");
  const out2 = await tsMod.startConnectOnboarding(vendor.id, "https://example.test");
  const created = calls.filter((c) => c.url.endsWith("/accounts") && c.method === "POST");
  const last = created[created.length - 1]!;
  expect(out.ok && out2.ok && created.length === 1 && /type=standard/.test(last.body), `${JSON.stringify(out)} accounts created: ${created.length}`);
  expect(!!last.headers["idempotency-key"], "no idempotency key on account creation");
  const row = db.query<any, [number]>("SELECT stripe_connect_account_id, stripe_connect_charges_enabled FROM vendors WHERE id = ?").get(vendor.id)!;
  expect(row.stripe_connect_account_id === "acct_new" && row.stripe_connect_charges_enabled === 0, JSON.stringify(row));
  return `type=standard, created once, link ${(out as any).url}`;
});

await runCase(31, "account.updated (charges enabled) publishes an approved deal that was waiting on Stripe", () => {
  const { vendor } = makeVendor("montverde", "bars-nightlife");
  const r = trials.requestTrial(vendor.id); trials.approveTrial((r as any).trial.id);
  db.query("UPDATE vendors SET stripe_connect_account_id = 'acct_wait' WHERE id = ?").run(vendor.id);
  const d = trials.saveTrialDeal(vendor.id, draft()) as any;
  trials.reviewTrialDeal(d.id, "approved", null);
  expect(db.query<any, [number]>("SELECT status FROM deals WHERE id = ?").get(d.id)!.status === "paused", "should wait");
  tsMod.applyAccountState({ id: "acct_wait", charges_enabled: true, details_submitted: true });
  const after = db.query<any, [number]>("SELECT status FROM deals WHERE id = ?").get(d.id)!;
  expect(after.status === "published" && !!trials.getTrial((r as any).trial.id)!.first_live_at, JSON.stringify(after));
  return "waiting → account.updated → published";
});

await runCase(32, "end-to-end: 100 Stripe-verified sales end the trial through the real payment path", async () => {
  const g = goLive("groveland", "hair-nails-barber-shops");
  db.query("UPDATE deals SET per_customer_limit = 5 WHERE id = ?").run(g.dealId);
  const old = new Date(Date.now() - 3 * DAY).toISOString();
  const b0 = makeBuyer(3100);
  for (let i = 0; i < 98; i++) verifiedSale(g.dealId, b0, 1, old);
  const b = makeBuyer(3101);
  const r = await tsMod.startTrialCheckout({ buyerId: b, slug: g.slug, quantity: 2, origin: "https://example.test" });
  expect(r.ok, JSON.stringify(r));
  const row = db.query<{ stripe_session_id: string }, [number]>("SELECT stripe_session_id FROM vouchers WHERE buyer_id = ?").get(b)!;
  const over = await tsMod.startTrialCheckout({ buyerId: makeBuyer(3102), slug: g.slug, quantity: 1, origin: "https://example.test" });
  expect(!over.ok, "a 101st unit must be refused while 100 are committed");
  tsMod.applyPaidSession(paidSession(row.stripe_session_id), `acct_test_${g.vendor.id}`);
  const t = trials.getTrial(g.trialId)!;
  expect(t.status === "ended" && t.end_reason === "sold_out", `${t.status}/${t.end_reason}`);
  return `98 + 2 = 100 verified → ended/sold_out; 101st refused: "${(over as any).message}"`;
});

// ------------------------------------------------------------------ summary
const failed = outcomes.filter((o) => !o.ok);
console.log(`\n${outcomes.length - failed.length}/${outcomes.length} cases passed${failed.length ? ` — FAILED: ${failed.map((f) => f.n).join(", ")}` : " — all green"}`);
console.log(`Database used: ${VERIFY_DB}`);
process.exit(failed.length ? 1 : 0);
