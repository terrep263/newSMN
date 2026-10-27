/**
 * Verifies vendor photo upload against an isolated database copy:
 * ownership, validation, replace/remove cleanup, serving, and that the photo
 * shows on the deal page and business page. Run: bun run verify:photos
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SITE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const VERIFY_DB = resolve(SITE_ROOT, ".data", "verify-photos.db");
const FIXTURE = resolve(SITE_ROOT, ".data", "verify-photos-osm.json");
if (VERIFY_DB === resolve(SITE_ROOT, ".data", "marketplace.db")) throw new Error("refusing to touch the live database");
process.env.MARKETPLACE_DB_PATH = VERIFY_DB;
mkdirSync(dirname(VERIFY_DB), { recursive: true });
for (const f of [VERIFY_DB, `${VERIFY_DB}-wal`, `${VERIFY_DB}-shm`, FIXTURE]) rmSync(f, { force: true });

const dbModule = await import("../src/server/db");
const vendors = await import("../src/server/vendors");
const claims = await import("../src/server/listing-claims");
const photos = await import("../src/server/photos");
const db = dbModule.getDb();

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const mk = (name: string, email: string) => vendors.insertVendor({ businessName: name, citySlug: "mount-dora", categorySlug: "local-retail-boutiques", email, phone: null, tier: "free", passwordHash: "verification-only-not-a-password" });

writeFileSync(FIXTURE, JSON.stringify([{ osm: "node/photo-a", osm_url: "https://www.openstreetmap.org/node/photo-a", name: "Photo Listing A", category_slug: "local-retail-boutiques", street: "1 Test St", postcode: "32757", lat: 28.8, lon: -81.64, phone: "(352) 555-0100", website: "https://photoowner.example.com", opening_hours: null, description: "x" }]));
const ing = Bun.spawn(["bun", "run", "scripts/ingest-osm.ts", FIXTURE], { cwd: SITE_ROOT, env: { ...process.env, MARKETPLACE_DB_PATH: VERIFY_DB }, stdout: "pipe", stderr: "pipe" });
if ((await ing.exited) !== 0) throw new Error(await new Response(ing.stderr).text());

const owner = mk("Photo Owner", "o@photoowner.example.com");
const other = mk("Other Vendor", "x@other.example.com");
const deal = db.query<{ id: number; slug: string }, []>("SELECT id, slug FROM deals ORDER BY id LIMIT 1").get()!;
db.query("UPDATE deals SET vendor_id = ?, is_sample = 0, status = 'published' WHERE id = ?").run(owner.id, deal.id);
const biz = db.query<{ id: number; slug: string }, []>("SELECT id, slug FROM businesses WHERE osm_id = 'node/photo-a'").get()!;
const claim = await claims.submitListingClaimForVendor(owner, { businessId: biz.id, proofNote: "Owner" });

let failed = 0;
function check(name: string, ok: boolean, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); if (!ok) failed++; }
const dealPhoto = () => db.query<{ photo_id: number | null }, [number]>("SELECT photo_id FROM deals WHERE id = ?").get(deal.id)!.photo_id;
const bizPhoto = () => db.query<{ photo_id: number | null }, [number]>("SELECT photo_id FROM businesses WHERE id = ?").get(biz.id)!.photo_id;
const rows = () => db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM photos").get()!.n;

check("listing claim auto-approved (setup)", claim.ok && claim.status === "approved");
const up = photos.setDealPhoto(owner.id, deal.id, PNG);
check("owner uploads a deal photo", up.ok && dealPhoto() === (up as { photoId: number }).photoId && rows() === 1);
check("other vendor cannot set a deal photo", !photos.setDealPhoto(other.id, deal.id, PNG).ok && rows() === 1);
check("other vendor cannot remove a deal photo", !photos.setDealPhoto(other.id, deal.id, null).ok && dealPhoto() !== null);
check("non-image bytes rejected", !photos.setDealPhoto(owner.id, deal.id, "data:image/png;base64," + Buffer.from("hello world, not an image").toString("base64")).ok);
check("oversize rejected", !photos.setDealPhoto(owner.id, deal.id, "data:image/png;base64," + Buffer.concat([Buffer.from(PNG.split(",")[1], "base64"), Buffer.alloc(photos.MAX_PHOTO_BYTES)]).toString("base64")).ok);
check("malformed data URL rejected", !photos.setDealPhoto(owner.id, deal.id, "javascript:alert(1)").ok);
const oldId = dealPhoto()!;
const re = photos.setDealPhoto(owner.id, deal.id, PNG);
check("replace swaps the photo and deletes the old row", re.ok && dealPhoto() !== oldId && photos.getPhoto(oldId) === null && rows() === 1);
const lp = photos.setListingPhoto(owner.id, PNG);
check("approved owner sets listing photo", lp.ok && bizPhoto() !== null);
check("vendor without approved claim cannot set listing photo", !photos.setListingPhoto(other.id, PNG).ok);

// Re-running the OSM import must not drop the photo.
const before = bizPhoto();
const re2 = Bun.spawn(["bun", "run", "scripts/ingest-osm.ts", FIXTURE], { cwd: SITE_ROOT, env: { ...process.env, MARKETPLACE_DB_PATH: VERIFY_DB }, stdout: "pipe", stderr: "pipe" });
await re2.exited;
check("re-import keeps the listing photo", bizPhoto() === before);

// HTTP: serving and rendering.
const port = 3217;
const vite = Bun.spawn(["bun", "--bun", "vite", "dev", "--host", "127.0.0.1", "--port", String(port)], { cwd: SITE_ROOT, env: { ...process.env, MARKETPLACE_DB_PATH: VERIFY_DB }, stdout: "pipe", stderr: "pipe" });
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 60; i++) { try { await fetch(`${base}/`); break; } catch { await Bun.sleep(200); } }
try {
  const img = await fetch(`${base}/api/photos/${dealPhoto()}`);
  const bytes = new Uint8Array(await img.arrayBuffer());
  check("photo route serves the image", img.status === 200 && img.headers.get("content-type") === "image/png" && bytes.length === Buffer.from(PNG.split(",")[1], "base64").length);
  check("missing photo is 404", (await fetch(`${base}/api/photos/999999`)).status === 404 && (await fetch(`${base}/api/photos/abc`)).status === 404);
  const dealHtml = await (await fetch(`${base}/deals/${deal.slug}`)).text();
  check("deal page shows the photo", dealHtml.includes(`/api/photos/${dealPhoto()}`));
  const bizHtml = await (await fetch(`${base}/business/${biz.slug}`)).text();
  check("business page shows the photo", bizHtml.includes(`/api/photos/${bizPhoto()}`));
  check("business JSON-LD carries the image", /"image":"[^"]*\/api\/photos\/\d+"/.test(bizHtml));
  const listHtml = await (await fetch(`${base}/businesses`)).text();
  check("directory card shows the photo", listHtml.includes(`/api/photos/${bizPhoto()}`));
} finally { vite.kill(); }

const rm = photos.setDealPhoto(owner.id, deal.id, null);
check("remove clears the deal photo and deletes the row", rm.ok && dealPhoto() === null && rows() === 1);
photos.setListingPhoto(owner.id, null);
check("remove clears the listing photo", bizPhoto() === null && rows() === 0);

for (const f of [VERIFY_DB, `${VERIFY_DB}-wal`, `${VERIFY_DB}-shm`, FIXTURE]) rmSync(f, { force: true });
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll photo checks passed");
process.exit(failed ? 1 : 0);
