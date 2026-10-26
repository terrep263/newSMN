import { Link, createFileRoute } from "@tanstack/react-router";

import { Icon } from "~/components/icons";
import { MarketplaceShell } from "~/components/site-chrome";
import { VoucherView } from "~/components/voucher-view";
import { SITE } from "~/lib/taxonomy";
import { fetchVoucher } from "~/server/functions";

export const Route = createFileRoute("/voucher/$code")({
  loader: ({ params }) => fetchVoucher({ data: { code: params.code } }),
  head: ({ loaderData, params }) => ({
    meta: [
      {
        title: loaderData
          ? `Voucher ${loaderData.voucher.code} | ${SITE.name}`
          : `Voucher not found | ${SITE.name}`,
      },
      {
        name: "description",
        content: loaderData
          ? `Voucher ${params.code} for ${loaderData.deal.title} at ${loaderData.deal.vendor_name} in ${loaderData.deal.vendor_city}, Lake County FL.`
          : "We couldn't find a voucher with that code.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VoucherPage,
});

function VoucherPage() {
  const data = Route.useLoaderData();
  const params = Route.useParams();

  if (!data) {
    return (
      <MarketplaceShell>
        <div className="mx-auto max-w-xl px-4 py-20 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-cream-deep text-brand">
            <Icon name="ticket" className="h-7 w-7" />
          </span>
          <h1 className="mt-4 font-display text-3xl font-semibold text-brand-dark">
            We couldn&apos;t find that voucher
          </h1>
          <p className="mt-3 text-sm text-ink-soft">
            No voucher matches the code{" "}
            <span className="rounded bg-cream-deep px-1.5 py-0.5 font-mono text-[0.8rem] text-ink">
              {params.code}
            </span>
            . Codes look like <span className="font-mono text-[0.8rem]">SMN-XXXX-XXXX</span> — check
            for a typo, or browse the deals to buy a new one.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-2">
            <Link
              to="/deals"
              className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
            >
              Browse deals
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

  return <VoucherView data={data} />;
}
