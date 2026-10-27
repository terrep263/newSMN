/**
 * Verifies the email notifications against a throwaway database and a fake Resend endpoint:
 * the three triggers send the right message to the right person, and a failed or
 * missing-key send never breaks the action. Run: bun run verify:mail
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DB = resolve(ROOT, ".data", "verify-mail.db");
const FIXTURE = resolve(ROOT, ".data", "verify-mail-osm.json");
process.env.MARKETPLACE_DB_PATH = DB;
process.env.SITE_ORIGIN = "https://new.example.test";
mkdirSync(dirname(DB), { recursive: true });
for (const f of [DB, `${DB}-wal`, `${DB}-shm`, FIXTURE]) rmSync(f, { force: true });

type Sent = { to: string[]; subject: string; text: string; from: string; reply_to?: string; auth: string | null };
const sent: Sent[] = [];
let mode: "ok" | "fail" = "ok";
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  if (String(input) === "https://api.resend.com/emails") {
    if (mode === "fail") return new Response("boom", { status: 500 });
    const body = JSON.parse(init.body);
    sent.push({ ...body, auth: init.headers.authorization });
    return new Response('{"id":"fake"}', { status: 200 });
  }
  return realFetch(input, init);
}) as typeof fetch;

const db = (await import("../src/server/db")).getDb();
const vendors = await import("../src/server/vendors");
const claims = await import("../src/server/listing-claims");
const lifecycle = await import("../src/server/voucher-lifecycle");
const mail = await import("../src/server/mail");

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); if (!ok) failed++; };
const settle = () => Bun.sleep(150);

// No key: skipped, no throw.
delete process.env.RESEND_API_KEY;
check("no API key: send is skipped without throwing", (await mail.sendMail({ to: "a@b.test", subject: "s", text: "t" })) === false && sent.length === 0);

process.env.RESEND_API_KEY = "re_test_key";
process.env.MAIL_REPLY_TO = "owner@reply.test";
check("API error: send returns false without throwing", await (async () => { mode = "fail"; const r = await mail.sendMail({ to: "a@b.test", subject: "s", text: "t" }); mode = "ok"; return r === false; })());
check("accepted send carries bearer key, sender and reply-to", await (async () => { const r = await mail.sendMail({ to: "a@b.test", subject: "hello", text: "t" }); const m = sent.at(-1)!; return r && m.auth === "Bearer re_test_key" && m.from.includes("hello@shopmyneighborhood.com") && m.reply_to === "owner@reply.test"; })());
sent.length = 0;

// Welcome email text (the signup handler calls exactly this with the new vendor).
const w = mail.welcomeEmail({ email: "new@vendor.test", business_name: "Test Cafe" });
check("welcome email addressed to the vendor with dashboard link", w.to === "new@vendor.test" && w.text.includes("Test Cafe") && w.text.includes("https://new.example.test/vendor/dashboard"));

// Claim emails: auto-approve, admin approve, admin reject.
writeFileSync(FIXTURE, JSON.stringify([
  { osm: "node/m-auto", osm_url: "https://www.openstreetmap.org/node/m-auto", name: "Auto Mail Biz", category_slug: "local-retail-boutiques", street: "1 A St", postcode: "32757", lat: 28.8, lon: -81.6, phone: "(352) 555-0101", website: "https://automail.example.com", opening_hours: null, description: "x" },
  { osm: "node/m-yes", osm_url: "https://www.openstreetmap.org/node/m-yes", name: "Approve Mail Biz", category_slug: "local-retail-boutiques", street: "2 A St", postcode: "32757", lat: 28.8, lon: -81.6, phone: "(352) 555-0102", website: "https://approvemail.example.com", opening_hours: null, description: "x" },
  { osm: "node/m-no", osm_url: "https://www.openstreetmap.org/node/m-no", name: "Reject Mail Biz", category_slug: "local-retail-boutiques", street: "3 A St", postcode: "32757", lat: 28.8, lon: -81.6, phone: "(352) 555-0103", website: "https://rejectmail.example.com", opening_hours: null, description: "x" },
]));
const ing = Bun.spawn(["bun", "run", "scripts/ingest-osm.ts", FIXTURE], { cwd: ROOT, env: { ...process.env, MARKETPLACE_DB_PATH: DB }, stdout: "pipe", stderr: "pipe" });
if ((await ing.exited) !== 0) throw new Error(await new Response(ing.stderr).text());
const mk = (name: string, email: string) => vendors.insertVendor({ businessName: name, citySlug: "mount-dora", categorySlug: "local-retail-boutiques", email, phone: null, tier: "free", passwordHash: "verification-only-not-a-password" });
const biz = (osm: string) => db.query<{ id: number }, [string]>("SELECT id FROM businesses WHERE osm_id = ?").get(osm)!.id;

const auto = mk("Auto V", "me@automail.example.com");
const r1 = await claims.submitListingClaimForVendor(auto, { businessId: biz("node/m-auto") });
await settle();
check("auto-approved claim emails the vendor", r1.ok && sent.length === 1 && sent[0].to[0] === "me@automail.example.com" && sent[0].subject === "Your listing claim is approved" && sent[0].text.includes("Auto Mail Biz"));
sent.length = 0;

const yes = mk("Yes V", "yes@elsewhere.test"), no = mk("No V", "no@elsewhere.test");
await claims.submitListingClaimForVendor(yes, { businessId: biz("node/m-yes") });
await claims.submitListingClaimForVendor(no, { businessId: biz("node/m-no") });
await settle(); check("pending claims send nothing", sent.length === 0);
const claimId = (v: number) => db.query<{ id: number }, [number]>("SELECT id FROM listing_claims WHERE vendor_id = ?").get(v)!.id;
const a = await claims.decideListingClaimForAdmin(true, { claimId: claimId(yes.id), decision: "approved" });
await settle();
check("admin approval emails the vendor", a.ok && sent.length === 1 && sent[0].to[0] === "yes@elsewhere.test" && sent[0].subject === "Your listing claim is approved");
sent.length = 0;
const rj = await claims.decideListingClaimForAdmin(true, { claimId: claimId(no.id), decision: "rejected" });
await settle();
check("admin rejection emails the vendor", rj.ok && sent.length === 1 && sent[0].to[0] === "no@elsewhere.test" && sent[0].subject === "Update on your listing claim" && sent[0].text.includes("Reject Mail Biz"));
sent.length = 0;
const bad = await claims.decideListingClaimForAdmin(false, { claimId: 1, decision: "approved" });
await settle(); check("unauthorized decision sends nothing", !bad.ok && sent.length === 0);

// Voucher confirmed.
const deal = db.query<{ id: number; slug: string; title: string }, []>("SELECT id, slug, title FROM deals ORDER BY id LIMIT 1").get()!;
const seller = mk("Seller", "seller@deals.test");
db.query("UPDATE deals SET vendor_id = ?, is_sample = 0, status = 'published' WHERE id = ?").run(seller.id, deal.id);
const now = new Date().toISOString();
db.query("INSERT INTO vouchers (code, deal_id, buyer_name, buyer_email, quantity, amount_cents, status, created_at, order_ref) VALUES ('MAILTEST1', ?, 'Pat Buyer', 'pat@buyer.test', 2, 1500, 'pending_payment', ?, 'ORD-MAIL-1')").run(deal.id, now);
const c1 = lifecycle.confirmVoucherPayment({ code: "MAILTEST1", via: "manual", vendorId: seller.id });
await settle();
check("confirmed voucher emails the deal's vendor", c1.ok && sent.length === 1 && sent[0].to[0] === "seller@deals.test" && sent[0].text.includes("MAILTEST1") && sent[0].text.includes("Pat Buyer") && sent[0].text.includes("$15.00") && sent[0].subject.includes(deal.title));
sent.length = 0;
const c2 = lifecycle.confirmVoucherPayment({ code: "MAILTEST1", via: "manual", vendorId: seller.id });
await settle(); check("repeat confirmation sends no second email", !c2.ok && sent.length === 0);

// A failing provider must not break confirmation.
db.query("INSERT INTO vouchers (code, deal_id, buyer_name, buyer_email, quantity, amount_cents, status, created_at, order_ref) VALUES ('MAILTEST2', ?, 'Sam Buyer', 'sam@buyer.test', 1, 700, 'pending_payment', ?, 'ORD-MAIL-2')").run(deal.id, now);
mode = "fail";
const c3 = lifecycle.confirmVoucherPayment({ code: "MAILTEST2", via: "manual", vendorId: seller.id });
await settle(); mode = "ok";
check("provider failure does not break the voucher confirmation", c3.ok && c3.voucher.status === "issued");

for (const f of [DB, `${DB}-wal`, `${DB}-shm`, FIXTURE]) rmSync(f, { force: true });
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll mail checks passed");
process.exit(failed ? 1 : 0);
