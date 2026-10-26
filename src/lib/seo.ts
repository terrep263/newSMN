// Shared SEO helpers — pure functions, safe to import from client and server code.

import type { Business } from "~/server/directory-functions";

/**
 * Pages that must not be indexed: vendor tools, the admin screen, voucher pages
 * (they carry a private code) and API endpoints. "/vendor" itself is the public
 * "For Vendors" pitch page and stays indexable.
 */
export const DISALLOWED_PATHS = ["/vendor/", "/admin", "/voucher/", "/api/"] as const;

export function isPrivatePath(pathname: string): boolean {
  // The router reports index routes with a trailing slash ("/vendor/"), so
  // compare without it: "/vendor" is public, "/vendor/login" is not.
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return (
    path.startsWith("/vendor/") ||
    path.startsWith("/voucher/") ||
    path.startsWith("/api/") ||
    path === "/admin" ||
    path.startsWith("/admin/")
  );
}

/** Canonical URL: origin + pathname, never the query string. */
export function canonicalUrl(origin: string, pathname: string): string {
  const path = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");
  return `${origin.replace(/\/+$/, "")}${path}`;
}

const DAY = "(?:Mo|Tu|We|Th|Fr|Sa|Su)";
const SIMPLE_HOURS = new RegExp(`^${DAY}(?:-${DAY})?\\s+\\d{1,2}:\\d{2}-\\d{1,2}:\\d{2}$`);

/** schema.org LocalBusiness for a directory listing. Only fields we actually have. */
export function businessJsonLd(business: Business, pageUrl: string, categoryName?: string) {
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: business.name,
    url: business.website || pageUrl,
    mainEntityOfPage: pageUrl,
  };
  if (business.description) data.description = business.description;
  else if (categoryName) data.description = `${business.name}, a local ${categoryName} listing in ${business.city_name}, Florida.`;
  if (business.phone) data.telephone = business.phone;

  const address: Record<string, string> = {
    "@type": "PostalAddress",
    addressLocality: business.city_name,
    addressRegion: "FL",
    addressCountry: "US",
  };
  if (business.street) address.streetAddress = business.street;
  if (business.postcode) address.postalCode = business.postcode;
  data.address = address;

  if (business.lat != null && business.lon != null) {
    data.geo = { "@type": "GeoCoordinates", latitude: business.lat, longitude: business.lon };
  }
  if (business.opening_hours && SIMPLE_HOURS.test(business.opening_hours)) {
    data.openingHours = business.opening_hours;
  }
  return data;
}

/** JSON for an inline <script type="application/ld+json">; "<" is escaped so the text can't close the tag. */
export function jsonLdText(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
