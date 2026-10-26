import { Link, createFileRoute, redirect } from "@tanstack/react-router";

import { VendorDealForm } from "~/components/vendor-deal-form";
import { VendorShell } from "~/components/vendor-chrome";
import { fetchDealForm } from "~/server/vendor-functions";

export const Route = createFileRoute("/vendor/deals/new")({
  head: () => ({
    meta: [{ title: "Create a deal | Shop My Neighborhood" }],
  }),
  loader: async () => {
    const data = await fetchDealForm({ data: {} });
    if (!data) throw redirect({ to: "/vendor/login" });
    if (data.voucherLimitCeiling === 0) throw redirect({ to: "/vendor/deals" });
    return data;
  },
  component: NewDealPage,
});

function NewDealPage() {
  const { me, tierName, voucherLimitCeiling } = Route.useLoaderData();

  return (
    <VendorShell vendorName={me.businessName} tierLabel={tierName} active="deals">
      <div className="mx-auto max-w-3xl px-4 pt-6">
        <nav className="text-[0.72rem] text-ink-soft">
          <Link to="/vendor/deals" className="hover:text-brand">
            My deals
          </Link>
          <span className="mx-1.5">/</span>
          <span className="text-ink">New deal</span>
        </nav>
        <h1 className="mt-3 font-display text-2xl font-semibold text-brand-dark sm:text-3xl">
          Create a voucher deal
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-soft">
          Your deal goes live in the marketplace as soon as you publish it, with no &quot;sample&quot;
          badge — shoppers see your business name, city and category. You can pause it at any time.
        </p>
        <p className="mt-2 text-[0.75rem] text-ink-soft">
          Publishing on the {tierName} plan. Limits are enforced on the server.
        </p>

        <div className="mt-5 rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
          <VendorDealForm
            deal={null}
            voucherSold={0}
            tierName={tierName}
            voucherLimitCeiling={voucherLimitCeiling}
          />
        </div>
      </div>
    </VendorShell>
  );
}
