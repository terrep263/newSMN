// SERVER-ONLY. SQLite storage for the marketplace (bun:sqlite).
//
// The data layer in ./repository.ts is the only thing that touches this file, so
// swapping SQLite for hosted Postgres later means rewriting the query functions
// in repository.ts (same shapes) and nothing in the routes.
//
// The database file lives outside the build output, at <site>/.data/marketplace.db
// (gitignored). Tables are created on first use and the demo deals are seeded when
// the deals table is empty.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { SEED_DEALS } from "./seed-data";

const DB_PATH = process.env.MARKETPLACE_DB_PATH
  ? resolve(process.env.MARKETPLACE_DB_PATH)
  : resolve(process.cwd(), ".data", "marketplace.db");

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;

  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS deals (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      slug          TEXT NOT NULL UNIQUE,
      title         TEXT NOT NULL,
      vendor_name   TEXT NOT NULL,
      vendor_city   TEXT NOT NULL,
      category_slug TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      highlights    TEXT NOT NULL DEFAULT '[]',
      fine_print    TEXT NOT NULL DEFAULT '',
      price_cents   INTEGER NOT NULL,
      value_cents   INTEGER NOT NULL,
      voucher_limit INTEGER NOT NULL,
      vouchers_sold INTEGER NOT NULL DEFAULT 0,
      image_hint    TEXT NOT NULL DEFAULT 'default',
      is_sample     INTEGER NOT NULL DEFAULT 0,
      starts_at     TEXT NOT NULL,
      ends_at       TEXT
    );

    CREATE TABLE IF NOT EXISTS vouchers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      code         TEXT NOT NULL,
      deal_id      INTEGER NOT NULL REFERENCES deals(id),
      buyer_name   TEXT NOT NULL,
      buyer_email  TEXT NOT NULL,
      quantity     INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending_payment'
                   CHECK (status IN ('pending_payment', 'issued', 'redeemed', 'refunded', 'expired')),
      created_at   TEXT NOT NULL,
      redeemed_at  TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS vouchers_code_key ON vouchers(code);
    CREATE INDEX IF NOT EXISTS vouchers_deal_id_idx ON vouchers(deal_id);
    CREATE INDEX IF NOT EXISTS deals_city_idx ON deals(vendor_city);
    CREATE INDEX IF NOT EXISTS deals_category_idx ON deals(category_slug);
  `);

  migrateVendorSide(db);
  migrateVoucherFlow(db);
  migrateDirectory(db);
  migrateListingClaims(db);
  migratePhotos(db);
  migrateFreeTrials(db);

  _db = db;
  seedIfEmpty(db);
  migrateCategorySlugs(db); // after seeding, so seeded sample deals move to the merged slugs too
  return db;
}

/** Deals and vendors used a second category list; move them to the directory slugs
 *  (idempotent: once moved, nothing matches). */
function migrateCategorySlugs(db: Database) {
  const legacy: [string, string][] = [
    ["health-medical", "health-medical-services"],
    ["home-repair-handyman", "home-repair-handyman-services"],
    ["hair-nails-barbers", "hair-nails-barber-shops"],
  ];
  for (const table of ["deals", "vendors", "businesses"]) {
    for (const [from, to] of legacy) db.query(`UPDATE ${table} SET category_slug = ? WHERE category_slug = ?`).run(to, from);
  }
}

/** Adds a column only when it is missing, so this file is safe to run against a
 *  database that already holds deals and vouchers. Never drops or rewrites tables. */
function addColumn(db: Database, table: string, column: string, definition: string) {
  const cols = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/**
 * Vendor side migration (idempotent):
 *   vendors          — real businesses that signed up, with a hashed password
 *   sessions         — server-side login sessions (token in an httpOnly cookie)
 *   login_attempts   — per-email failure counter used to slow repeated logins
 *   deals.vendor_id  — NULL keeps a deal as a seeded sample deal
 *   deals.status     — 'published' | 'paused'
 *   vouchers.redeemed_by_vendor_id — which business redeemed the code
 */
function migrateVendorSide(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vendors (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      business_name       TEXT NOT NULL,
      city_slug           TEXT NOT NULL,
      category_slug       TEXT NOT NULL,
      email               TEXT NOT NULL UNIQUE,
      password_hash       TEXT NOT NULL,
      phone               TEXT,
      website             TEXT,
      tier                TEXT NOT NULL DEFAULT 'free'
                          CHECK (tier IN ('free', 'starter', 'pro', 'enterprise')),
      tier_selected_at    TEXT,
      subscription_status TEXT NOT NULL DEFAULT 'unbilled',
      is_active           INTEGER NOT NULL DEFAULT 1,
      created_at          TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      vendor_id  INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      email         TEXT PRIMARY KEY,
      fail_count    INTEGER NOT NULL DEFAULT 0,
      window_start  TEXT NOT NULL,
      last_attempt  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sessions_vendor_idx ON sessions(vendor_id);
    CREATE INDEX IF NOT EXISTS vendors_email_idx ON vendors(email);
  `);

  // Stripe subscription fields. Kept as columns on the vendor so the dashboard
  // can show plan state without a round-trip to Stripe on every page load; the
  // webhook and the "Refresh from Stripe" button are what keep them true.
  addColumn(db, "vendors", "stripe_customer_id", "TEXT");
  addColumn(db, "vendors", "stripe_subscription_id", "TEXT");
  addColumn(db, "vendors", "current_period_end", "TEXT");
  addColumn(db, "vendors", "subscription_updated_at", "TEXT");
  addColumn(db, "deals", "vendor_id", "INTEGER REFERENCES vendors(id)");
  addColumn(db, "deals", "status", "TEXT NOT NULL DEFAULT 'published'");
  addColumn(db, "vouchers", "redeemed_by_vendor_id", "INTEGER REFERENCES vendors(id)");

  db.exec(`
    CREATE INDEX IF NOT EXISTS deals_vendor_id_idx ON deals(vendor_id);
    CREATE INDEX IF NOT EXISTS deals_status_idx ON deals(status);
    CREATE INDEX IF NOT EXISTS vouchers_redeemed_by_idx ON vouchers(redeemed_by_vendor_id);
  `);
}

/**
 * Voucher-flow migration (idempotent).
 *
 * The old vouchers table had CHECK (status IN ('issued','redeemed')) baked into
 * its CREATE TABLE, and SQLite cannot alter a CHECK. The table is therefore
 * rebuilt once — copying every existing row — the first time this runs against a
 * database that predates the pending-payment states. After that the CHECK already
 * allows the new states and the rebuild is skipped.
 *
 * New columns on deals hold the vendor's own payment link, the webhook endpoint
 * and signing secret, and the rules that make a voucher sellable (minimum
 * discount, purchase limit, redemption window, valid weekdays, blackouts, terms).
 * voucher_events is the audit trail: one row per state change.
 */
function migrateVoucherFlow(db: Database) {
  const table = db
    .query<{ sql: string | null }, []>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'vouchers'",
    )
    .get();

  if (table?.sql && !table.sql.includes("pending_payment")) {
    db.exec(`
      DROP INDEX IF EXISTS vouchers_code_key;
      DROP INDEX IF EXISTS vouchers_deal_id_idx;
      DROP INDEX IF EXISTS vouchers_redeemed_by_idx;
      ALTER TABLE vouchers RENAME TO vouchers_legacy;
      CREATE TABLE vouchers (
        id                     INTEGER PRIMARY KEY AUTOINCREMENT,
        code                   TEXT NOT NULL,
        deal_id                INTEGER NOT NULL REFERENCES deals(id),
        buyer_name             TEXT NOT NULL,
        buyer_email            TEXT NOT NULL,
        quantity               INTEGER NOT NULL,
        amount_cents           INTEGER NOT NULL,
        status                 TEXT NOT NULL DEFAULT 'pending_payment'
                               CHECK (status IN ('pending_payment', 'issued', 'redeemed', 'refunded', 'expired')),
        created_at             TEXT NOT NULL,
        redeemed_at            TEXT,
        redeemed_by_vendor_id  INTEGER REFERENCES vendors(id)
      );
      INSERT INTO vouchers (id, code, deal_id, buyer_name, buyer_email, quantity, amount_cents,
                            status, created_at, redeemed_at, redeemed_by_vendor_id)
        SELECT id, code, deal_id, buyer_name, buyer_email, quantity, amount_cents,
               status, created_at, redeemed_at, redeemed_by_vendor_id
          FROM vouchers_legacy;
      DROP TABLE vouchers_legacy;
      CREATE UNIQUE INDEX IF NOT EXISTS vouchers_code_key ON vouchers(code);
      CREATE INDEX IF NOT EXISTS vouchers_deal_id_idx ON vouchers(deal_id);
      CREATE INDEX IF NOT EXISTS vouchers_redeemed_by_idx ON vouchers(redeemed_by_vendor_id);
    `);
  }

  // Deal rules + the vendor's own payment/webhook plumbing.
  addColumn(db, "deals", "payment_link_url", "TEXT");
  addColumn(db, "deals", "webhook_url", "TEXT");
  addColumn(db, "deals", "webhook_secret", "TEXT");
  addColumn(db, "deals", "min_discount_pct", "INTEGER NOT NULL DEFAULT 20");
  addColumn(db, "deals", "per_customer_limit", "INTEGER NOT NULL DEFAULT 1");
  addColumn(db, "deals", "redemption_start", "TEXT");
  addColumn(db, "deals", "redemption_end", "TEXT");
  addColumn(db, "deals", "valid_days", "TEXT NOT NULL DEFAULT '[]'");
  addColumn(db, "deals", "blackout_dates", "TEXT NOT NULL DEFAULT '[]'");
  addColumn(db, "deals", "terms_accepted_at", "TEXT");
  addColumn(db, "deals", "redemption_instructions", "TEXT");

  // Voucher lifecycle bookkeeping.
  addColumn(db, "vouchers", "order_ref", "TEXT");
  addColumn(db, "vouchers", "confirmed_at", "TEXT");
  addColumn(db, "vouchers", "confirmed_via", "TEXT");
  addColumn(db, "vouchers", "confirmed_by_vendor_id", "INTEGER REFERENCES vendors(id)");
  addColumn(db, "vouchers", "refunded_at", "TEXT");
  addColumn(db, "vouchers", "refunded_by_vendor_id", "INTEGER REFERENCES vendors(id)");
  addColumn(db, "vouchers", "paid_value_only", "INTEGER NOT NULL DEFAULT 0");

  db.exec(`
    CREATE TABLE IF NOT EXISTS voucher_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_id INTEGER NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
      event      TEXT NOT NULL,
      actor      TEXT NOT NULL CHECK (actor IN ('buyer', 'vendor', 'system')),
      vendor_id  INTEGER REFERENCES vendors(id),
      note       TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS voucher_events_voucher_idx ON voucher_events(voucher_id);
    CREATE INDEX IF NOT EXISTS vouchers_status_idx ON vouchers(status);
    CREATE INDEX IF NOT EXISTS vouchers_buyer_email_idx ON vouchers(buyer_email);
    CREATE UNIQUE INDEX IF NOT EXISTS vouchers_order_ref_key ON vouchers(order_ref);
  `);
}

/** Free OpenStreetMap business directory. Kept separate from vendors/deals so
 * imported listings never become vendor accounts or sample marketplace deals. */
function migrateDirectory(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS businesses (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      osm_id               TEXT NOT NULL UNIQUE,
      slug                 TEXT NOT NULL UNIQUE,
      name                 TEXT NOT NULL,
      category_slug        TEXT NOT NULL,
      city_slug            TEXT NOT NULL,
      city_name            TEXT NOT NULL,
      street               TEXT,
      postcode             TEXT,
      lat                  REAL,
      lon                  REAL,
      phone                TEXT,
      email                TEXT,
      website              TEXT,
      opening_hours        TEXT,
      description          TEXT,
      osm_url              TEXT NOT NULL,
      is_claimed           INTEGER NOT NULL DEFAULT 0,
      claimed_by_vendor_id INTEGER REFERENCES vendors(id),
      created_at           TEXT NOT NULL,
      updated_at           TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS businesses_category_idx ON businesses(category_slug);
    CREATE INDEX IF NOT EXISTS businesses_city_idx ON businesses(city_slug);
    CREATE INDEX IF NOT EXISTS businesses_name_idx ON businesses(name);

    -- Which (search term, city) pairs the Google Places importer has completed,
    -- so a restart resumes instead of paying for the same searches again.
    CREATE TABLE IF NOT EXISTS places_query_log (
      term         TEXT NOT NULL,
      city_slug    TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      results      INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (term, city_slug)
    );
    CREATE TABLE IF NOT EXISTS import_runs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      kind        TEXT NOT NULL,
      started_at  TEXT NOT NULL,
      finished_at TEXT,
      requests    INTEGER NOT NULL DEFAULT 0,
      inserted    INTEGER NOT NULL DEFAULT 0,
      linked      INTEGER NOT NULL DEFAULT 0,
      updated     INTEGER NOT NULL DEFAULT 0,
      rejected    INTEGER NOT NULL DEFAULT 0,
      note        TEXT
    );
  `);
  // Google Places columns. Rows from Google keep osm_id = 'google:<place_id>' and
  // osm_url = the Google Maps link so the original NOT NULL columns stay valid.
  addColumn(db, "businesses", "source", "TEXT NOT NULL DEFAULT 'osm'");
  addColumn(db, "businesses", "google_place_id", "TEXT");
  addColumn(db, "businesses", "google_fetched_at", "TEXT");
  addColumn(db, "businesses", "google_maps_url", "TEXT");
  addColumn(db, "businesses", "google_fields", "TEXT");
  addColumn(db, "businesses", "rating", "REAL");
  addColumn(db, "businesses", "rating_count", "INTEGER");
  addColumn(db, "businesses", "is_active", "INTEGER NOT NULL DEFAULT 1");
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS businesses_google_place_idx
      ON businesses(google_place_id) WHERE google_place_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS businesses_active_idx ON businesses(is_active);
  `);
}

/** Directory ownership claims. The partial unique indexes make the important
 * constraints race-safe even when two browser requests arrive together. */
function migrateListingClaims(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS listing_claims (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id  INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      vendor_id    INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
      status       TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
      method       TEXT NOT NULL CHECK (method IN ('auto_domain', 'manual')),
      proof_note   TEXT,
      created_at   TEXT NOT NULL,
      decided_at   TEXT,
      decided_note TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS listing_claims_vendor_business_unique
      ON listing_claims(vendor_id, business_id);
    CREATE UNIQUE INDEX IF NOT EXISTS listing_claims_vendor_pending_unique
      ON listing_claims(vendor_id) WHERE status = 'pending';
    CREATE UNIQUE INDEX IF NOT EXISTS listing_claims_business_active_unique
      ON listing_claims(business_id) WHERE status IN ('pending', 'approved');
    CREATE INDEX IF NOT EXISTS listing_claims_status_created_idx
      ON listing_claims(status, created_at);
  `);
}

function seedIfEmpty(db: Database) {
  const row = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM deals").get();
  if (row && row.n > 0) return;

  const now = Date.now();
  const startsAt = new Date(now - 3 * 86_400_000).toISOString();
  const insert = db.prepare(`
    INSERT INTO deals (
      slug, title, vendor_name, vendor_city, category_slug, description, highlights,
      fine_print, price_cents, value_cents, voucher_limit, vouchers_sold, image_hint,
      is_sample, starts_at, ends_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seedAll = db.transaction(() => {
    for (const d of SEED_DEALS) {
      insert.run(
        d.slug,
        d.title,
        d.vendor_name,
        d.vendor_city,
        d.category_slug,
        d.description,
        JSON.stringify(d.highlights),
        d.fine_print,
        d.price_cents,
        d.value_cents,
        d.voucher_limit,
        d.vouchers_sold,
        d.image_hint,
        1, // every seeded deal is demo data from a fictional "Sample —" vendor
        startsAt,
        d.ends_in_days == null ? null : new Date(now + d.ends_in_days * 86_400_000).toISOString(),
      );
    }
  });
  seedAll();
}

export const DB_FILE = DB_PATH;

/** Vendor-uploaded photos, stored as downscaled image bytes. deals/businesses
 * point at a photo with photo_id; NULL keeps the gradient artwork. */
function migratePhotos(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS photos (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      mime       TEXT NOT NULL,
      bytes      BLOB NOT NULL,
      vendor_id  INTEGER REFERENCES vendors(id),
      created_at TEXT NOT NULL
    );
  `);
  addColumn(db, "deals", "photo_id", "INTEGER REFERENCES photos(id)");
  addColumn(db, "businesses", "photo_id", "INTEGER REFERENCES photos(id)");
}

/**
 * Free Trial Vendor system (idempotent).
 *
 * vendors.tier has a CHECK that cannot be altered without a table rebuild, so a
 * trial vendor stays on tier 'free' and all trial state lives here:
 *   free_trials      — one row per trial request; status drives eligibility
 *   trial_city_caps  — per-city vendor cap (pilot starts Leesburg at 3)
 *   trial_audit      — every trial action, who did it, and why
 *   trial_alerts     — admin alerts (deduped by alert_key)
 *   buyers/_sessions — registered buyers; the platform keeps their data
 *   trial_complaints — one complaint per buyer per deal
 * deals.review_state is separate from deals.status because hydrate() only
 * understands 'published' | 'paused'.
 */
function migrateFreeTrials(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS free_trials (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id         INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
      business_id       INTEGER NOT NULL REFERENCES businesses(id),
      city_slug         TEXT NOT NULL,
      category_slug     TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'requested'
                        CHECK (status IN ('requested','active','lapsed','ended','terminated','rejected')),
      requested_at      TEXT NOT NULL,
      approved_at       TEXT,
      expires_at        TEXT,
      live_deadline_at  TEXT,
      first_live_at     TEXT,
      ended_at          TEXT,
      end_reason        TEXT,
      decision_note     TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS free_trials_business_unique
      ON free_trials(business_id) WHERE status IN ('requested','active','ended','terminated');
    CREATE UNIQUE INDEX IF NOT EXISTS free_trials_vendor_unique
      ON free_trials(vendor_id) WHERE status IN ('requested','active','ended','terminated');
    CREATE UNIQUE INDEX IF NOT EXISTS free_trials_category_unique
      ON free_trials(city_slug, category_slug) WHERE status IN ('active','ended','terminated');
    CREATE INDEX IF NOT EXISTS free_trials_status_idx ON free_trials(status);

    CREATE TABLE IF NOT EXISTS trial_city_caps (
      city_slug  TEXT PRIMARY KEY,
      vendor_cap INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trial_audit (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      trial_id  INTEGER REFERENCES free_trials(id) ON DELETE CASCADE,
      deal_id   INTEGER,
      actor     TEXT NOT NULL,
      action    TEXT NOT NULL,
      detail    TEXT NOT NULL DEFAULT '',
      at        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS trial_audit_trial_idx ON trial_audit(trial_id, id);

    CREATE TABLE IF NOT EXISTS trial_alerts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      trial_id    INTEGER REFERENCES free_trials(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL,
      message     TEXT NOT NULL,
      alert_key   TEXT NOT NULL UNIQUE,
      created_at  TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS buyers (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS buyer_sessions (
      token      TEXT PRIMARY KEY,
      buyer_id   INTEGER NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS buyer_login_attempts (
      email        TEXT PRIMARY KEY,
      fail_count   INTEGER NOT NULL DEFAULT 0,
      window_start TEXT NOT NULL,
      last_attempt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trial_complaints (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id    INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      buyer_id   INTEGER NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
      voucher_id INTEGER REFERENCES vouchers(id),
      reason     TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (deal_id, buyer_id)
    );
  `);

  addColumn(db, "vendors", "stripe_connect_account_id", "TEXT");
  addColumn(db, "vendors", "stripe_connect_charges_enabled", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "vendors", "stripe_connect_details_submitted", "INTEGER NOT NULL DEFAULT 0");

  addColumn(db, "deals", "trial_id", "INTEGER REFERENCES free_trials(id)");
  addColumn(db, "deals", "review_state", "TEXT NOT NULL DEFAULT 'none'");
  addColumn(db, "deals", "review_note", "TEXT");
  addColumn(db, "deals", "reviewed_at", "TEXT");
  addColumn(db, "deals", "paused_reason", "TEXT");

  addColumn(db, "vouchers", "buyer_id", "INTEGER REFERENCES buyers(id)");
  addColumn(db, "vouchers", "stripe_session_id", "TEXT");
  addColumn(db, "vouchers", "stripe_payment_intent", "TEXT");
  addColumn(db, "vouchers", "checkout_expires_at", "TEXT");

  db.exec(`
    CREATE INDEX IF NOT EXISTS deals_trial_idx ON deals(trial_id);
    CREATE INDEX IF NOT EXISTS vouchers_buyer_idx ON vouchers(buyer_id);
    CREATE UNIQUE INDEX IF NOT EXISTS vouchers_stripe_session_key
      ON vouchers(stripe_session_id) WHERE stripe_session_id IS NOT NULL;
  `);

  // Leesburg pilot starts with 3 vendors; other cities use the default cap.
  db.query("INSERT OR IGNORE INTO trial_city_caps (city_slug, vendor_cap) VALUES ('leesburg', 3)").run();
}
