/**
 * Verifies the Google Places importer against a throwaway database and a fake
 * Places API: inserts, paging, de-duplication, OSM linking, city assignment,
 * rejects, resume (no repeat searches), request budget, refresh, closed places,
 * the 30-day coordinate sweep, and that hidden rows stay out of the directory.
 * Run: bun run verify:places
 */
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DB = resolve(ROOT, ".data", "verify-places.db");
process.env.MARKETPLACE_DB_PATH = DB;
process.env.GOOGLE_PLACES_API_KEY = "test-key";
mkdirSync(dirname(DB), { recursive: true });
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) rmSync(f, { force: true });

type Call = { url: string; body: any; key: string | null; mask: string | null };
const calls: Call[] = [];
let handler: (call: Call) => { status?: number; json: any } = () => ({ json: {} });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input);
  if (!url.startsWith("https://places.googleapis.com/")) return realFetch(input, init);
  const call: Call = { url, body: init?.body ? JSON.parse(init.body) : null, key: init.headers["X-Goog-Api-Key"], mask: init.headers["X-Goog-FieldMask"] };
  calls.push(call);
  const out = handler(call);
  return new Response(JSON.stringify(out.json), { status: out.status ?? 200 });
}) as typeof fetch;

const { getDb } = await import("../src/server/db");
const places = await import("../src/server/places-import");
const dir = await import("../src/server/directory");
const db = getDb();

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); if (!ok) failed++; };

const place = (id: string, name: string, lat: number, lon: number, extra: Record<string, unknown> = {}) => ({
  id, displayName: { text: name }, formattedAddress: `1 Main St, Somewhere, FL 32757, USA`,
  addressComponents: [{ longText: "1", types: ["street_number"] }, { longText: "Main St", types: ["route"] }, { longText: "32757", types: ["postal_code"] }],
  location: { latitude: lat, longitude: lon }, businessStatus: "OPERATIONAL", nationalPhoneNumber: "(352) 555-0100",
  websiteUri: "https://example.com", regularOpeningHours: { weekdayDescriptions: ["Monday: 9:00 AM – 5:00 PM", "Tuesday: Closed"] },
  rating: 4.5, userRatingCount: 12, googleMapsUri: `https://maps.google.com/?cid=${id}`, ...extra,
});
const MOUNT_DORA: [number, number] = [28.8025, -81.6445];

// An existing OpenStreetMap row that Google should link to, not duplicate.
const ts = new Date().toISOString();
db.query(`INSERT INTO businesses (osm_id, slug, name, category_slug, city_slug, city_name, street, lat, lon, phone, osm_url, created_at, updated_at)
  VALUES ('node/1','osm-cafe-mount-dora','Osm Cafe',?,'mount-dora','Mount Dora','2 Elm St',28.8026,-81.6446,'(352) 000-0000','https://www.openstreetmap.org/node/1',?,?)`).run("restaurants-cafes", ts, ts);

// ---- run 1: only Mount Dora, a "restaurants" search with 2 pages
const pageOne = [
  place("P-NEW", "Fresh Bakery", ...MOUNT_DORA),
  place("P-OSM", "Osm Cafe", 28.8027, -81.6447, { nationalPhoneNumber: "(352) 999-9999", websiteUri: "https://osmcafe.example.com" }),
  place("P-FAR", "Orlando Diner", 28.5383, -81.3792),            // outside Lake County
  place("P-CLOSED", "Gone Grill", ...MOUNT_DORA, { businessStatus: "CLOSED_PERMANENTLY" }),
];
handler = (call) => {
  if (call.body.textQuery === "restaurants in Mount Dora, FL") {
    return call.body.pageToken
      ? { json: { places: [place("P-PAGE2", "Second Page Tacos", 28.803, -81.645), place("P-NEW", "Fresh Bakery", ...MOUNT_DORA)] } }
      : { json: { places: pageOne, nextPageToken: "tok2" } };
  }
  return { json: {} };
};
let stats = await places.runPlacesImport({ cities: ["mount-dora"] });
const row = (placeId: string) => db.query<any, [string]>("SELECT * FROM businesses WHERE google_place_id = ?").get(placeId);

check("search sends key, field mask, region and city bias", calls[0].key === "test-key" && /places\.id/.test(calls[0].mask ?? "") && /nextPageToken/.test(calls[0].mask ?? "") && calls[0].body.regionCode === "US" && !!calls[0].body.locationBias?.circle);
check("page 2 uses nextPageToken and the same query", calls.some((c) => c.body.pageToken === "tok2" && c.body.textQuery === "restaurants in Mount Dora, FL"));
check("new place inserted with category, city, address, phone, hours", (() => { const r = row("P-NEW"); return r && r.category_slug === "restaurants-cafes" && r.city_slug === "mount-dora" && r.street === "1 Main St" && r.postcode === "32757" && r.phone === "(352) 555-0100" && /Monday/.test(r.opening_hours) && r.source === "google" && r.rating === 4.5 && r.rating_count === 12 && r.is_active === 1; })());
check("same place on page 2 is not duplicated", db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM businesses WHERE google_place_id = 'P-NEW'").get()!.n === 1 && !!row("P-PAGE2"));
check("OSM row is linked, not duplicated", db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM businesses WHERE name = 'Osm Cafe'").get()!.n === 1 && row("P-OSM")?.osm_id === "node/1" && row("P-OSM")?.source === "osm");
check("linking keeps OSM values and never overwrites them", row("P-OSM")?.phone === "(352) 000-0000");
check("linking fills blanks from Google and tracks them", row("P-OSM")?.website === "https://osmcafe.example.com" && /website/.test(row("P-OSM")?.google_fields ?? "") && !/phone/.test(row("P-OSM")?.google_fields ?? ""));
check("place outside Lake County rejected", !row("P-FAR"));
check("closed place not stored", !row("P-CLOSED"));
check("slug is unique and readable", row("P-NEW")?.slug === "fresh-bakery-mount-dora");
check("stats counted", stats.inserted === 2 && stats.linked === 1 && stats.rejected >= 2 && stats.requests >= 2);

// ---- resume: same run again makes no calls for finished searches
const before = calls.length;
stats = await places.runPlacesImport({ cities: ["mount-dora"] });
check("finished searches are not repeated", calls.length === before && stats.searches === 0);

// ---- budget guard
db.query("DELETE FROM places_query_log").run();
const b2 = calls.length;
stats = await places.runPlacesImport({ cities: ["mount-dora"], maxRequests: 3 });
check("request budget stops the run", calls.length - b2 === 3 && /budget/.test(stats.stoppedEarly ?? ""));

// ---- auth failure stops the run instead of burning requests
db.query("DELETE FROM places_query_log").run();
handler = () => ({ status: 403, json: { error: "denied" } });
const b3 = calls.length;
stats = await places.runPlacesImport({ cities: ["mount-dora"] });
check("403 stops immediately", calls.length - b3 === 1 && /403/.test(stats.stoppedEarly ?? ""));

// ---- refresh: closed place is hidden, healthy place updated, old coordinates cleared
const day = 86_400_000;
db.query("UPDATE businesses SET google_fetched_at = ? WHERE google_place_id IN ('P-NEW','P-PAGE2')").run(new Date(Date.now() - 21 * day).toISOString());
handler = (call) => call.url.endsWith("/P-NEW")
  ? { json: place("P-NEW", "Fresh Bakery", ...MOUNT_DORA, { rating: 3.9, businessStatus: "CLOSED_PERMANENTLY" }) }
  : { json: place("P-PAGE2", "Second Page Tacos", 28.803, -81.645, { rating: 4.8 }) };
await places.runPlacesRefresh();
check("refresh hides a permanently closed place", row("P-NEW")?.is_active === 0);
check("refresh updates a healthy place", row("P-PAGE2")?.rating === 4.8 && row("P-PAGE2")?.is_active === 1);
const hidden = dir.listBusinesses({ city: "mount-dora" });
check("hidden business is out of the directory", !hidden.businesses.some((b) => b.google_place_id === "P-NEW") && hidden.businesses.some((b) => b.google_place_id === "P-PAGE2"));
check("hidden business has no page", dir.businessBySlug("fresh-bakery-mount-dora") === null);

handler = () => ({ status: 500, json: {} });
db.query("UPDATE businesses SET google_fetched_at = ? WHERE google_place_id = 'P-PAGE2'").run(new Date(Date.now() - 31 * day).toISOString());
await places.runPlacesRefresh();
check("coordinates older than the cache limit are cleared", row("P-PAGE2")?.lat === null && row("P-PAGE2")?.lon === null);
check("OSM-owned coordinates are kept", db.query<any, []>("SELECT lat FROM businesses WHERE osm_id = 'node/1'").get()!.lat === 28.8026);

// ---- no key: idle and harmless
delete process.env.GOOGLE_PLACES_API_KEY;
const b4 = calls.length;
stats = await places.runPlacesImport();
check("without a key nothing is called", calls.length === b4 && /not set/.test(stats.stoppedEarly ?? ""));

for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) rmSync(f, { force: true });
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll Google Places checks passed");
process.exit(failed ? 1 : 0);
