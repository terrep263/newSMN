// SERVER-ONLY directory queries. The server functions in ./directory-functions.ts
// call these through a dynamic import so bun:sqlite never reaches the client bundle.
import { getDb } from "./db";
import type { Business, CountRow, DirectoryPage } from "./directory-functions";

export const PAGE_SIZE = 24;
export type DirectorySort = "top" | "name" | "reviews";

export function categoryCounts(): CountRow[] {
  return getDb().query<CountRow, []>("SELECT category_slug AS slug, COUNT(*) AS count FROM businesses WHERE is_active = 1 GROUP BY category_slug").all();
}

// Rating weighted by review count, so a 5.0 from one review does not beat a 4.7 from 400.
const TOP_SCORE = "COALESCE((rating * rating_count + 40.0) / (rating_count + 10.0), 0)";
const ORDER: Record<DirectorySort, string> = {
  top: `${TOP_SCORE} DESC, name COLLATE NOCASE`,
  name: "name COLLATE NOCASE",
  reviews: "COALESCE(rating_count, 0) DESC, name COLLATE NOCASE",
};

type Filters = { category?: string; city?: string; q?: string };

function where(filters: Filters, skip?: "category" | "city"): { clause: string; values: (string | number)[] } {
  const parts = ["is_active = 1"];
  const values: (string | number)[] = [];
  if (filters.category && skip !== "category") { parts.push("category_slug = ?"); values.push(filters.category); }
  if (filters.city && skip !== "city") { parts.push("city_slug = ?"); values.push(filters.city); }
  if (filters.q?.trim()) { parts.push("name LIKE ? COLLATE NOCASE"); values.push(`%${filters.q.trim()}%`); }
  return { clause: ` WHERE ${parts.join(" AND ")}`, values };
}

export function listBusinesses(input: Filters & { sort?: string; page?: number; pageSize?: number }): DirectoryPage {
  const db = getDb();
  const { clause, values } = where(input);
  const total = db.query<{ count: number }, (string | number)[]>(`SELECT COUNT(*) AS count FROM businesses${clause}`).get(...values)?.count ?? 0;
  const pageSize = Math.min(Math.max(Math.floor(Number(input.pageSize)) || PAGE_SIZE, 1), 300);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(Math.floor(Number(input.page)) || 1, 1), pages);
  const sort: DirectorySort = input.sort === "name" || input.sort === "reviews" ? input.sort : "top";
  const businesses = db
    .query<Business, (string | number)[]>(`SELECT * FROM businesses${clause} ORDER BY ${ORDER[sort]} LIMIT ? OFFSET ?`)
    .all(...values, pageSize, (page - 1) * pageSize);

  // Counts that stay useful as you narrow: categories within the chosen city, cities within the chosen category.
  const cat = where(input, "category");
  const city = where(input, "city");
  const categoryFacets = db.query<CountRow, (string | number)[]>(`SELECT category_slug AS slug, COUNT(*) AS count FROM businesses${cat.clause} GROUP BY category_slug`).all(...cat.values);
  const cityFacets = db.query<CountRow, (string | number)[]>(`SELECT city_slug AS slug, COUNT(*) AS count FROM businesses${city.clause} GROUP BY city_slug`).all(...city.values);
  return { businesses, total, page, pages, pageSize, categoryFacets, cityFacets };
}

export function businessBySlug(slug: string): Business | null {
  return getDb().query<Business, [string]>("SELECT * FROM businesses WHERE slug = ? AND is_active = 1").get(slug) ?? null;
}

export function cityOverview(city: string): { counts: CountRow[]; total: number } {
  const counts = getDb().query<CountRow, [string]>("SELECT category_slug AS slug, COUNT(*) AS count FROM businesses WHERE city_slug = ? AND is_active = 1 GROUP BY category_slug").all(city);
  return { counts, total: counts.reduce((sum, row) => sum + row.count, 0) };
}
