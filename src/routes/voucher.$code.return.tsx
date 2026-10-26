import { Link, createFileRoute } from "@tanstack/react-router";

import { Icon } from "~/components/icons";
import { MarketplaceShell } from "~/components/site-chrome";
import { VoucherView } from "~/components/voucher-view";
import { SITE } from "~/lib/taxonomy";
import { fetchVoucher } from "~/server/functions";

/**
 * Where the vendor's payment page sends the shopper back to.
 *
 * We deliberately do NOT treat arriving here as proof of payment: the voucher is
 * shown with its code and an "awaiting confirmation from the vendor" state until
 * the vendor's webhook (or the vendor by hand) confirms the money arrived.
 */
export const Route = createFileRoute("/voucher/$code/return")({
  loader: ({ params }) => fetchVoucher({ data: { code: params.code } }),
  head: ({ params }) => ({
    meta: [
      { title: `Voucher ${params.code} | ${SITE.name}` },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VoucherReturnPage,
});

function VoucherReturnPage() {
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
            That return link isn&apos;t valid
          </h1>
          <p className="mt-3 text-sm text-ink-soft">
            We have no voucher with the code{" "}
            <span className="rounded bg-cream-deep px-1.5 py-0.5 font-mono text-[0.8rem] text-ink">
              {params.code}
            </span>
            . If you just paid, check the code in your confirmation email, or contact the business
            you bought from.
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

  return <VoucherView data={data} returning />;
}
