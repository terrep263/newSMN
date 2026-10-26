import { Link, createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { VendorDealForm } from "~/components/vendor-deal-form";
import { VendorShell } from "~/components/vendor-chrome";
import { fetchDealForm } from "~/server/vendor-functions";

export const Route = createFileRoute("/vendor/deals/$id/edit")({
  head: () => ({
    meta: [{ title: "Edit deal | Shop My Neighborhood" }],
  }),
  loader: async ({ params }) => {
    const id = Number(params.id);
    const data = await fetchDealForm({ data: { id } });
    if (!data) throw redirect({ to: "/vendor/login" });
    if (!data.deal) throw notFound();
    return data;
  },
  component: EditDealPage,
});

function EditDealPage() {
  const { me, deal, voucherSold, tierName, voucherLimitCeiling } = Route.useLoaderData();
  if (!deal) return null;

  return (
    <VendorShell vendorName={me.businessName} tierLabel={tierName} active="deals">
      <div className="mx-auto max-w-3xl px-4 pt-6">
        <nav className="text-[0.72rem] text-ink-soft">
          <Link to="/vendor/deals" className="hover:text-brand">
            My deals
          </Link>
          <span className="mx-1.5">/</span>
          <Link to="/vendor/deals/$id" params={{ id: String(deal.id) }} className="hover:text-brand">
            Sales
          </Link>
          <span className="mx-1.5">/</span>
          <span className="text-ink">Edit</span>
        </nav>
        <h1 className="mt-3 font-display text-2xl font-semibold text-brand-dark sm:text-3xl">
          Edit deal
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          Changes appear on the public deal page immediately. Vouchers already sold keep their
          original price and terms.
        </p>

        <div className="mt-5 rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
          <VendorDealForm
            deal={deal}
            voucherSold={voucherSold}
            tierName={tierName}
            voucherLimitCeiling={voucherLimitCeiling}
          />
        </div>
      </div>
    </VendorShell>
  );
}
