// Server functions for the public OpenStreetMap business directory.
import { createServerFn } from "@tanstack/react-start";

export type Business = {
  id: number; osm_id: string; slug: string; name: string; category_slug: string;
  city_slug: string; city_name: string; street: string | null; postcode: string | null;
  lat: number | null; lon: number | null; phone: string | null; email: string | null;
  website: string | null; opening_hours: string | null; description: string | null; osm_url: string;
  is_claimed: number; claimed_by_vendor_id: number | null; photo_id: number | null;
  source: string; google_place_id: string | null; google_maps_url: string | null; rating: number | null; rating_count: number | null; is_active: number;
};
export type CountRow = { slug: string; count: number };

export const fetchDirectoryCategoryCounts = createServerFn({ method: "GET" }).handler(async () => {
  return (await import("./directory")).categoryCounts();
});

export const fetchDirectoryBusinesses = createServerFn({ method: "GET" })
  .validator((input: { category?: string; city?: string; q?: string; limit?: number }) => input)
  .handler(async ({ data }): Promise<{ businesses: Business[]; total: number }> => {
    return (await import("./directory")).listBusinesses(data);
  });

export const fetchDirectoryBusiness = createServerFn({ method: "GET" })
  .validator((input: { slug: string }) => input)
  .handler(async ({ data }): Promise<Business | null> => {
    return (await import("./directory")).businessBySlug(data.slug);
  });

export const fetchDirectoryCity = createServerFn({ method: "GET" })
  .validator((input: { city: string }) => input)
  .handler(async ({ data }): Promise<{ businesses: Business[]; counts: CountRow[]; total: number }> => {
    return (await import("./directory")).cityOverview(data.city);
  });
