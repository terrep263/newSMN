// SERVER-ONLY. Google Places (New) importer for the business directory.
//
// What it does
//   * Searches "<term> in <city>, FL" for every Lake County community and every
//     directory category (Text Search, up to 3 pages of 20), and stores each place
//     keyed by its Google place_id.
//   * A place that is already in the directory (same place_id, or the same name
//     within 250 m of an OpenStreetMap row) is linked, never duplicated.
//   * Google data is cached for at most 30 days (Google Maps Platform terms, 5.4):
//     every search result refreshes the row, a refresh job re-fetches rows that were
//     not seen again, and anything that cannot be refreshed in time has its
//     coordinates cleared. Closed or vanished places are hidden (is_active = 0).
//   * Every finished (term, city) search is logged, so a restart resumes without
//     paying for the same search twice, and a request budget caps spend per process.
//
// Needs GOOGLE_PLACES_API_KEY. Without it nothing runs and nothing breaks.

import { CITIES, DIRECTORY_CATEGORIES } from "../lib/taxonomy";
import { CENTROIDS, MAX_CITY_DISTANCE_KM, haversineKm, nearestCityFor } from "../lib/city-centroids";
import { getDb } from "./db";

const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const DETAILS_URL = "https://places.googleapis.com/v1/places/";
const SEARCH_FIELDS = [
  "places.id", "places.displayName", "places.formattedAddress", "places.addressComponents",
  "places.location", "places.businessStatus", "places.nationalPhoneNumber", "places.websiteUri",
  "places.regularOpeningHours", "places.rating", "places.userRatingCount", "places.googleMapsUri",
  "nextPageToken",
].join(",");
const DETAILS_FIELDS = [
  "id", "displayName", "formattedAddress", "addressComponents", "location", "businessStatus",
  "nationalPhoneNumber", "websiteUri", "regularOpeningHours", "rating", "userRatingCount", "googleMapsUri",
].join(",");

const DAY_MS = 86_400_000;
/** A completed search is not repeated for this long. */
export const SEARCH_REPEAT_DAYS = 25;
/** Rows not seen again are re-fetched once they are this old. */
export const REFRESH_AFTER_DAYS = 20;
/** Google data must not be kept longer than this (coordinates are cleared past it). */
export const MAX_CACHE_DAYS = 29;
const MAX_PAGES = 3;
const NEAR_DUPLICATE_KM = 0.25;

/** Search terms per directory category slug. */
export const CATEGORY_TERMS: Record<string, string[]> = {
  "restaurants-cafes": ["restaurants", "cafes and coffee shops", "bakeries"],
  "bars-nightlife": ["bars", "breweries and pubs"],
  "health-medical-services": ["doctors and medical clinics", "dentists", "urgent care"],
  "home-repair-handyman-services": ["handyman services", "plumbers", "electricians", "HVAC contractors", "roofing contractors"],
  "hair-nails-barber-shops": ["hair salons", "nail salons", "barber shops"],
  "local-retail-boutiques": ["boutiques", "gift shops", "clothing stores"],
  "auto-repair-detailing": ["auto repair shops", "car detailing"],
  "professional-services": ["accountants", "lawyers", "real estate agencies", "insurance agencies"],
  "spas-massage-wellness": ["spas", "massage therapists"],
  "fitness-personal-training": ["gyms and fitness centers", "personal trainers", "yoga studios"],
  "grocery-markets": ["grocery stores", "farmers markets"],
  "lodging-vacation-rentals": ["hotels", "vacation rentals", "bed and breakfast"],
};

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: { longText?: string; shortText?: string; types?: string[] }[];
  location?: { latitude?: number; longitude?: number };
  businessStatus?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
};

export class PlacesError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type RunStats = { requests: number; inserted: number; linked: number; updated: number; rejected: number; searches: number; stoppedEarly: string | null };
const newStats = (): RunStats => ({ requests: 0, inserted: 0, linked: 0, updated: 0, rejected: 0, searches: 0, stoppedEarly: null });

const apiKey = () => (process.env.GOOGLE_PLACES_API_KEY ?? "").trim();
const budget = () => {
  const n = Number(process.env.PLACES_MAX_REQUESTS ?? "");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2500;
};

const clean = (v: unknown): string | null => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") || null : null);
const normName = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ")
    .replace(/\b(the|llc|inc|co|company|corp)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const cleanSlug = (v: string) =>
  v.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 110) || "business";

async function googleFetch(url: string, init: RequestInit & { fields: string }): Promise<any> {
  const res = await fetch(url, {
    method: init.method,
    body: init.body,
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": init.fields,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new PlacesError(res.status, `Places API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

/** Fields we store, parsed from a Google place. */
function parsePlace(p: GooglePlace) {
  const comps = p.addressComponents ?? [];
  const of = (type: string) => comps.find((c) => c.types?.includes(type))?.longText ?? null;
  const number = of("street_number");
  const route = of("route");
  const street = [number, route].filter(Boolean).join(" ") || clean(p.formattedAddress?.split(",")[0]);
  const hours = p.regularOpeningHours?.weekdayDescriptions?.map((d) => d.replace(/[  ]/g, " ")).join("\n") || null;
  return {
    placeId: p.id ?? "",
    name: clean(p.displayName?.text),
    street,
    postcode: of("postal_code"),
    lat: p.location?.latitude ?? null,
    lon: p.location?.longitude ?? null,
    phone: clean(p.nationalPhoneNumber),
    website: clean(p.websiteUri),
    hours,
    rating: typeof p.rating === "number" ? p.rating : null,
    ratingCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
    mapsUrl: clean(p.googleMapsUri),
    status: p.businessStatus ?? "OPERATIONAL",
  };
}

type Row = { id: number; name: string; lat: number | null; lon: number | null; google_place_id: string | null };

function slugFor(db: ReturnType<typeof getDb>, name: string, citySlug: string, placeId: string): string {
  const base = cleanSlug(`${name}-${citySlug}`);
  const taken = db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM businesses WHERE slug = ?");
  if (!taken.get(base)?.n) return base;
  for (let i = 2; i < 50; i++) if (!taken.get(`${base}-${i}`)?.n) return `${base}-${i}`;
  return `${base}-${cleanSlug(placeId).slice(-8)}`;
}

/** Stores one search result. Returns what happened. */
function storePlace(
  db: ReturnType<typeof getDb>,
  index: { byPlace: Map<string, Row>; rows: Row[] },
  categorySlug: string,
  raw: GooglePlace,
  nowIso: string,
): "inserted" | "linked" | "updated" | "rejected" {
  const p = parsePlace(raw);
  if (!p.placeId || !p.name || p.lat == null || p.lon == null) return "rejected";
  if (p.status === "CLOSED_PERMANENTLY") {
    const existing = index.byPlace.get(p.placeId);
    if (existing) db.query("UPDATE businesses SET is_active = 0, updated_at = ? WHERE id = ?").run(nowIso, existing.id);
    return "rejected";
  }
  const near = nearestCityFor(p.lat, p.lon);
  if (!near || near.distance > MAX_CITY_DISTANCE_KM) return "rejected";
  const city = CITIES.find((c) => c.slug === near.slug)!;

  // 1) Already stored under this place_id: refresh the Google-sourced fields.
  const existing = index.byPlace.get(p.placeId);
  if (existing) {
    applyGoogleFields(db, existing.id, p, nowIso);
    return "updated";
  }

  // 2) The same business already in the directory (e.g. from OpenStreetMap): link it.
  const wanted = normName(p.name);
  const match = index.rows.find(
    (r) => r.google_place_id == null && r.lat != null && r.lon != null && normName(r.name) === wanted &&
      haversineKm(p.lat!, p.lon!, r.lat, r.lon) <= NEAR_DUPLICATE_KM,
  );
  if (match) {
    // Link only. Fill blanks from Google and remember which columns came from Google so
    // the refresh job keeps them current; never overwrite a value that is already there.
    const cur = db.query<Record<string, any>, [number]>("SELECT street, postcode, phone, website, opening_hours FROM businesses WHERE id = ?").get(match.id)!;
    const filled: string[] = [];
    const sets: string[] = ["google_place_id = ?", "google_maps_url = ?", "rating = ?", "rating_count = ?", "google_fetched_at = ?", "updated_at = ?"];
    const vals: (string | number | null)[] = [p.placeId, p.mapsUrl, p.rating, p.ratingCount, nowIso, nowIso];
    for (const [col, val] of [["phone", p.phone], ["website", p.website], ["opening_hours", p.hours]] as const) {
      if (cur[col] == null && val != null) { sets.push(`${col} = ?`); vals.push(val); filled.push(col); }
    }
    sets.push("google_fields = ?"); vals.push(filled.join(","));
    db.query(`UPDATE businesses SET ${sets.join(", ")} WHERE id = ?`).run(...vals, match.id);
    match.google_place_id = p.placeId;
    index.byPlace.set(p.placeId, match);
    return "linked";
  }

  // 3) New business.
  const slug = slugFor(db, p.name, city.slug, p.placeId);
  const res = db.query(
    `INSERT INTO businesses (osm_id, slug, name, category_slug, city_slug, city_name, street, postcode, lat, lon,
        phone, website, opening_hours, osm_url, source, google_place_id, google_maps_url, google_fetched_at, google_fields,
        rating, rating_count, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'google', ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    `google:${p.placeId}`, slug, p.name, categorySlug, city.slug, city.name, p.street, p.postcode, p.lat, p.lon,
    p.phone, p.website, p.hours,
    p.mapsUrl ?? `https://www.google.com/maps/place/?q=place_id:${p.placeId}`,
    p.placeId, p.mapsUrl, nowIso, "name,street,postcode,lat,lon,phone,website,opening_hours",
    p.rating, p.ratingCount, nowIso, nowIso,
  );
  const row: Row = { id: Number(res.lastInsertRowid), name: p.name, lat: p.lat, lon: p.lon, google_place_id: p.placeId };
  index.rows.push(row);
  index.byPlace.set(p.placeId, row);
  return "inserted";
}

/** Updates the Google-sourced columns of a row we already hold. */
function applyGoogleFields(db: ReturnType<typeof getDb>, id: number, p: ReturnType<typeof parsePlace>, nowIso: string) {
  const row = db.query<{ google_fields: string | null }, [number]>("SELECT google_fields FROM businesses WHERE id = ?").get(id);
  const owned = new Set((row?.google_fields ?? "").split(",").filter(Boolean));
  const sets = ["rating = ?", "rating_count = ?", "google_maps_url = ?", "google_fetched_at = ?", "updated_at = ?", "is_active = 1"];
  const vals: (string | number | null)[] = [p.rating, p.ratingCount, p.mapsUrl, nowIso, nowIso];
  const map: Record<string, string | number | null> = {
    name: p.name, street: p.street, postcode: p.postcode, lat: p.lat, lon: p.lon,
    phone: p.phone, website: p.website, opening_hours: p.hours,
  };
  for (const [col, val] of Object.entries(map)) {
    if (owned.has(col) && val != null) { sets.push(`${col} = ?`); vals.push(val); }
  }
  db.query(`UPDATE businesses SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
}

function loadIndex(db: ReturnType<typeof getDb>) {
  const rows = db.query<Row, []>("SELECT id, name, lat, lon, google_place_id FROM businesses WHERE is_active = 1 OR google_place_id IS NOT NULL").all();
  const byPlace = new Map<string, Row>();
  for (const r of rows) if (r.google_place_id) byPlace.set(r.google_place_id, r);
  return { rows, byPlace };
}

/** Runs every search that has not been completed in the last SEARCH_REPEAT_DAYS days. */
export async function runPlacesImport(options: { now?: () => number; cities?: string[]; maxRequests?: number } = {}): Promise<RunStats> {
  const stats = newStats();
  if (!apiKey()) { stats.stoppedEarly = "GOOGLE_PLACES_API_KEY is not set"; return stats; }
  const now = options.now ?? Date.now;
  const db = getDb();
  const limit = options.maxRequests ?? budget();
  const runId = Number(db.query("INSERT INTO import_runs (kind, started_at) VALUES ('import', ?)").run(new Date(now()).toISOString()).lastInsertRowid);
  const index = loadIndex(db);
  const done = db.query<{ n: number }, [string, string, string]>("SELECT COUNT(*) AS n FROM places_query_log WHERE term = ? AND city_slug = ? AND completed_at > ?");
  const log = db.query("INSERT INTO places_query_log (term, city_slug, completed_at, results) VALUES (?, ?, ?, ?) ON CONFLICT(term, city_slug) DO UPDATE SET completed_at = excluded.completed_at, results = excluded.results");

  outer: for (const city of CITIES) {
    if (options.cities && !options.cities.includes(city.slug)) continue;
    const [lat, lon] = CENTROIDS[city.slug];
    for (const category of DIRECTORY_CATEGORIES) {
      for (const term of CATEGORY_TERMS[category.slug] ?? []) {
        const since = new Date(now() - SEARCH_REPEAT_DAYS * DAY_MS).toISOString();
        if (done.get(term, city.slug, since)?.n) continue;

        let pageToken: string | undefined;
        let results = 0;
        try {
          for (let page = 0; page < MAX_PAGES; page++) {
            if (stats.requests >= limit) { stats.stoppedEarly = `request budget of ${limit} reached`; break outer; }
            stats.requests++;
            const body: Record<string, unknown> = {
              textQuery: `${term} in ${city.name}, FL`,
              pageSize: 20,
              regionCode: "US",
              locationBias: { circle: { center: { latitude: lat, longitude: lon }, radius: MAX_CITY_DISTANCE_KM * 1000 } },
            };
            if (pageToken) body.pageToken = pageToken;
            const data = await googleFetch(SEARCH_URL, { method: "POST", body: JSON.stringify(body), fields: SEARCH_FIELDS });
            const places: GooglePlace[] = Array.isArray(data.places) ? data.places : [];
            const nowIso = new Date(now()).toISOString();
            db.transaction(() => {
              for (const place of places) {
                const outcome = storePlace(db, index, category.slug, place, nowIso);
                stats[outcome]++;
              }
            })();
            results += places.length;
            pageToken = typeof data.nextPageToken === "string" && data.nextPageToken ? data.nextPageToken : undefined;
            if (!pageToken) break;
          }
        } catch (error) {
          if (error instanceof PlacesError && (error.status === 401 || error.status === 403 || error.status === 429)) {
            stats.stoppedEarly = error.message;
            break outer;
          }
          console.error(`[places] search "${term}" in ${city.name} failed:`, (error as Error).message);
          continue; // not logged as done, so it is retried next cycle
        }
        log.run(term, city.slug, new Date(now()).toISOString(), results);
        stats.searches++;
      }
    }
  }
  db.query("UPDATE import_runs SET finished_at = ?, requests = ?, inserted = ?, linked = ?, updated = ?, rejected = ?, note = ? WHERE id = ?")
    .run(new Date(now()).toISOString(), stats.requests, stats.inserted, stats.linked, stats.updated, stats.rejected, stats.stoppedEarly, runId);
  console.log(`[places] import: ${JSON.stringify(stats)}`);
  return stats;
}

/** Re-fetches Google rows that were not seen again, hides closed ones, and clears
 *  coordinates that are older than the 30-day cache limit. */
export async function runPlacesRefresh(options: { now?: () => number; maxRequests?: number } = {}): Promise<RunStats> {
  const stats = newStats();
  const now = options.now ?? Date.now;
  const db = getDb();
  const nowIso = new Date(now()).toISOString();
  const limit = options.maxRequests ?? budget();

  if (apiKey()) {
    const staleBefore = new Date(now() - REFRESH_AFTER_DAYS * DAY_MS).toISOString();
    const stale = db.query<{ id: number; google_place_id: string }, [string]>(
      "SELECT id, google_place_id FROM businesses WHERE google_place_id IS NOT NULL AND is_active = 1 AND google_fetched_at < ? ORDER BY google_fetched_at LIMIT 500",
    ).all(staleBefore);
    for (const row of stale) {
      if (stats.requests >= limit) { stats.stoppedEarly = `request budget of ${limit} reached`; break; }
      stats.requests++;
      try {
        const raw: GooglePlace = await googleFetch(`${DETAILS_URL}${encodeURIComponent(row.google_place_id)}`, { method: "GET", fields: DETAILS_FIELDS });
        const p = parsePlace(raw);
        if (p.status === "CLOSED_PERMANENTLY") {
          db.query("UPDATE businesses SET is_active = 0, updated_at = ? WHERE id = ?").run(nowIso, row.id);
          stats.rejected++;
        } else {
          applyGoogleFields(db, row.id, p, nowIso);
          stats.updated++;
        }
      } catch (error) {
        if (error instanceof PlacesError && error.status === 404) {
          db.query("UPDATE businesses SET is_active = 0, updated_at = ? WHERE id = ?").run(nowIso, row.id);
          stats.rejected++;
        } else if (error instanceof PlacesError && (error.status === 401 || error.status === 403 || error.status === 429)) {
          stats.stoppedEarly = error.message;
          break;
        } else {
          console.error("[places] refresh failed:", (error as Error).message);
        }
      }
    }
  }

  // Compliance sweep: Google coordinates are never kept past the cache limit.
  const tooOld = new Date(now() - MAX_CACHE_DAYS * DAY_MS).toISOString();
  const expired = db.query<{ id: number; google_fields: string | null }, [string]>(
    "SELECT id, google_fields FROM businesses WHERE google_place_id IS NOT NULL AND google_fetched_at < ?",
  ).all(tooOld);
  for (const row of expired) {
    if ((row.google_fields ?? "").split(",").includes("lat")) {
      db.query("UPDATE businesses SET lat = NULL, lon = NULL WHERE id = ?").run(row.id);
    }
  }
  console.log(`[places] refresh: ${JSON.stringify(stats)}`);
  return stats;
}

let running = false;
/** One import + refresh pass; never overlaps itself and never throws. */
export async function runPlacesCycle(): Promise<void> {
  if (running) return;
  running = true;
  try {
    if (!apiKey()) { console.log("[places] GOOGLE_PLACES_API_KEY is not set; Google import is idle."); return; }
    await runPlacesImport();
    await runPlacesRefresh();
  } catch (error) {
    console.error("[places] cycle failed:", (error as Error).message);
  } finally {
    running = false;
  }
}

/** Starts the importer in the background: 30 s after boot, then every 6 hours. */
export function startPlacesScheduler(): void {
  setTimeout(() => { void runPlacesCycle(); }, 30_000);
  setInterval(() => { void runPlacesCycle(); }, 6 * 3_600_000);
}
