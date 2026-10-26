import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { money } from "~/lib/taxonomy";
import type { PurchaseResult } from "~/server/functions";
import { purchaseVoucher } from "~/server/functions";

type Props = {
  slug: string;
  priceCents: number;
  maxQuantity: number;
  /** The business the shopper pays. Sample deals have no real vendor. */
  vendorName: string;
  /** How many vouchers one customer may buy for this deal. */
  perCustomerLimit: number;
  /** False for seeded sample deals: no vendor page exists to pay on. */
  hasPaymentLink: boolean;
};

export function BuyForm({
  slug,
  priceCents,
  maxQuantity,
  vendorName,
  perCustomerLimit,
  hasPaymentLink,
}: Props) {
  const navigate = useNavigate();
  const buy = useServerFn(purchaseVoucher);

  const [open, setOpen] = useState(false);
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [redirecting, setRedirecting] = useState<PurchaseResult | null>(null);

  const ceiling = Math.max(1, Math.min(5, maxQuantity, perCustomerLimit));
  const options = Array.from({ length: ceiling }, (_, i) => i + 1);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});
    try {
      const result = await buy({ data: { slug, buyerName, buyerEmail, quantity } });
      if (result.ok) {
        if (result.paymentUrl) {
          // The vendor takes the money on their own page. Show what is about to
          // happen, then hand the shopper over.
          setRedirecting(result);
          window.location.assign(result.paymentUrl);
          return;
        }
        // Sample deal: nothing to pay, straight to the demo voucher.
        navigate({ to: "/voucher/$code", params: { code: result.code } });
        return;
      }
      if (result.error === "invalid") {
        setFieldErrors(result.fields ?? {});
        setFormError("Please fix the highlighted fields.");
      } else if (result.error === "sold_out") {
        setFormError(result.message ?? "This deal just sold out.");
      } else if (result.error === "customer_limit") {
        setFormError(result.message ?? "This deal has a per-customer limit.");
      } else if (result.error === "pool_exhausted") {
        setFormError(
          "This business has reached its voucher limit for the month, so no more vouchers can be issued right now.",
        );
      } else if (result.error === "unavailable") {
        setFormError("This deal is paused right now and isn't selling vouchers.");
      } else {
        setFormError("We couldn't find that deal. Please go back and pick a deal again.");
      }
    } catch {
      setFormError("Something went wrong starting your voucher. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (redirecting?.ok && redirecting.paymentUrl) {
    return (
      <div className="space-y-3 rounded-2xl border border-brand/30 bg-brand/5 p-4 text-center">
        <p className="font-display text-lg font-semibold text-brand-dark">
          Taking you to {vendorName} to pay…
        </p>
        <p className="text-[0.78rem] leading-snug text-ink-soft">
          Payment happens on {vendorName}&apos;s own payment page. Your voucher code{" "}
          <span className="font-mono font-semibold text-ink">{redirecting.code}</span> is already
          reserved — you&apos;ll see it as “awaiting confirmation” until they confirm the money
          arrived.
        </p>
        <a
          href={redirecting.paymentUrl}
          className="inline-block rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          Continue to the payment page
        </a>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full rounded-full bg-brand px-5 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-brand-dark focus:ring-2 focus:ring-brand/40 focus:ring-offset-2 focus:outline-none"
        >
          Buy voucher — {money(priceCents)}
        </button>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full rounded-full border border-brand/30 px-5 py-2.5 text-sm font-semibold text-brand-dark transition hover:border-brand"
        >
          Get it as a gift
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <div className="rounded-xl border border-brand/25 bg-brand/5 px-3 py-2 text-[0.72rem] leading-snug text-brand-dark">
        {hasPaymentLink ? (
          <>
            <span className="font-bold">You pay {vendorName} directly.</span> Next step is their own
            payment page — Shop My Neighborhood never takes, holds or refunds your money.
          </>
        ) : (
          <>
            <span className="font-bold">Sample deal — demo checkout.</span> This vendor is
            illustrative, so no payment is involved. You&apos;ll get a real voucher code for testing.
          </>
        )}
      </div>

      <div>
        <label htmlFor="buyer-name" className="block text-[0.72rem] font-semibold text-ink">
          Your name
        </label>
        <input
          id="buyer-name"
          name="buyerName"
          autoComplete="name"
          value={buyerName}
          onChange={(e) => setBuyerName(e.target.value)}
          className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/25 focus:outline-none"
          placeholder="Jordan Alvarez"
          aria-invalid={Boolean(fieldErrors.buyerName)}
        />
        {fieldErrors.buyerName && (
          <p className="mt-1 text-[0.72rem] font-medium text-red-600">{fieldErrors.buyerName}</p>
        )}
      </div>

      <div>
        <label htmlFor="buyer-email" className="block text-[0.72rem] font-semibold text-ink">
          Email
        </label>
        <input
          id="buyer-email"
          name="buyerEmail"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={buyerEmail}
          onChange={(e) => setBuyerEmail(e.target.value)}
          className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/25 focus:outline-none"
          placeholder="you@example.com"
          aria-invalid={Boolean(fieldErrors.buyerEmail)}
        />
        {fieldErrors.buyerEmail && (
          <p className="mt-1 text-[0.72rem] font-medium text-red-600">{fieldErrors.buyerEmail}</p>
        )}
        <p className="mt-1 text-[0.68rem] text-ink-soft">
          We use this to look up your voucher and enforce the {perCustomerLimit}-per-customer limit.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="quantity" className="block text-[0.72rem] font-semibold text-ink">
            Quantity
          </label>
          <select
            id="quantity"
            name="quantity"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            className="mt-1 w-full appearance-none rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/25 focus:outline-none"
          >
            {options.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="block text-[0.72rem] font-semibold text-ink">Total</span>
          <p className="mt-1 rounded-xl bg-cream-deep px-3 py-2.5 text-sm font-bold text-brand-dark">
            {money(priceCents * quantity)}
          </p>
        </div>
      </div>
      {fieldErrors.quantity && (
        <p className="text-[0.72rem] font-medium text-red-600">{fieldErrors.quantity}</p>
      )}

      {formError && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[0.75rem] font-medium text-red-700"
        >
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-full bg-brand px-5 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting
          ? "Reserving your code…"
          : hasPaymentLink
            ? `Continue to payment — ${money(priceCents * quantity)}`
            : `Complete demo order — ${money(priceCents * quantity)}`}
      </button>
      <p className="text-center text-[0.68rem] leading-snug text-ink-soft">
        {hasPaymentLink
          ? `Your voucher is reserved now and becomes valid once ${vendorName} confirms the payment.`
          : "No card details are collected on this page."}
      </p>
    </form>
  );
}
