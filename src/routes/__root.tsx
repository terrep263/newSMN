import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import { MarketplaceShell } from "~/components/site-chrome";
import { canonicalUrl, isPrivatePath } from "~/lib/seo";
import { fetchSiteOrigin } from "~/server/seo-functions";
import appCss from "~/styles/app.css?url";

export const Route = createRootRoute({
  // The public origin is the same for every page, so fetch it once per session.
  loader: () => fetchSiteOrigin(),
  staleTime: Number.POSITIVE_INFINITY,
  head: ({ loaderData, matches }) => {
    const origin = typeof loaderData === "string" ? loaderData : undefined;
    const pathname = matches[matches.length - 1]?.pathname ?? "/";
    const isPrivate = isPrivatePath(pathname);
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        {
          title: "Shop My Neighborhood | Lake County FL Deals & Local Vouchers",
        },
        {
          name: "description",
          content:
            "Browse local deal vouchers from Lake County, Florida businesses. Vendors keep 100% of voucher revenue — Shop My Neighborhood charges a flat monthly fee, not a commission.",
        },
        { name: "theme-color", content: "#2B4B7C" },
        ...(isPrivate ? [{ name: "robots", content: "noindex, nofollow" }] : []),
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap",
        },
        ...(origin && !isPrivate ? [{ rel: "canonical", href: canonicalUrl(origin, pathname) }] : []),
      ],
    };
  },
  notFoundComponent: NotFound,
  errorComponent: ErrorPage,
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function NotFound() {
  return (
    <MarketplaceShell>
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <p className="kicker">404</p>
        <h1 className="mt-3 font-display text-3xl font-semibold text-brand-dark sm:text-4xl">
          We couldn&apos;t find that page
        </h1>
        <p className="mt-4 text-ink-soft">
          The page you were looking for isn&apos;t here — the link may be old, or the deal may have
          been taken down. Everything currently on the marketplace is listed on the deals page.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            to="/deals"
            className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
          >
            Browse all deals
          </Link>
          <Link
            to="/"
            className="rounded-full border border-brand/30 px-5 py-2.5 text-sm font-semibold text-brand-dark hover:border-brand"
          >
            Back to home
          </Link>
        </div>
      </div>
    </MarketplaceShell>
  );
}

function ErrorPage() {
  return (
    <MarketplaceShell>
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <p className="kicker">Something went wrong</p>
        <h1 className="mt-3 font-display text-3xl font-semibold text-brand-dark">
          That page didn&apos;t load
        </h1>
        <p className="mt-4 text-ink-soft">
          Please try again. If it keeps happening, the deals list is the safest place to start.
        </p>
        <Link
          to="/deals"
          className="mt-8 inline-block rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          Browse all deals
        </Link>
      </div>
    </MarketplaceShell>
  );
}
