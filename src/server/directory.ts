// SERVER-ONLY directory queries. The server functions in ./directory-functions.ts
// call these through a dynamic import so bun:sqlite never reaches the client bundle.
import { getDb } from "./db";
import type { Business, CountRow } from "./directory-functions";

export function categoryCounts(): CountRow[] {
  return getDb().query<CountRow, []>("SELECT category_slug AS slug, COUNT(*) AS count FROM businesses WHERE is_active = 1 GROUP BY category_slug").all();
}

export function listBusinesses(input: { category?: string; city?: string; q?: string; limit?: number }): { businesses: Business[]; total: number } {
  const where: string[] = ["is_active = 1"];
  const values: (string | number)[] = [];
  if (input.category) { where.push("category_slug = ?"); values.push(input.category); }
  if (input.city) { where.push("city_slug = ?"); values.push(input.city); }
  if (input.q?.trim()) { where.push("name LIKE ? COLLATE NOCASE"); values.push(`%${input.q.trim()}%`); }
  const clause = ` WHERE ${where.join(" AND ")}`;
  const db = getDb();
  const total = db.query<{ count: number }, (string | number)[]>(`SELECT COUNT(*) AS count FROM businesses${clause}`).get(...values)?.count ?? 0;
  const limit = Math.min(Math.max(Number(input.limit) || 100, 1), 300);
  const businesses = db.query<Business, (string | number)[]>(`SELECT * FROM businesses${clause} ORDER BY name COLLATE NOCASE LIMIT ?`).all(...values, limit);
  return { businesses, total };
}

export function businessBySlug(slug: string): Business | null {
  return getDb().query<Business, [string]>("SELECT * FROM businesses WHERE slug = ? AND is_active = 1").get(slug) ?? null;
}

export function cityOverview(city: string): { businesses: Business[]; counts: CountRow[]; total: number } {
  const db = getDb();
  const businesses = db.query<Business, [string]>("SELECT * FROM businesses WHERE city_slug = ? AND is_active = 1 ORDER BY category_slug, name COLLATE NOCASE").all(city);
  const counts = db.query<CountRow, [string]>("SELECT category_slug AS slug, COUNT(*) AS count FROM businesses WHERE city_slug = ? AND is_active = 1 GROUP BY category_slug").all(city);
  return { businesses, counts, total: businesses.length };
}
