import { createFileRoute } from "@tanstack/react-router";

import { LegalList, LegalPage, LegalSection } from "~/components/legal-page";
import { SHOPPER_PAYMENT_NOTICE } from "~/lib/deal-rules";
import { SITE } from "~/lib/taxonomy";

export const Route = createFileRoute("/refunds")({
  head: () => ({
    meta: [
      { title: "Refund Policy | Shop My Neighborhood" },
      {
        name: "description",
        content:
          "Voucher refunds are available within 24 hours of purchase while the voucher is unused. Refunds are paid by the vendor.",
      },
    ],
  }),
  component: RefundsPage,
});

function RefundsPage() {
  return (
    <LegalPage
      title="Refund Policy"
      intro="Voucher money goes to the vendor, so voucher refunds come from the vendor. Here is exactly how that works."
    >
      <LegalSection heading="Voucher refunds">
        <p>{SHOPPER_PAYMENT_NOTICE}</p>
        <LegalList
          items={[
            "A voucher can be refunded within 24 hours of purchase.",
            "Only while the voucher has not been redeemed.",
            "The vendor returns the money through their own payment provider.",
          ]}
        />
        <p>
          To ask for a refund, contact the vendor named on the deal page. If you cannot reach them,
          email{" "}
          <a className="text-brand underline" href={`mailto:${SITE.email}`}>
            {SITE.email}
          </a>{" "}
          and we will pass your request on.
        </p>
      </LegalSection>

      <LegalSection heading="After the 24-hour window">
        <p>
          The paid value of a voucher never expires. The promotional discount expires at the
          redemption end date the vendor set on the deal.
        </p>
      </LegalSection>

      <LegalSection heading="Vendor subscription fees">
        <p>
          Vendor plans are billed monthly through Stripe. Vendors manage or cancel their
          subscription in the billing portal in their dashboard. For a question about a charge,
          email{" "}
          <a className="text-brand underline" href={`mailto:${SITE.email}`}>
            {SITE.email}
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
