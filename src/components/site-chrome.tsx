import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { CATEGORIES, CITIES, SITE } from "~/lib/taxonomy";
import { Icon } from "~/components/icons";

/** Slim, site-wide honesty banner: this is a preview with sample deals. */
export function PreviewBanner() {
  return (
    <div className="no-print bg-brand-dark px-4 py-1.5 text-center text-[0.72rem] leading-snug text-white/95">
      <span className="font-semibold">Preview build</span> — the deals below are{" "}
      <span className="font-semibold">sample data</span> and payments are{" "}
      <span className="font-semibold">not live yet</span>. Checkout issues a demo voucher without
      charging anything.
    </div>
  );
}

/** Fixed thin trust bar that sits above the header. */
export function TrustBar() {
  return (
    <div className="no-print border-b border-black/5 bg-white/70 text-[0.72rem] text-ink-soft">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-5 gap-y-1 px-4 py-1.5 sm:justify-between">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="pin" className="h-3.5 w-3.5 text-brand-green" />
          {SITE.county}
        </span>
        <span className="inline-flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
          <a className="inline-flex items-center gap-1.5 hover:text-brand" href={`mailto:${SITE.email}`}>
            <Icon name="mail" className="h-3.5 w-3.5 text-brand" />
            {SITE.email}
          </a>
          <a className="inline-flex items-center gap-1.5 hover:text-brand" href={SITE.phoneHref}>
            <Icon name="phone" className="h-3.5 w-3.5 text-brand" />
            {SITE.phone}
          </a>
        </span>
      </div>
    </div>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="group flex items-center gap-2.5">
      <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand text-white shadow-sm ring-1 ring-brand-dark/20">
        <Icon name="pin" className="h-5 w-5" />
        <span className="absolute -right-1 -bottom-1 grid h-4 w-4 place-items-center rounded-full bg-brand-green text-[0.5rem] font-bold text-white ring-2 ring-cream">
          ✓
        </span>
      </span>
      <span className="leading-none">
        <span className="block font-display text-[1.02rem] font-bold tracking-tight text-brand-dark sm:text-[1.15rem]">
          Shop My Neighborhood
        </span>
        {!compact && (
          <span className="mt-1 block text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-ink-soft">
            Lake County Marketplace
          </span>
        )}
      </span>
    </Link>
  );
}

export function CitySwitcher({ current }: { current?: string }) {
  const navigate = useNavigate();
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">Choose your city</span>
      <Icon name="pin" className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-brand" />
      <select
        value={current ?? ""}
        onChange={(e) => {
          const slug = e.target.value;
          navigate({ to: "/deals", search: slug ? { city: slug } : {} });
        }}
        className="appearance-none rounded-full border border-black/10 bg-white py-1.5 pr-7 pl-7 text-[0.78rem] font-medium text-ink shadow-sm hover:border-brand/40 focus:ring-2 focus:ring-brand/30 focus:outline-none"
      >
        <option value="">All of Lake County</option>
        {CITIES.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.name}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2 text-[0.6rem] text-ink-soft">▾</span>
    </label>
  );
}

export function SiteHeader({ city, vendorName }: { city?: string; vendorName?: string }) {
  return (
    <header className="no-print sticky top-0 z-40 border-b border-black/5 bg-cream/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
        <Wordmark />
        <nav className="hidden items-center gap-6 text-[0.78rem] font-semibold tracking-[0.14em] text-ink-soft uppercase md:flex">
          <Link to="/" className="hover:text-brand" activeOptions={{ exact: true }} activeProps={{ className: "text-brand" }}>
            Home
          </Link>
          <Link to="/deals" className="hover:text-brand" activeProps={{ className: "text-brand" }}>
            Deals
          </Link>
          <Link to="/businesses" className="hover:text-brand" activeProps={{ className: "text-brand" }}>
            Directory
          </Link>
          <Link to="/categories" className="hover:text-brand">
            Categories
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <CitySwitcher current={city} />
          {vendorName ? (
            <Link
              to="/vendor/dashboard"
              className="hidden max-w-[15rem] items-center gap-2 rounded-full border border-brand/30 bg-white px-3 py-1.5 text-[0.75rem] font-semibold text-brand-dark shadow-sm transition hover:border-brand sm:inline-flex"
              title="Signed in — go to your vendor dashboard"
            >
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-green/20 text-[0.6rem] font-bold text-brand-green-dark">
                ✓
              </span>
              <span className="truncate">{vendorName}</span>
            </Link>
          ) : (
            <Link
              to="/vendor"
              className="hidden rounded-full bg-brand px-4 py-2 text-[0.78rem] font-semibold text-white shadow-sm transition hover:bg-brand-dark sm:inline-block"
            >
              For Vendors
            </Link>
          )}
        </div>
      </div>
      <div className="flex items-center gap-5 overflow-x-auto border-t border-black/5 px-4 py-1.5 text-[0.72rem] font-semibold tracking-[0.14em] text-ink-soft uppercase md:hidden">
        <Link to="/" className="whitespace-nowrap">
          Home
        </Link>
        <Link to="/deals" className="whitespace-nowrap">
          Deals
        </Link>
        <Link to="/businesses" className="whitespace-nowrap">
          Directory
        </Link>
        <Link to="/categories" className="whitespace-nowrap">
          Categories
        </Link>
        {vendorName ? (
          <Link to="/vendor/dashboard" className="max-w-[11rem] truncate whitespace-nowrap text-brand-dark">
            {vendorName}
          </Link>
        ) : (
          <Link to="/vendor" className="whitespace-nowrap">
            For Vendors
          </Link>
        )}
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="no-print mt-20 border-t border-black/5 bg-white/70">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Wordmark />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-soft">
            Find local businesses, services and vouchers in Lake County, Florida. Vendors keep 100% of
            their voucher revenue — we charge a flat monthly fee, never a commission.
          </p>
          <div className="mt-4 space-y-1.5 text-sm text-ink-soft">
            <a className="flex items-center gap-2 hover:text-brand" href={`mailto:${SITE.email}`}>
              <Icon name="mail" className="h-4 w-4 text-brand" /> {SITE.email}
            </a>
            <a className="flex items-center gap-2 hover:text-brand" href={SITE.phoneHref}>
              <Icon name="phone" className="h-4 w-4 text-brand" /> {SITE.phone}
            </a>
          </div>
        </div>

        <div>
          <h3 className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-ink-soft">
            Categories
          </h3>
          <ul className="mt-3 grid gap-1.5 text-sm text-ink-soft">
            {CATEGORIES.slice(0, 6).map((c) => (
              <li key={c.slug}>
                <Link
                  to="/deals"
                  search={{ category: c.slug }}
                  className="hover:text-brand"
                >
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-ink-soft">
            More categories
          </h3>
          <ul className="mt-3 grid gap-1.5 text-sm text-ink-soft">
            {CATEGORIES.slice(6).map((c) => (
              <li key={c.slug}>
                <Link to="/deals" search={{ category: c.slug }} className="hover:text-brand">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-ink-soft">
            Cities
          </h3>
          <ul className="mt-3 grid grid-cols-2 gap-1.5 text-sm text-ink-soft">
            {CITIES.map((city) => (
              <li key={city.slug}>
                <Link to="/deals" search={{ city: city.slug }} className="hover:text-brand">
                  {city.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="border-t border-black/5 px-4 py-5">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 text-center text-[0.72rem] text-ink-soft sm:flex-row sm:text-left">
          <p>© {new Date().getFullYear()} Shop My Neighborhood · Lake County, Florida</p>
          <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 sm:justify-end">
            <Link to="/terms" className="hover:text-brand">Terms</Link>
            <Link to="/privacy" className="hover:text-brand">Privacy</Link>
            <Link to="/refunds" className="hover:text-brand">Refunds</Link>
          </p>
        </div>
      </div>
    </footer>
  );
}

/** Standard page frame for the marketplace routes. */
export function MarketplaceShell({
  city,
  vendorName,
  children,
}: {
  city?: string;
  /** Business name of the logged-in vendor, shown in the header. */
  vendorName?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-cream">
      <PreviewBanner />
      <TrustBar />
      <SiteHeader city={city} vendorName={vendorName} />
      <main>{children}</main>
      <SiteFooter />
    </div>
  );
}
