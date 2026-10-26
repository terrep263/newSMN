import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";

import {
  DEFAULT_MIN_DISCOUNT_PCT,
  MIN_FINE_PRINT_CHARS,
  VOUCHER_TERMS,
  WEEKDAYS,
  discountPct,
  money,
  validateDealRules,
} from "~/lib/deal-rules";
import { CATEGORIES, CITIES } from "~/lib/taxonomy";
import type { VendorDeal } from "~/server/vendor-functions";
import { saveVendorDeal } from "~/server/vendor-functions";

const inputClass =
  "mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/25 focus:outline-none";
const labelClass = "block text-[0.72rem] font-semibold text-ink";
const errorClass = "mt-1 text-[0.72rem] font-medium text-red-600";
const hintClass = "mt-1 text-[0.7rem] leading-snug text-ink-soft";

function dollars(cents: number | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

function dateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function centsFromInput(raw: string): number {
  const text = raw.replace(/[$,\s]/g, "");
  if (!text) return Number.NaN;
  const n = Number(text);
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN;
}

export function VendorDealForm({
  deal,
  voucherSold,
  tierName,
  voucherLimitCeiling,
}: {
  deal: VendorDeal | null;
  voucherSold: number;
  tierName: string;
  voucherLimitCeiling: number | null;
}) {
  const router = useRouter();
  const save = useServerFn(saveVendorDeal);

  const [form, setForm] = useState({
    title: deal?.title ?? "",
    description: deal?.description ?? "",
    highlights: (deal?.highlights ?? []).join("\n"),
    finePrint: deal?.fine_print ?? "",
    price: dollars(deal?.price_cents),
    value: dollars(deal?.value_cents),
    voucherLimit: deal ? String(deal.voucher_limit) : "50",
    perCustomerLimit: String(deal?.per_customer_limit ?? 1),
    categorySlug: deal?.category_slug ?? "",
    citySlug: deal?.city_slug ?? "",
    startsAt: dateInput(deal?.starts_at),
    endsAt: dateInput(deal?.ends_at),
    redemptionStart: dateInput(deal?.redemption_start),
    redemptionEnd: dateInput(deal?.redemption_end),
    blackoutDates: (deal?.blackout_dates ?? []).join(", "),
    redemptionInstructions: deal?.redemption_instructions ?? "",
    paymentLinkUrl: deal?.payment_link_url ?? "",
    webhookUrl: deal?.webhook_url ?? "",
  });
  const [validDays, setValidDays] = useState<string[]>(deal?.valid_days ?? []);
  const [acceptTerms, setAcceptTerms] = useState<boolean>(Boolean(deal?.terms_accepted_at));
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleDay(key: string) {
    setValidDays((days) => (days.includes(key) ? days.filter((d) => d !== key) : [...days, key]));
  }

  // Live preview: what the customer pays, gets, and saves.
  const preview = useMemo(() => {
    const priceCents = centsFromInput(form.price);
    const valueCents = centsFromInput(form.value);
    const pct = discountPct(priceCents, valueCents);
    const okay =
      Number.isFinite(priceCents) &&
      Number.isFinite(valueCents) &&
      priceCents > 0 &&
      valueCents > priceCents &&
      pct >= DEFAULT_MIN_DISCOUNT_PCT;
    return {
      priceCents,
      valueCents,
      pct,
      saving: Number.isFinite(valueCents - priceCents) ? valueCents - priceCents : 0,
      okay,
    };
  }, [form.price, form.value]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);

    // Check the rules in the browser first so the vendor gets instant inline
    // errors; the server runs the identical checks and is still the authority.
    const local = validateDealRules({
      priceCents: centsFromInput(form.price),
      valueCents: centsFromInput(form.value),
      minDiscountPct: DEFAULT_MIN_DISCOUNT_PCT,
      voucherLimit: Number(form.voucherLimit),
      perCustomerLimit: Number(form.perCustomerLimit),
      finePrint: form.finePrint,
      redemptionInstructions: form.redemptionInstructions,
      redemptionStart: form.redemptionStart ? `${form.redemptionStart}T12:00:00.000Z` : null,
      redemptionEnd: form.redemptionEnd ? `${form.redemptionEnd}T12:00:00.000Z` : null,
      validDays,
      blackoutDates: form.blackoutDates
        .split(/[\n,;]+/)
        .map((d) => d.trim())
        .filter(Boolean),
      paymentLinkUrl: form.paymentLinkUrl,
      webhookUrl: form.webhookUrl,
    });
    if (Object.keys(local).length > 0) {
      setFields(local);
      setMessage("Please fix the highlighted fields.");
      return;
    }

    setBusy(true);
    setFields({});
    try {
      const result = await save({
        data: {
          ...form,
          validDays,
          acceptTerms,
          id: deal?.id,
        },
      });
      if (result.ok) {
        await router.invalidate();
        await router.navigate({ to: "/vendor/deals/$id", params: { id: String(result.id) } });
        return;
      }
      if ("fields" in result && result.fields) setFields(result.fields);
      setMessage(
        result.error === "invalid"
          ? "Please fix the highlighted fields."
          : result.error === "unauthenticated"
            ? "Your session expired — please log in again."
            : result.error,
      );
    } catch {
      setMessage("Something went wrong saving the deal. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const finePrintLength = form.finePrint.trim().length;

  return (
    <form onSubmit={onSubmit} className="grid gap-5" noValidate>
      {/* ---------------------------------------------------------- basics */}
      <div>
        <label htmlFor="title" className={labelClass}>
          Deal title
        </label>
        <input
          id="title"
          className={inputClass}
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="$25 for $50 of dinner for two"
          aria-invalid={Boolean(fields.title)}
        />
        {fields.title && <p className={errorClass}>{fields.title}</p>}
      </div>

      <div>
        <label htmlFor="description" className={labelClass}>
          Description
        </label>
        <textarea
          id="description"
          rows={4}
          className={inputClass}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="What the customer gets, what's included, any conditions they should know before buying."
          aria-invalid={Boolean(fields.description)}
        />
        {fields.description && <p className={errorClass}>{fields.description}</p>}
      </div>

      <div>
        <label htmlFor="highlights" className={labelClass}>
          Highlights <span className="font-normal text-ink-soft">(one per line, up to 10)</span>
        </label>
        <textarea
          id="highlights"
          rows={3}
          className={inputClass}
          value={form.highlights}
          onChange={(e) => set("highlights", e.target.value)}
          placeholder={"One line per highlight\nShown as a checklist on the deal page"}
          aria-invalid={Boolean(fields.highlights)}
        />
        {fields.highlights && <p className={errorClass}>{fields.highlights}</p>}
      </div>

      {/* --------------------------------------------------- price + value */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="price" className={labelClass}>
            Voucher price ($)
          </label>
          <input
            id="price"
            type="text"
            inputMode="decimal"
            className={inputClass}
            value={form.price}
            onChange={(e) => set("price", e.target.value)}
            placeholder="25.00"
            aria-invalid={Boolean(fields.price)}
          />
          {fields.price && <p className={errorClass}>{fields.price}</p>}
        </div>
        <div>
          <label htmlFor="value" className={labelClass}>
            Voucher value ($)
          </label>
          <input
            id="value"
            type="text"
            inputMode="decimal"
            className={inputClass}
            value={form.value}
            onChange={(e) => set("value", e.target.value)}
            placeholder="50.00"
            aria-invalid={Boolean(fields.value)}
          />
          {fields.value && <p className={errorClass}>{fields.value}</p>}
        </div>
        <div>
          <label htmlFor="voucherLimit" className={labelClass}>
            Voucher limit
          </label>
          <input
            id="voucherLimit"
            type="number"
            min={1}
            max={voucherLimitCeiling ?? undefined}
            className={inputClass}
            value={form.voucherLimit}
            onChange={(e) => set("voucherLimit", e.target.value)}
            aria-invalid={Boolean(fields.voucherLimit)}
          />
          {fields.voucherLimit && <p className={errorClass}>{fields.voucherLimit}</p>}
        </div>
      </div>

      {/* live preview */}
      <div
        className={`rounded-2xl border px-4 py-3 text-sm ${
          preview.okay
            ? "border-brand-green/40 bg-brand-green/10"
            : "border-amber-300 bg-amber-50"
        }`}
      >
        <p className="text-[0.68rem] font-semibold tracking-[0.14em] uppercase text-ink-soft">
          What the customer sees
        </p>
        {Number.isFinite(preview.priceCents) && Number.isFinite(preview.valueCents) ? (
          <p className="mt-1 font-display text-lg font-semibold text-brand-dark">
            Pays {money(preview.priceCents)}, gets {money(preview.valueCents)} of value, saves{" "}
            {preview.pct.toFixed(0)}%
          </p>
        ) : (
          <p className="mt-1 text-[0.85rem] text-ink-soft">
            Enter a price and a value to see the customer&apos;s view.
          </p>
        )}
        {Number.isFinite(preview.priceCents) && Number.isFinite(preview.valueCents) && (
          <p className={`mt-1 text-[0.75rem] ${preview.okay ? "text-brand-green-dark" : "text-amber-900"}`}>
            {preview.okay
              ? `Saves ${money(preview.saving)} — meets the ${DEFAULT_MIN_DISCOUNT_PCT}% minimum discount.`
              : `A deal needs at least ${DEFAULT_MIN_DISCOUNT_PCT}% off. Lower the price or raise the stated value.`}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="perCustomerLimit" className={labelClass}>
            Limit per customer
          </label>
          <select
            id="perCustomerLimit"
            className={inputClass}
            value={form.perCustomerLimit}
            onChange={(e) => set("perCustomerLimit", e.target.value)}
            aria-invalid={Boolean(fields.perCustomerLimit)}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} voucher{n === 1 ? "" : "s"} per customer
              </option>
            ))}
          </select>
          {fields.perCustomerLimit && <p className={errorClass}>{fields.perCustomerLimit}</p>}
        </div>
        <div>
          <label htmlFor="categorySlug" className={labelClass}>
            Category
          </label>
          <select
            id="categorySlug"
            className={inputClass}
            value={form.categorySlug}
            onChange={(e) => set("categorySlug", e.target.value)}
            aria-invalid={Boolean(fields.category)}
          >
            <option value="">Choose a category…</option>
            {CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
          {fields.category && <p className={errorClass}>{fields.category}</p>}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="citySlug" className={labelClass}>
            City
          </label>
          <select
            id="citySlug"
            className={inputClass}
            value={form.citySlug}
            onChange={(e) => set("citySlug", e.target.value)}
            aria-invalid={Boolean(fields.city)}
          >
            <option value="">Choose a city…</option>
            {CITIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
          {fields.city && <p className={errorClass}>{fields.city}</p>}
        </div>
        <div>
          <label htmlFor="startsAt" className={labelClass}>
            Deal starts <span className="font-normal text-ink-soft">(optional)</span>
          </label>
          <input
            id="startsAt"
            type="date"
            className={inputClass}
            value={form.startsAt}
            onChange={(e) => set("startsAt", e.target.value)}
            aria-invalid={Boolean(fields.startsAt)}
          />
          {fields.startsAt && <p className={errorClass}>{fields.startsAt}</p>}
        </div>
        <div>
          <label htmlFor="endsAt" className={labelClass}>
            Deal ends <span className="font-normal text-ink-soft">(optional)</span>
          </label>
          <input
            id="endsAt"
            type="date"
            className={inputClass}
            value={form.endsAt}
            onChange={(e) => set("endsAt", e.target.value)}
            aria-invalid={Boolean(fields.endsAt)}
          />
          {fields.endsAt && <p className={errorClass}>{fields.endsAt}</p>}
        </div>
      </div>

      {/* ------------------------------------------------ redemption rules */}
      <fieldset className="rounded-2xl border border-black/10 bg-white/60 p-4">
        <legend className="px-1 text-[0.7rem] font-bold tracking-[0.14em] uppercase text-brand-dark">
          Redemption rules
        </legend>

        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="redemptionStart" className={labelClass}>
              Vouchers can be used from
            </label>
            <input
              id="redemptionStart"
              type="date"
              className={inputClass}
              value={form.redemptionStart}
              onChange={(e) => set("redemptionStart", e.target.value)}
              aria-invalid={Boolean(fields.redemptionStart)}
            />
            {fields.redemptionStart && <p className={errorClass}>{fields.redemptionStart}</p>}
          </div>
          <div>
            <label htmlFor="redemptionEnd" className={labelClass}>
              Last day to use the promotional value
            </label>
            <input
              id="redemptionEnd"
              type="date"
              className={inputClass}
              value={form.redemptionEnd}
              onChange={(e) => set("redemptionEnd", e.target.value)}
              aria-invalid={Boolean(fields.redemptionEnd)}
            />
            {fields.redemptionEnd ? (
              <p className={errorClass}>{fields.redemptionEnd}</p>
            ) : (
              <p className={hintClass}>
                Must be at least 14 days long. After this date the promo value lapses — the paid
                value never expires.
              </p>
            )}
          </div>
        </div>

        <div className="mt-4">
          <span className={labelClass}>Days vouchers can be used</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {WEEKDAYS.map((day) => {
              const on = validDays.includes(day.key);
              return (
                <button
                  key={day.key}
                  type="button"
                  onClick={() => toggleDay(day.key)}
                  aria-pressed={on}
                  className={`rounded-full px-3 py-1.5 text-[0.75rem] font-semibold transition ${
                    on
                      ? "bg-brand text-white"
                      : "border border-black/15 bg-white text-ink-soft hover:border-brand/50"
                  }`}
                >
                  {day.short}
                </button>
              );
            })}
          </div>
          <p className={hintClass}>Leave all seven unselected to allow any day.</p>
          {fields.validDays && <p className={errorClass}>{fields.validDays}</p>}
        </div>

        <div className="mt-4">
          <label htmlFor="blackoutDates" className={labelClass}>
            Blackout dates <span className="font-normal text-ink-soft">(optional)</span>
          </label>
          <textarea
            id="blackoutDates"
            rows={2}
            className={inputClass}
            value={form.blackoutDates}
            onChange={(e) => set("blackoutDates", e.target.value)}
            placeholder="2026-12-25, 2027-01-01"
            aria-invalid={Boolean(fields.blackoutDates)}
          />
          {fields.blackoutDates ? (
            <p className={errorClass}>{fields.blackoutDates}</p>
          ) : (
            <p className={hintClass}>YYYY-MM-DD, separated by commas. Must fall inside the window.</p>
          )}
        </div>

        <div className="mt-4">
          <label htmlFor="redemptionInstructions" className={labelClass}>
            How the customer redeems
          </label>
          <textarea
            id="redemptionInstructions"
            rows={2}
            className={inputClass}
            value={form.redemptionInstructions}
            onChange={(e) => set("redemptionInstructions", e.target.value)}
            placeholder="Show the code at the counter. Mention it when you book so we hold a table."
            aria-invalid={Boolean(fields.redemptionInstructions)}
          />
          {fields.redemptionInstructions && (
            <p className={errorClass}>{fields.redemptionInstructions}</p>
          )}
        </div>
      </fieldset>

      {/* ------------------------------------------------------ fine print */}
      <div>
        <label htmlFor="finePrint" className={labelClass}>
          Fine print{" "}
          <span
            className={`font-normal ${finePrintLength < MIN_FINE_PRINT_CHARS ? "text-amber-700" : "text-ink-soft"}`}
          >
            ({finePrintLength}/{MIN_FINE_PRINT_CHARS} characters minimum)
          </span>
        </label>
        <textarea
          id="finePrint"
          rows={3}
          className={inputClass}
          value={form.finePrint}
          onChange={(e) => set("finePrint", e.target.value)}
          placeholder="One voucher per table, dine-in only. Paid value never expires; the promotional value expires on the redemption end date. Refundable within 24 hours while unused."
          aria-invalid={Boolean(fields.finePrint)}
        />
        {fields.finePrint && <p className={errorClass}>{fields.finePrint}</p>}
      </div>

      {/* ------------------------------------------- payment + webhook */}
      <fieldset className="rounded-2xl border border-brand/25 bg-brand/5 p-4">
        <legend className="px-1 text-[0.7rem] font-bold tracking-[0.14em] uppercase text-brand-dark">
          How you get paid
        </legend>
        <p className="mt-1 text-[0.75rem] leading-snug text-ink-soft">
          Customers pay you on your own payment page — Shop My Neighborhood never takes or holds
          voucher money. Paste the link below and we send every buyer to it.
        </p>
        <div className="mt-3">
          <label htmlFor="paymentLinkUrl" className={labelClass}>
            Your payment link (https)
          </label>
          <input
            id="paymentLinkUrl"
            type="url"
            inputMode="url"
            className={inputClass}
            value={form.paymentLinkUrl}
            onChange={(e) => set("paymentLinkUrl", e.target.value)}
            placeholder="https://buy.stripe.com/yourlink"
            aria-invalid={Boolean(fields.paymentLinkUrl)}
          />
          {fields.paymentLinkUrl ? (
            <p className={errorClass}>{fields.paymentLinkUrl}</p>
          ) : (
            <p className={hintClass}>
              Stripe Payment Link, Square, PayPal or any https checkout page. Required to publish.
            </p>
          )}
        </div>
        <div className="mt-3">
          <label htmlFor="webhookUrl" className={labelClass}>
            Webhook URL <span className="font-normal text-ink-soft">(optional)</span>
          </label>
          <input
            id="webhookUrl"
            type="url"
            inputMode="url"
            className={inputClass}
            value={form.webhookUrl}
            onChange={(e) => set("webhookUrl", e.target.value)}
            placeholder="https://your-site.com/api/smn-webhook"
            aria-invalid={Boolean(fields.webhookUrl)}
          />
          {fields.webhookUrl ? (
            <p className={errorClass}>{fields.webhookUrl}</p>
          ) : (
            <p className={hintClass}>
              We POST voucher events here, signed with your deal&apos;s webhook secret. Without it you
              confirm payments by hand on the deal page.
            </p>
          )}
        </div>
      </fieldset>

      {/* ---------------------------------------------------------- terms */}
      <div className="rounded-2xl border border-black/10 bg-cream-deep/40 p-4">
        <p className="text-[0.7rem] font-bold tracking-[0.14em] uppercase text-brand-dark">
          Voucher terms
        </p>
        <ul className="mt-2 space-y-1.5 text-[0.78rem] leading-snug text-ink-soft">
          {VOUCHER_TERMS.map((term) => (
            <li key={term} className="flex gap-2">
              <span className="text-brand-green-dark">•</span>
              <span>{term}</span>
            </li>
          ))}
        </ul>
        <label className="mt-3 flex items-start gap-2 text-[0.8rem] font-medium text-ink">
          <input
            type="checkbox"
            checked={acceptTerms}
            onChange={(e) => setAcceptTerms(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-black/30 text-brand focus:ring-brand/40"
          />
          <span>I accept these voucher terms and will honour them.</span>
        </label>
        {fields.terms && <p className={errorClass}>{fields.terms}</p>}
        {!acceptTerms && (
          <p className={hintClass}>
            You can save without accepting — the deal stays a paused draft until you do.
          </p>
        )}
      </div>

      <p className="text-[0.72rem] text-ink-soft">
        {tierName} plan limits apply.{" "}
        {voucherLimitCeiling !== null
          ? `A single deal can offer up to ${voucherLimitCeiling.toLocaleString("en-US")} vouchers.`
          : "Your plan has no per-deal voucher cap."}
        {deal && voucherSold > 0
          ? ` ${voucherSold.toLocaleString("en-US")} voucher${voucherSold === 1 ? " has" : "s have"} already been sold, so the limit can't go below that.`
          : ""}
      </p>

      {message && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[0.8rem] font-medium text-red-700"
        >
          {message}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {busy ? "Saving…" : deal ? "Save changes" : "Save deal"}
        </button>
      </div>
      <p className="text-[0.72rem] text-ink-soft">
        {acceptTerms
          ? "Saving publishes the deal if your plan is active and every rule passes."
          : "Saving now keeps the deal paused — tick the terms box when you're ready to publish."}
      </p>
    </form>
  );
}
