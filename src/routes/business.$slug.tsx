import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { OSMAttribution } from "~/components/directory";
import { Icon } from "~/components/icons";
import { MarketplaceShell } from "~/components/site-chrome";
import { businessJsonLd, canonicalUrl, jsonLdText } from "~/lib/seo";
import { directoryCategoryFromSlug } from "~/lib/taxonomy";
import { fetchDirectoryBusiness } from "~/server/directory-functions";
import { fetchSiteOrigin } from "~/server/seo-functions";

export const Route = createFileRoute("/business/$slug")({
  loader: async ({ params }) => { const [business, origin] = await Promise.all([fetchDirectoryBusiness({ data: { slug: params.slug } }), fetchSiteOrigin()]); if (!business) throw notFound(); return { business, origin, category: directoryCategoryFromSlug(business.category_slug) }; },
  head: ({ loaderData }) => {
    const origin = loaderData?.origin;
    const business = loaderData?.business;
    return {
      meta: [
        { title: loaderData ? `${loaderData.business.name} | ${loaderData.business.city_name}, FL` : "Business not found" },
        { name: "description", content: loaderData ? `${loaderData.business.name}, a local ${loaderData.category?.name ?? "business"} listing in ${loaderData.business.city_name}, Florida.` : "" },
      ],
      scripts: business && origin
        ? [{ type: "application/ld+json", children: jsonLdText(businessJsonLd(business, canonicalUrl(origin, `/business/${business.slug}`), loaderData?.category?.name)) }]
        : [],
    };
  },
  component: BusinessPage,
});
function readableHours(hours: string) { const simple = hours.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/); if (!simple) return hours; const days: Record<string, string> = { Mo: "Monday", Tu: "Tuesday", We: "Wednesday", Th: "Thursday", Fr: "Friday", Sa: "Saturday", Su: "Sunday" }; const [start, end] = simple[1].split("-"); return `${days[start]}${end ? `–${days[end]}` : ""}: ${simple[2]}–${simple[3]}`; }
function BusinessPage() {
  const { business, category } = Route.useLoaderData(); const address = [business.street, business.city_name, "FL", business.postcode].filter(Boolean).join(", "); const map = business.lat != null && business.lon != null ? `https://www.openstreetmap.org/?mlat=${business.lat}&mlon=${business.lon}#map=17/${business.lat}/${business.lon}` : `https://www.openstreetmap.org/search?query=${encodeURIComponent(`${business.name} ${business.city_name} Florida`)}`;
  return <MarketplaceShell city={business.city_slug}><div className="mx-auto max-w-4xl px-4 py-6"><nav className="text-xs text-ink-soft"><Link to="/businesses" className="hover:text-brand">Directory</Link><span className="mx-1.5">/</span><Link to="/city/$slug" params={{ slug: business.city_slug }} className="hover:text-brand">{business.city_name}</Link><span className="mx-1.5">/</span><span>{business.name}</span></nav><article className="mt-5 rounded-3xl border border-black/5 bg-white p-6 shadow-sm sm:p-8"><p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-brand-green-dark">{category?.name ?? "Local business"} · {business.city_name}</p><div className="mt-2 flex flex-wrap items-center gap-3"><h1 className="font-display text-3xl font-semibold text-brand-dark sm:text-4xl">{business.name}</h1>{business.is_claimed === 1 && <span className="rounded-full bg-brand-green/15 px-3 py-1 text-xs font-bold text-brand-green-dark ring-1 ring-brand-green/30">Claimed by the business</span>}</div>{business.description && <p className="mt-4 text-sm leading-relaxed text-ink-soft">{business.description}</p>}<div className="mt-7 grid gap-5 border-t border-black/5 pt-6 sm:grid-cols-2">{address && <Info icon="pin" label="Address">{address}</Info>}{business.phone && <Info icon="phone" label="Phone"><a className="font-semibold text-brand hover:underline" href={`tel:${business.phone.replace(/[^+\d]/g, "")}`}>{business.phone}</a></Info>}{business.website && <Info icon="arrow" label="Website"><a className="font-semibold text-brand hover:underline" href={business.website} target="_blank" rel="noreferrer">Visit website</a></Info>}{business.opening_hours && <Info icon="clock" label="Hours">{readableHours(business.opening_hours)}</Info>}</div><div className="mt-8 flex flex-wrap gap-3"><a href={map} target="_blank" rel="noreferrer" className="rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">View map</a><a href={business.osm_url} target="_blank" rel="noreferrer" className="rounded-full border border-brand/30 px-4 py-2.5 text-sm font-semibold text-brand-dark hover:border-brand">OpenStreetMap record</a>{business.is_claimed !== 1 && <Link to="/vendor/claim" className="rounded-full border border-brand-green/40 px-4 py-2.5 text-sm font-semibold text-brand-green-dark hover:border-brand-green">Is this your business? Claim this free listing</Link>}</div></article><OSMAttribution /></div></MarketplaceShell>;
}
function Info({ icon, label, children }: { icon: string; label: string; children: ReactNode }) { return <div className="flex gap-3"><Icon name={icon} className="mt-0.5 h-5 w-5 shrink-0 text-brand" /><div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft">{label}</p><div className="mt-1 text-sm text-ink">{children}</div></div></div>; }
