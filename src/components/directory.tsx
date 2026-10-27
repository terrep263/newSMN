import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { Business } from "~/server/directory-functions";

export function OSMAttribution() {
  return <p className="mt-8 text-center text-xs text-ink-soft">Data © <a className="underline hover:text-brand" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors, ODbL</a> · Business details and ratings from <a className="underline hover:text-brand" href="https://www.google.com/maps" target="_blank" rel="noreferrer">Google Maps</a></p>;
}

export function BusinessCard({ business }: { business: Business }) {
  return <article className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
    {business.photo_id && <img src={`/api/photos/${business.photo_id}`} alt={business.name} loading="lazy" className="aspect-[16/9] w-full object-cover" />}
    <div className="p-5">
    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-brand-green-dark">{business.city_name}</p>{business.rating != null && <p className="mt-1 text-xs font-semibold text-ink-soft">★ {business.rating.toFixed(1)}{business.rating_count ? ` (${business.rating_count.toLocaleString("en-US")})` : ""}</p>}
    <h2 className="mt-1 font-display text-xl font-semibold text-brand-dark"><Link to="/business/$slug" params={{ slug: business.slug }} className="hover:underline">{business.name}</Link></h2>
    {(business.street || business.postcode) && <p className="mt-2 text-sm text-ink-soft">{[business.street, business.postcode].filter(Boolean).join(", ")}</p>}
    <div className="mt-4 flex flex-wrap gap-2">
      <Link to="/business/$slug" params={{ slug: business.slug }} className="rounded-full bg-brand px-3.5 py-2 text-xs font-semibold text-white hover:bg-brand-dark">View listing</Link>
      {business.phone && <a href={`tel:${business.phone.replace(/[^+\d]/g, "")}`} className="rounded-full border border-brand/25 px-3.5 py-2 text-xs font-semibold text-brand-dark hover:border-brand">Call</a>}
    </div>
    </div>
  </article>;
}

export function DirectoryHero({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return <section className="border-b border-black/5 bg-white/60"><div className="mx-auto max-w-6xl px-4 py-12"><p className="kicker">{kicker}</p><h1 className="mt-2 font-display text-3xl font-semibold text-brand-dark sm:text-4xl">{title}</h1>{children}</div></section>;
}
