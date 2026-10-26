import { createFileRoute } from "@tanstack/react-router";

import { LegalList, LegalPage, LegalSection } from "~/components/legal-page";
import { VOUCHER_TERMS, SHOPPER_PAYMENT_NOTICE } from "~/lib/deal-rules";
import { PAID_TIERS, limitLabel } from "~/lib/tiers";
import { SITE } from "~/lib/taxonomy";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Use | Shop My Neighborhood" },
      {
        name: "description",
        content:
          "The terms for using Shop My Neighborhood: the Lake County directory, voucher deals, and vendor subscriptions.",
      },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalPage
      title="Terms of Use"
      intro={`These terms cover your use of ${SITE.name}, a local directory and voucher marketplace for ${SITE.county}. By using the site, buying a voucher, or signing up as a vendor, you agree to them.`}
    >
      <LegalSection heading="What the site is">
        <p>
          {SITE.name} has two parts: a free directory of Lake County businesses, and a marketplace
          where vendors publish voucher deals that shoppers can buy.
        </p>
        <p>
          Directory listings are sourced from OpenStreetMap and may be incomplete or out of date.
          A vendor can claim a listing and edit it once their claim is approved.
        </p>
      </LegalSection>

      <LegalSection heading="Who is paid for vouchers">
        <p>{SHOPPER_PAYMENT_NOTICE}</p>
        <p>
          The voucher is a promise from the vendor, not from {SITE.name}. The vendor sets the
          price, the value, the redemption dates and any blackout dates shown on the deal.
        </p>
      </LegalSection>

      <LegalSection heading="Voucher terms (accepted by every vendor)">
        <p>
          A vendor must accept these terms before a voucher deal can be published. They apply to
          every voucher sold on the site.
        </p>
        <LegalList items={VOUCHER_TERMS} />
      </LegalSection>

      <LegalSection heading="Shoppers">
        <LegalList
          items={[
            "To buy a voucher you give a name and an email address. The voucher code is tied to them.",
            "A voucher is redeemed once, by the business that issued it.",
            "Deal descriptions, photos and dates are provided by vendors. Check the deal page before you buy.",
            "Refunds follow the Refunds page.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="Vendor accounts and plans">
        <p>
          Vendors pay a flat monthly fee. {SITE.name} does not take a commission on voucher sales.
          A free listing has no monthly fee and does not include voucher deals.
        </p>
        <LegalList
          items={PAID_TIERS.map(
            (t) =>
              `${t.name} — ${t.priceLabel}/month: ${limitLabel(t.maxActiveDeals)} active deals, ${limitLabel(t.monthlyVoucherPool)} vouchers per month.`,
          )}
        />
        <p>
          Subscription billing is handled by Stripe. A vendor can manage or cancel their
          subscription from the billing portal in their vendor dashboard.
        </p>
        <p>
          Vendors are responsible for the accuracy of their listings and deals, and for honouring
          every voucher they sell. Claims on directory listings are reviewed, and a listing that is
          already claimed cannot be claimed by a second vendor.
        </p>
      </LegalSection>

      <LegalSection heading="Using the site">
        <LegalList
          items={[
            "Do not misuse the site, attempt to access another vendor's account or listing, or submit false claims or deals.",
            "We may remove a listing, deal or account that breaks these terms.",
            "The site is provided as is. We may change or pause features at any time.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="Contact">
        <p>
          Questions about these terms: <a className="text-brand underline" href={`mailto:${SITE.email}`}>{SITE.email}</a>{" "}
          or <a className="text-brand underline" href={SITE.phoneHref}>{SITE.phone}</a>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
