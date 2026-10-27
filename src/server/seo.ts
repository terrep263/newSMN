// SERVER-ONLY. SEO plumbing: the public origin, robots.txt and sitemap.xml.
// Import dynamically from route handlers and server functions only.

import { CITIES } from "../lib/taxonomy";
import { DISALLOWED_PATHS } from "../lib/seo";
import { getDb } from "./db";
import { listDeals } from "./repository";

const BRAND_ORIGIN = "https://shopmyneighborhood.com";
const LOOPBACK = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/;

/**
 * Public origin for absolute URLs. Same order the rest of the app uses:
 * SITE_ORIGIN if set, else the request's own (non-loopback) host, else the
 * brand domain.
 */
export function resolveOrigin(host: string | null | undefined, proto: string | null | undefined): string {
  const explicit = (process.env.SITE_ORIGIN ?? "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const h = (host ?? "").split(",")[0].trim();
  const p = (proto ?? "").split(",")[0].trim();
  if (h && !LOOPBACK.test(h)) return `${p === "http" ? "http" : "https"}://${h}`;
  return BRAND_ORIGIN;
}

export function originFromRequest(request: Request): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return resolveOrigin(host, proto);
}

export function robotsTxt(origin: string): string {
  return [
    "User-agent: *",
    "Allow: /",
    ...DISALLOWED_PATHS.map((p) => `Disallow: ${p}`),
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function lastmod(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

type UrlEntry = { path: string; lastmod?: string | null };

export function sitemapXml(origin: string): string {
  const entries: UrlEntry[] = [
    { path: "/" },
    { path: "/deals" },
    { path: "/businesses" },
    { path: "/categories" },
    { path: "/vendor" },
    { path: "/terms" },
    { path: "/privacy" },
    { path: "/refunds" },
    ...CITIES.map((c) => ({ path: `/city/${c.slug}` })),
  ];

  for (const deal of listDeals()) {
    entries.push({ path: `/deals/${deal.slug}` });
  }

  const businesses = getDb()
    .query<{ slug: string; updated_at: string | null }, []>("SELECT slug, updated_at FROM businesses WHERE is_active = 1 ORDER BY id")
    .all();
  for (const b of businesses) {
    entries.push({ path: `/business/${b.slug}`, lastmod: lastmod(b.updated_at) });
  }

  const base = origin.replace(/\/+$/, "");
  const urls = entries
    .map((e) => {
      const mod = e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : "";
      return `<url><loc>${xmlEscape(`${base}${e.path.split("/").map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg))).join("/")}`)}</loc>${mod}</url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
