import { createFileRoute } from "@tanstack/react-router";

import { LegalList, LegalPage, LegalSection } from "~/components/legal-page";
import { SITE } from "~/lib/taxonomy";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy | Shop My Neighborhood" },
      {
        name: "description",
        content:
          "What Shop My Neighborhood collects from shoppers and vendors, how it is used, and who it is shared with.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={`This page explains what ${SITE.name} collects, why, and who else sees it.`}
    >
      <LegalSection heading="What we collect">
        <p>
          <span className="font-semibold text-ink">Shoppers.</span> When you buy a voucher we store
          your name, your email address, the quantity, the amount, and the voucher code and its
          status (issued, redeemed, refunded or expired).
        </p>
        <p>
          <span className="font-semibold text-ink">Vendors.</span> When you sign up we store your
          business name, city, category, email address, optional phone and website, and your plan.
          Your password is stored only as a hash, never in readable form. If you claim a directory
          listing we also store the claim and any note you add as proof.
        </p>
        <p>
          <span className="font-semibold text-ink">Directory listings.</span> Business names,
          addresses, phone numbers and websites in the directory come from OpenStreetMap, not from
          visitors.
        </p>
      </LegalSection>

      <LegalSection heading="Cookies">
        <p>
          Vendors who sign in get one session cookie so the site knows who they are. It lasts up to
          30 days or until they sign out. Shoppers do not need an account and are not given a
          sign-in cookie.
        </p>
      </LegalSection>

      <LegalSection heading="Who else sees your information">
        <LegalList
          items={[
            "The vendor whose voucher you buy sees your name, email, quantity and voucher code, so they can redeem it. A vendor may also set a webhook that receives those purchase details.",
            "Stripe handles vendor subscription billing. We do not store vendor card numbers.",
            "Voucher payments happen on the vendor's own payment page, under that vendor's and their payment provider's privacy practices.",
          ]}
        />
        <p>We do not sell your information.</p>
      </LegalSection>

      <LegalSection heading="Questions or removal requests">
        <p>
          Email{" "}
          <a className="text-brand underline" href={`mailto:${SITE.email}`}>
            {SITE.email}
          </a>{" "}
          or call{" "}
          <a className="text-brand underline" href={SITE.phoneHref}>
            {SITE.phone}
          </a>
          . To correct or remove a directory listing, claim it as the owner or contact us.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
