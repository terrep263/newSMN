import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { Icon } from "~/components/icons";
import { StatusPill, UnbilledNotice, VendorShell } from "~/components/vendor-chrome";
import { isoDayLabel, validDaysLabel } from "~/lib/deal-rules";
import { categoryName, formatDate, money } from "~/lib/taxonomy";
import type { RedeemLookup, RedeemResult } from "~/server/vendor-functions";
import { fetchVendorMe, lookupVoucher, redeemVoucher } from "~/server/vendor-functions";

export const Route = createFileRoute("/vendor/redeem")({
  head: () => ({
    meta: [{ title: "Redeem a voucher | Shop My Neighborhood" }],
  }),
  loader: async () => {
    const me = await fetchVendorMe();
    if (!me) throw redirect({ to: "/vendor/login" });
    return me;
  },
  component: RedeemPage,
});

type Found = Extract<RedeemLookup, { ok: true }>;
type Redeemed = Extract<RedeemResult, { ok: true }>;
type Failure = { ok: false; error: string; message: string };

function RedeemPage() {
  const me = Route.useLoaderData();
  const router = useRouter();
  const lookup = useServerFn(lookupVoucher);
  const redeem = useServerFn(redeemVoucher);
  const inputRef = useRef<HTMLInputElement>(null);

  const [code, setCode] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [done, setDone] = useState<Redeemed | null>(null);
  const [error, setError] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setCode("");
    setFound(null);
    setDone(null);
    setError(null);
    inputRef.current?.focus();
  }

  async function onLookup(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setFound(null);
    setDone(null);
    setError(null);
    try {
      const result = await lookup({ data: { code } });
      if (result.ok) setFound(result);
      else setError({ ok: false, error: result.error, message: result.message });
    } catch {
      setError({ ok: false, error: "unknown", message: "Lookup failed. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  async function onRedeem(paidValueOnly: boolean) {
    if (!found) return;
    setBusy(true);
    setError(null);
    try {
      const result = await redeem({ data: { code: found.voucher.code, paidValueOnly } });
      if (result.ok) {
        setDone(result);
        setFound(null);
        await router.invalidate();
      } else {
        setError({ ok: false, error: result.error, message: result.message });
        setFound(null);
      }
    } catch {
      setError({ ok: false, error: "unknown", message: "Redeeming failed. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <VendorShell vendorName={me.businessName} active="redeem">
      <div className="mx-auto max-w-md px-4 pt-6 pb-10">
        <p className="kicker">In-store redemption</p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-brand-dark sm:text-3xl">
          Redeem a voucher
        </h1>
        <p className="mt-1.5 text-[0.85rem] text-ink-soft">
          Type the code the customer shows you, check it&apos;s theirs, then tap redeem.
        </p>

        <form onSubmit={onLookup} className="mt-5">
          <label htmlFor="code" className="block text-[0.72rem] font-semibold text-ink">
            Voucher code
          </label>
          <input
            id="code"
            ref={inputRef}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="SMN-XXXX-XXXX"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            enterKeyHint="go"
            className="mt-1 w-full rounded-2xl border border-black/15 bg-white px-4 py-4 text-center font-mono text-xl font-bold tracking-[0.12em] text-brand-dark shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/25 focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !code.trim()}
            className="mt-3 w-full rounded-full bg-brand px-5 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy && !found ? "Checking…" : "Look up voucher"}
          </button>
        </form>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[0.85rem] font-medium text-red-700"
          >
            <p>{error.message}</p>
            {error.error === "other_vendor" && (
              <p className="mt-1 text-[0.78rem] font-normal text-red-600">
                Only the business that ran the deal can redeem its vouchers.
              </p>
            )}
            <button
              type="button"
              onClick={reset}
              className="mt-2 rounded-full border border-red-300 bg-white px-3 py-1.5 text-[0.75rem] font-semibold text-red-700"
            >
              Try another code
            </button>
          </div>
        )}

        {found && (
          <div className="mt-4 rounded-3xl border border-brand/25 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-lg font-bold tracking-[0.08em] text-brand-dark">
                {found.voucher.code}
              </p>
              <StatusPill status={found.voucher.status} />
            </div>
            <p className="mt-2 font-display text-lg leading-snug font-semibold text-ink">
              {found.voucher.deal_title}
            </p>
            <p className="text-[0.75rem] text-ink-soft">
              {categoryName(found.voucher.deal_category)} · {found.voucher.deal_city}
            </p>

            <dl className="mt-3 grid gap-1.5 border-t border-black/5 pt-3 text-[0.82rem]">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Customer</dt>
                <dd className="text-right font-semibold text-ink">{found.voucher.buyer_name}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Email</dt>
                <dd className="max-w-[60%] truncate text-right text-ink-soft">
                  {found.voucher.buyer_email}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Vouchers</dt>
                <dd className="font-semibold text-ink">{found.voucher.quantity}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Amount</dt>
                <dd className="font-semibold text-ink">{money(found.voucher.amount_cents)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Bought</dt>
                <dd className="text-ink-soft">{formatDate(found.voucher.created_at)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Payment</dt>
                <dd className="text-right text-ink-soft">
                  {found.voucher.confirmed_via === "webhook"
                    ? "Confirmed by webhook"
                    : found.voucher.confirmed_via === "demo"
                      ? "Demo voucher"
                      : found.voucher.confirmed_at
                        ? "Confirmed manually"
                        : "Not confirmed yet"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Usable</dt>
                <dd className="text-right text-ink-soft">
                  {found.voucher.redemption_start && found.voucher.redemption_end
                    ? `${isoDayLabel(found.voucher.redemption_start)} – ${isoDayLabel(found.voucher.redemption_end)}`
                    : "No window set"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Valid days</dt>
                <dd className="text-right text-ink-soft">
                  {validDaysLabel(found.voucher.valid_days)}
                </dd>
              </div>
              {found.voucher.blackout_dates.length > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-soft">Blackouts</dt>
                  <dd className="text-right text-ink-soft">
                    {found.voucher.blackout_dates.map((d) => isoDayLabel(d)).join(", ")}
                  </dd>
                </div>
              )}
            </dl>

            {/* Verdict from the server: can this be redeemed right now? */}
            <div
              className={`mt-3 rounded-xl px-3 py-2 text-[0.8rem] leading-snug ${
                found.canRedeem
                  ? found.paidValueOnly
                    ? "bg-amber-50 text-amber-900 ring-1 ring-amber-300"
                    : "bg-brand-green/10 text-brand-green-dark ring-1 ring-brand-green/30"
                  : "bg-red-50 text-red-700 ring-1 ring-red-200"
              }`}
            >
              {found.message}
            </div>

            {found.canRedeem && (
              <button
                type="button"
                onClick={() => onRedeem(found.paidValueOnly)}
                disabled={busy}
                className={`mt-4 w-full rounded-full px-5 py-4 text-base font-bold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  found.paidValueOnly
                    ? "bg-amber-600 hover:bg-amber-700"
                    : "bg-brand-green hover:bg-brand-green-dark"
                }`}
              >
                {busy
                  ? "Redeeming…"
                  : found.paidValueOnly
                    ? `Redeem at paid value — ${money(found.voucher.amount_cents)}`
                    : "Mark as redeemed"}
              </button>
            )}

            <button
              type="button"
              onClick={reset}
              className="mt-2 w-full rounded-full border border-black/15 px-5 py-2.5 text-[0.8rem] font-semibold text-ink-soft"
            >
              {found.canRedeem ? "Cancel" : "Try another code"}
            </button>
          </div>
        )}

        {done && (
          <div
            role="status"
            className="mt-4 rounded-3xl border border-brand-green/40 bg-brand-green/10 p-5 text-center"
          >
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-green text-white">
              <Icon name="check" className="h-6 w-6" />
            </span>
            <p className="mt-3 font-display text-xl font-semibold text-brand-green-dark">
              Voucher redeemed
            </p>
            <p className="mt-1 font-mono text-[0.95rem] font-bold tracking-[0.08em] text-brand-dark">
              {done.voucher.code}
            </p>
            <p className="mt-1 text-[0.8rem] text-ink-soft">
              {done.voucher.deal_title} · {done.voucher.quantity} voucher
              {done.voucher.quantity === 1 ? "" : "s"} · redeemed{" "}
              {formatDate(done.voucher.redeemed_at)}
            </p>
            {done.paidValueOnly && (
              <p className="mt-2 text-[0.75rem] font-medium text-amber-800">
                Recorded as a paid-value-only redemption — the promotional value had expired.
              </p>
            )}
            <button
              type="button"
              onClick={reset}
              className="mt-4 w-full rounded-full bg-brand px-5 py-3.5 text-base font-semibold text-white transition hover:bg-brand-dark"
            >
              Redeem another code
            </button>
          </div>
        )}

        <div className="mt-6 space-y-3">
          <UnbilledNotice />
          <p className="text-center text-[0.72rem] leading-snug text-ink-soft">
            Redeeming marks the code as used — no money moves. Refunds (within 24 hours, unused) are
            on the deal page.{" "}
            <Link to="/vendor/deals" className="font-semibold text-brand hover:underline">
              See your deals
            </Link>
            .
          </p>
        </div>
      </div>
    </VendorShell>
  );
}
