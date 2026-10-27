#!/usr/bin/env bun
/**
 * Directory listing claim behavioural verification.
 *
 * This script always runs against a THROWAWAY database. It seeds its own OSM
 * listings via the real importer and vendors via the real vendor store, then
 * exercises the same server-side claim/edit/admin code that the routes call.
 */
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";

const SITE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const VERIFY_DB = resolve(SITE_ROOT, ".data", "verify-claims.db");
const LIVE_DB = resolve(SITE_ROOT, ".data", "marketplace.db");
const FIXTURE_JSON = resolve(SITE_ROOT, ".data", "verify-claims-osm.json");
const INGEST_COPY = resolve(SITE_ROOT, ".data", "verify-claims-ingest-copy.db");

if (VERIFY_DB === LIVE_DB) throw new Error(`refusing to run: verify path resolved to the live database (${LIVE_DB})`);
process.env.MARKETPLACE_DB_PATH = VERIFY_DB;
delete process.env.ADMIN_CLAIM_TOKEN;
mkdirSync(dirname(VERIFY_DB), { recursive: true });
for (const file of [VERIFY_DB, `${VERIFY_DB}-wal`, `${VERIFY_DB}-shm`, FIXTURE_JSON, INGEST_COPY, `${INGEST_COPY}-wal`, `${INGEST_COPY}-shm`]) rmSync(file, { force: true });

// These imports deliberately happen after MARKETPLACE_DB_PATH is set.
const dbModule = await import("../src/server/db");
const vendors = await import("../src/server/vendors");
const claims = await import("../src/server/listing-claims");
if (dbModule.DB_FILE !== VERIFY_DB) throw new Error(`wrong database: db.ts opened ${dbModule.DB_FILE}, expected ${VERIFY_DB}`);
const db = dbModule.getDb();

type CaseOutcome = { n: number; name: string; ok: boolean; detail: string };
const outcomes: CaseOutcome[] = [];
class Failed extends Error {}
function expect(value: unknown, detail: string): asserts value { if (!value) throw new Failed(detail); }
function equal<T>(actual: T, expected: T, label: string) { if (actual !== expected) throw new Failed(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
async function runCase(n: number, name: string, fn: () => Promise<string> | string) {
  try {
    const detail = await fn(); outcomes.push({ n, name, ok: true, detail });
    console.log(`PASS  ${String(n).padStart(2, " ")}. ${name} — ${detail}`);
  } catch (error) {
    const detail = error instanceof Failed ? error.message : `threw: ${(error as Error).message}`;
    outcomes.push({ n, name, ok: false, detail });
    console.log(`FAIL  ${String(n).padStart(2, " ")}. ${name}\n         server said: ${detail}`);
  }
}
function business(osmId: string) {
  const row = db.query<{ id: number; slug: string; city_slug: string; website: string | null; is_claimed: number; claimed_by_vendor_id: number | null; phone: string | null; opening_hours: string | null; description: string | null }, [string]>(
    "SELECT id, slug, city_slug, website, is_claimed, claimed_by_vendor_id, phone, opening_hours, description FROM businesses WHERE osm_id = ?",
  ).get(osmId);
  if (!row) throw new Failed(`imported OSM business ${osmId} was not found`);
  return row;
}
function claimFor(vendorId: number, businessId: number) {
  const row = db.query<{ id: number; status: string; method: string }, [number, number]>("SELECT id, status, method FROM listing_claims WHERE vendor_id = ? AND business_id = ?").get(vendorId, businessId);
  if (!row) throw new Failed(`claim for vendor ${vendorId}, business ${businessId} is missing`);
  return row;
}
function makeVendor(name: string, email: string) {
  return vendors.insertVendor({ businessName: name, citySlug: "mount-dora", categorySlug: "local-retail-boutiques", email, phone: null, tier: "free", passwordHash: "verification-only-not-a-password" });
}

const osm = (id: string, name: string, website: string | null, extra: Record<string, unknown> = {}) => ({
  osm: id, osm_url: `https://www.openstreetmap.org/${id}`, name, category_slug: "local-retail-boutiques",
  street: "101 Verification Way", postcode: "32757", lat: 28.8025, lon: -81.6445,
  phone: "(352) 555-0100", website, opening_hours: "Mo-Fr 09:00-17:00", description: "OpenStreetMap source description.", ...extra,
});
writeFileSync(FIXTURE_JSON, JSON.stringify([
  osm("node/verify-auto-a", "Auto Domain A", "HTTPS://WWW.Owner.Example.com/about"),
  osm("node/verify-auto-b", "Auto Domain B", "https://bowner.example.com"),
  osm("node/verify-manual", "Manual Match Fail", "https://listing-owner.example.com"),
  osm("node/verify-no-site", "No Website Listing", null),
  osm("node/verify-pending-two", "Second Pending Listing", "https://second-pending.example.com"),
  osm("node/verify-pending-third", "Third Pending Listing", "https://third-pending.example.com"),
  osm("node/verify-admin-approve", "Admin Approve Listing", "https://approve-owner.example.com"),
  osm("node/verify-admin-reject", "Admin Reject Listing", "https://reject-owner.example.com"),
  osm("node/verify-unclaimed", "Unclaimed OSM Listing", "https://unclaimed-osm.example.com", { phone: "(352) 555-0199", description: "Original OSM description stays visible until claimed." }),
], null, 2));
const ingest = Bun.spawn(["bun", "run", "scripts/ingest-osm.ts", FIXTURE_JSON], { cwd: SITE_ROOT, env: { ...process.env, MARKETPLACE_DB_PATH: VERIFY_DB }, stdout: "pipe", stderr: "pipe" });
if ((await ingest.exited) !== 0) throw new Error(`fixture ingest failed: ${await new Response(ingest.stderr).text()}`);

const a = makeVendor("Auto A Vendor", "OWNER@owner.example.com");
const b = makeVendor("Auto B Vendor", "manager@bowner.example.com");
const mismatch = makeVendor("Mismatch Vendor", "owner@not-the-listing.example.com");
const noSite = makeVendor("No Site Vendor", "owner@no-site.example.com");
const contender = makeVendor("Contender Vendor", "contender@owner.example.com");
const pendingVendor = makeVendor("Pending Vendor", "pending@pending-vendor.example.com");
const unapproved = makeVendor("Unapproved Vendor", "unapproved@example.com");
const approveVendor = makeVendor("Approve Vendor", "approve@different.example.com");
const rejectVendor = makeVendor("Reject Vendor", "reject@different.example.com");

let vite: ReturnType<typeof Bun.spawn> | null = null;
async function startVite(port: number, adminToken?: string) {
  vite?.kill();
  const env = { ...process.env, MARKETPLACE_DB_PATH: VERIFY_DB } as Record<string, string | undefined>;
  if (adminToken) env.ADMIN_CLAIM_TOKEN = adminToken; else delete env.ADMIN_CLAIM_TOKEN;
  vite = Bun.spawn(["bun", "--bun", "vite", "dev", "--host", "127.0.0.1", "--port", String(port)], { cwd: SITE_ROOT, env, stdout: "pipe", stderr: "pipe" });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { const response = await fetch(`${base}/`, { redirect: "manual" }); if (response.status > 0) return base; } catch { /* wait for Vite */ }
    await Bun.sleep(150);
  }
  const stderr = vite ? await new Response(vite.stderr).text() : "no process";
  throw new Failed(`Vite did not start for route verification: ${stderr}`);
}

await runCase(1, "matching email and website domains auto-approve the claim", async () => {
  const target = business("node/verify-auto-a");
  const result = await claims.submitListingClaimForVendor(a, { businessId: target.id, proofNote: "Owner" });
  expect(result.ok, result.message); equal(result.status, "approved", "claim result status");
  const stored = claimFor(a.id, target.id); equal(stored.status, "approved", "stored claim status"); equal(stored.method, "auto_domain", "stored claim method");
  const row = business("node/verify-auto-a"); equal(row.is_claimed, 1, "business is_claimed"); equal(row.claimed_by_vendor_id, a.id, "claimed owner");
  return result.message;
});

await runCase(2, "mismatched-domain and no-website claims remain manual pending", async () => {
  const mismatchedTarget = business("node/verify-manual");
  const noSiteTarget = business("node/verify-no-site");
  const one = await claims.submitListingClaimForVendor(mismatch, { businessId: mismatchedTarget.id });
  const two = await claims.submitListingClaimForVendor(noSite, { businessId: noSiteTarget.id });
  expect(one.ok, one.message); expect(two.ok, two.message); equal(one.status, "pending", "mismatch status"); equal(two.status, "pending", "no-site status");
  equal(claimFor(mismatch.id, mismatchedTarget.id).method, "manual", "mismatch method"); equal(claimFor(noSite.id, noSiteTarget.id).method, "manual", "no-site method");
  equal(business("node/verify-manual").is_claimed, 0, "mismatch is_claimed"); equal(business("node/verify-no-site").is_claimed, 0, "no-site is_claimed");
  return one.message;
});

await runCase(3, "a second vendor is refused when a business is already claimed", async () => {
  const result = await claims.submitListingClaimForVendor(contender, { businessId: business("node/verify-auto-a").id });
  expect(!result.ok, "expected a refusal"); expect(/already been claimed/.test(result.message), `unexpected message: ${result.message}`);
  return result.message;
});

await runCase(4, "one pending claim is the vendor limit and a second request explains it", async () => {
  const first = await claims.submitListingClaimForVendor(pendingVendor, { businessId: business("node/verify-pending-two").id });
  expect(first.ok && first.status === "pending", first.message);
  // A separate imported listing makes this the vendor pending limit, not duplicate listing protection.
  const secondId = business("node/verify-pending-third").id;
  const second = await claims.submitListingClaimForVendor(pendingVendor, { businessId: secondId });
  expect(!second.ok, "expected the second pending claim to be refused"); expect(/already have a claim awaiting review/.test(second.message), `unexpected message: ${second.message}`);
  return `limit: one pending claim per vendor. ${second.message}`;
});

await runCase(5, "an owner cannot edit another vendor's supplied business id", async () => {
  const own = await claims.submitListingClaimForVendor(b, { businessId: business("node/verify-auto-b").id });
  expect(own.ok && own.status === "approved", own.message);
  const before = business("node/verify-auto-a").description;
  const result = await claims.updateOwnedListingForVendor(b, { businessId: business("node/verify-auto-a").id, description: "Attempted hostile edit" });
  expect(!result.ok, "expected vendor B to be refused"); expect(/do not own/.test(result.message), `unexpected message: ${result.message}`);
  equal(business("node/verify-auto-a").description, before, "vendor A description after B edit attempt");
  return result.message;
});

await runCase(6, "an unapproved vendor gets an authz failure instead of the listing editor", async () => {
  const base = await startVite(39101);
  vendors.insertSession("verify-unapproved-session", unapproved.id, new Date(Date.now() + 3_600_000).toISOString());
  const response = await fetch(`${base}/vendor/listing`, { redirect: "manual", headers: { cookie: "smn_vendor_session=verify-unapproved-session" } });
  expect(response.status === 307 && response.headers.get("location") === "/vendor/claim", `expected the approved-listing authz redirect, got HTTP ${response.status} to ${response.headers.get("location")}`);
  const direct = await claims.updateOwnedListingForVendor(unapproved, { description: "Should not save" });
  expect(!direct.ok, "expected direct server call to refuse unapproved vendor");
  return `${direct.message} (route HTTP ${response.status} → /vendor/claim, no editor render)`;
});

await runCase(7, "approved owner changes persist and the public profile renders claimed values", async () => {
  const saved = await claims.updateOwnedListingForVendor(a, {
    businessId: business("node/verify-auto-a").id,
    openingHours: "Mon-Sat 8am-6pm", phone: "(352) 555-1212", website: "owner.example.com/new", description: "Business-supplied description for verified ownership.",
  });
  expect(saved.ok, saved.message);
  const row = business("node/verify-auto-a"); equal(row.opening_hours, "Mon-Sat 8am-6pm", "stored hours"); equal(row.phone, "(352) 555-1212", "stored phone"); equal(row.website, "https://owner.example.com/new", "stored website"); equal(row.description, "Business-supplied description for verified ownership.", "stored description");
  const base = await startVite(39102);
  const page = await fetch(`${base}/business/${row.slug}`); const html = await page.text();
  expect(page.status === 200, `expected profile HTTP 200, got ${page.status}`);
  for (const text of ["Mon-Sat 8am-6pm", "(352) 555-1212", "Business-supplied description for verified ownership.", "Claimed by the business"]) expect(html.includes(text), `public profile did not render ${JSON.stringify(text)}`);
  return saved.message;
});

await runCase(8, "admin claims are token-gated; wrong token fails and server review approves/rejects", async () => {
  const noTokenBase = await startVite(39103);
  const noToken = await fetch(`${noTokenBase}/admin/claims`, { redirect: "manual" });
  equal(noToken.status, 404, "admin route without ADMIN_CLAIM_TOKEN");
  const approveSubmit = await claims.submitListingClaimForVendor(approveVendor, { businessId: business("node/verify-admin-approve").id });
  const rejectSubmit = await claims.submitListingClaimForVendor(rejectVendor, { businessId: business("node/verify-admin-reject").id });
  expect(approveSubmit.ok && rejectSubmit.ok, `${approveSubmit.message} / ${rejectSubmit.message}`);
  process.env.ADMIN_CLAIM_TOKEN = "verify-admin-token";
  const wrong = await claims.adminClaimLoginForToken("wrong-token"); expect(!wrong.ok, "wrong admin token unexpectedly accepted");
  const right = await claims.adminClaimLoginForToken("verify-admin-token"); expect(right.ok, right.message);
  const unauthorized = await claims.decideListingClaimForAdmin(false, { claimId: claimFor(approveVendor.id, business("node/verify-admin-approve").id).id, decision: "approved" });
  expect(!unauthorized.ok && /Not authorized/.test(unauthorized.message), `unexpected unauthorized response: ${unauthorized.message}`);
  const approved = await claims.decideListingClaimForAdmin(true, { claimId: claimFor(approveVendor.id, business("node/verify-admin-approve").id).id, decision: "approved" });
  const rejected = await claims.decideListingClaimForAdmin(true, { claimId: claimFor(rejectVendor.id, business("node/verify-admin-reject").id).id, decision: "rejected" });
  expect(approved.ok, approved.message); expect(rejected.ok, rejected.message);
  equal(claimFor(approveVendor.id, business("node/verify-admin-approve").id).status, "approved", "approved claim state"); equal(claimFor(rejectVendor.id, business("node/verify-admin-reject").id).status, "rejected", "rejected claim state");
  const tokenBase = await startVite(39104, "verify-admin-token");
  const tokenPage = await fetch(`${tokenBase}/admin/claims`, { redirect: "manual" }); equal(tokenPage.status, 200, "admin route with token configured");
  return `${wrong.message}; ${approved.message}; ${rejected.message}`;
});

await runCase(9, "unclaimed public profile retains OSM data, attribution and claim CTA without an edit route", async () => {
  const row = business("node/verify-unclaimed"); equal(row.is_claimed, 0, "unclaimed state");
  const base = await startVite(39105);
  const response = await fetch(`${base}/business/${row.slug}`); const html = await response.text();
  equal(response.status, 200, "unclaimed profile HTTP status");
  for (const text of ["Unclaimed OSM Listing", "(352) 555-0199", "Original OSM description stays visible until claimed.", "OpenStreetMap contributors, ODbL", "Is this your business? Claim this free listing"]) expect(html.includes(text), `unclaimed public profile did not render ${JSON.stringify(text)}`);
  expect(!html.includes("/vendor/listing"), "unclaimed profile exposed the vendor listing edit route");
  return "OSM attribution and claim CTA rendered; no /vendor/listing link.";
});

await runCase(10, "re-ingesting current OSM data preserves all 318 live slugs and city slugs", async () => {
  expect(existsSync(LIVE_DB), `live database is missing at ${LIVE_DB}`);
  // SQLite VACUUM INTO is a consistent copy operation; the importer below only opens the copy.
  const live = new Database(LIVE_DB, { create: false });
  try { live.exec(`VACUUM INTO '${INGEST_COPY.replace(/'/g, "''")}'`); } finally { live.close(); }
  const copy = new Database(INGEST_COPY, { create: false });
  const before = copy.query<{ osm_id: string; city_slug: string; slug: string }, []>("SELECT osm_id, city_slug, slug FROM businesses ORDER BY osm_id").all();
  equal(before.length, 318, "live-copy business row count before ingest"); copy.close();
  const result = Bun.spawn(["bun", "run", "scripts/ingest-osm.ts"], { cwd: SITE_ROOT, env: { ...process.env, MARKETPLACE_DB_PATH: INGEST_COPY }, stdout: "pipe", stderr: "pipe" });
  const status = await result.exited; if (status !== 0) throw new Failed(`ingest exited ${status}: ${await new Response(result.stderr).text()}`);
  const afterDb = new Database(INGEST_COPY, { create: false });
  const after = afterDb.query<{ osm_id: string; city_slug: string; slug: string }, []>("SELECT osm_id, city_slug, slug FROM businesses ORDER BY osm_id").all(); afterDb.close();
  equal(after.length, 318, "live-copy business row count after ingest");
  for (let i = 0; i < before.length; i++) equal(JSON.stringify(after[i]), JSON.stringify(before[i]), `OSM row ${before[i].osm_id}`);
  return "318/318 city_slug and slug values unchanged.";
});

const failed = outcomes.filter((outcome) => !outcome.ok);
console.log(`\n${outcomes.length - failed.length}/${outcomes.length} cases passed${failed.length ? ` — FAILED: ${failed.map((item) => item.n).join(", ")}` : " — all green"}`);
console.log(`Database used: ${dbModule.DB_FILE}`);
vite?.kill();
for (const file of [VERIFY_DB, `${VERIFY_DB}-wal`, `${VERIFY_DB}-shm`, FIXTURE_JSON, INGEST_COPY, `${INGEST_COPY}-wal`, `${INGEST_COPY}-shm`]) rmSync(file, { force: true });
if (failed.length) process.exit(1);
