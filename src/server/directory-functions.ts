// Server functions for the public OpenStreetMap business directory.
import { createServerFn } from "@tanstack/react-start";

export type Business = {
  id: number; osm_id: string; slug: string; name: string; category_slug: string;
  city_slug: string; city_name: string; street: string | null; postcode: string | null;
  lat: number | null; lon: number | null; phone: string | null; email: string | null;
  website: string | null; opening_hours: string | null; description: string | null; osm_url: string;
  is_claimed: number; claimed_by_vendor_id: number | null;
};
export type CountRow = { slug: string; count: number };

export const fetchDirectoryCategoryCounts = createServerFn({ method: "GET" }).handler(async () => {
  const { getDb } = await import("./db");
  return getDb().query<CountRow, []>("SELECT category_slug AS slug, COUNT(*) AS count FROM businesses GROUP BY category_slug").all();
});

export const fetchDirectoryBusinesses = createServerFn({ method: "GET" })
  .validator((input: { category?: string; city?: string; q?: string; limit?: number }) => input)
  .handler(async ({ data }): Promise<{ businesses: Business[]; total: number }> => {
    const { getDb } = await import("./db");
    const where: string[] = [];
    const values: (string | number)[] = [];
    if (data.category) { where.push("category_slug = ?"); values.push(data.category); }
    if (data.city) { where.push("city_slug = ?"); values.push(data.city); }
    if (data.q?.trim()) { where.push("name LIKE ? COLLATE NOCASE"); values.push(`%${data.q.trim()}%`); }
    const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const db = getDb();
    const total = db.query<{ count: number }, (string | number)[]>(`SELECT COUNT(*) AS count FROM businesses${clause}`).get(...values)?.count ?? 0;
    const limit = Math.min(Math.max(Number(data.limit) || 100, 1), 300);
    const businesses = db.query<Business, (string | number)[]>(`SELECT * FROM businesses${clause} ORDER BY name COLLATE NOCASE LIMIT ?`).all(...values, limit);
    return { businesses, total };
  });

export const fetchDirectoryBusiness = createServerFn({ method: "GET" })
  .validator((input: { slug: string }) => input)
  .handler(async ({ data }): Promise<Business | null> => {
    const { getDb } = await import("./db");
    return getDb().query<Business, [string]>("SELECT * FROM businesses WHERE slug = ?").get(data.slug) ?? null;
  });

export const fetchDirectoryCity = createServerFn({ method: "GET" })
  .validator((input: { city: string }) => input)
  .handler(async ({ data }): Promise<{ businesses: Business[]; counts: CountRow[]; total: number }> => {
    const { getDb } = await import("./db"); const db = getDb();
    const businesses = db.query<Business, [string]>("SELECT * FROM businesses WHERE city_slug = ? ORDER BY category_slug, name COLLATE NOCASE").all(data.city);
    const counts = db.query<CountRow, [string]>("SELECT category_slug AS slug, COUNT(*) AS count FROM businesses WHERE city_slug = ? GROUP BY category_slug").all(data.city);
    return { businesses, counts, total: businesses.length };
  });
