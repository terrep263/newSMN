// Directory link + search verifier.
// Usage: BASE_URL=https://new.shopmyneighborhood.com bun run scripts/verify-directory.ts
// Checks every city x category link target, the category redirects, legacy slugs, the
// hero/footer links and pagination. Exits 1 on any failure.

import { CITIES, DIRECTORY_CATEGORIES } from "../src/lib/taxonomy";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = "") {
  checks++;
  if (!ok) {
    failures++;
    console.log(`FAIL ${name} ${detail}`);
  }
}

async function page(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, init);
  return { res, html: await res.text() };
}

const showing = (html: string) => {
  const m = html.match(/Showing (\d+)(?:<!-- -->)?–(?:<!-- -->)?(\d+) of (?:<!-- -->)?([\d,]+)/) ?? html.match(/0 businesses found/);
  if (!m) return null;
  return m.length > 1 ? Number(m[3].replace(/,/g, "")) : 0;
};

// 1. Every city page and every category tile target responds 200 with a count.
for (const city of CITIES) {
  const { res, html } = await page(`/city/${city.slug}`);
  check(`city page ${city.slug}`, res.status === 200 && html.includes(city.name));
  for (const category of DIRECTORY_CATEGORIES) {
    const r = await page(`/businesses?city=${city.slug}&category=${category.slug}`);
    check(`search ${city.slug}+${category.slug}`, r.res.status === 200 && showing(r.html) !== null, `status ${r.res.status}`);
  }
}

// 2. Category-only search for every category.
for (const category of DIRECTORY_CATEGORIES) {
  const r = await page(`/businesses?category=${category.slug}`);
  check(`category ${category.slug}`, r.res.status === 200 && showing(r.html) !== null);
}

// 3. Old category URLs redirect to the one search (301), keeping the city.
for (const category of DIRECTORY_CATEGORIES.slice(0, 3)) {
  const r = await fetch(`${BASE}/categories/${category.slug}?city=leesburg`, { redirect: "manual" });
  const loc = r.headers.get("location") ?? "";
  check(`redirect ${category.slug}`, [301, 307, 308].includes(r.status) && loc.includes(`category=${category.slug}`) && loc.includes("city=leesburg"), `${r.status} ${loc}`);
}

// 4. Legacy category slugs resolve to the merged slugs.
for (const [legacy, current] of [
  ["health-medical", "health-medical-services"],
  ["home-repair-handyman", "home-repair-handyman-services"],
  ["hair-nails-barbers", "hair-nails-barber-shops"],
]) {
  const r = await page(`/businesses?category=${legacy}`);
  check(`legacy ${legacy}`, r.res.url.includes(`category=${current}`) || r.html.includes(DIRECTORY_CATEGORIES.find((c) => c.slug === current)!.name));
}

// 5. Home page links and form point at the directory search; no old category links remain.
const home = await page("/");
check("home hero form", home.html.includes('action="/businesses"'));
check("home category links", (home.html.match(/href="\/businesses\?category=[^"]+"/g) ?? []).length >= DIRECTORY_CATEGORIES.length);
check("home has no /categories/<slug> links", !/href="\/categories\/[^"]+"/.test(home.html));

// 6. Pagination and sorting respond.
const p2 = await page("/businesses?page=2");
const total = showing((await page("/businesses")).html) ?? 0;
check("pagination page 2", total <= 24 || (p2.res.status === 200 && /Showing 25/.test(p2.html.replace(/<!-- -->/g, ""))));
for (const sort of ["reviews", "name"]) {
  const r = await page(`/businesses?sort=${sort}`);
  check(`sort ${sort}`, r.res.status === 200 && showing(r.html) !== null);
}

// 7. Name search narrows results.
const q = await page("/businesses?q=zzzzqqq");
check("name search no match", showing(q.html) === 0);

console.log(`${checks - failures}/${checks} checks passed against ${BASE}`);
process.exit(failures ? 1 : 0);
