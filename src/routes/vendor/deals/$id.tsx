import { Link, createFileRoute, notFound, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";

import { CopyButton } from "~/components/copy-button";
import { Stat, StatusPill, VendorShell } from "~/components/vendor-chrome";
import { categoryName, formatDate, money } from "~/lib/taxonomy";
import type { VoucherSale } from "~/server/vendor-functions";
import {
  confirmVoucherPaymentManually,
  fetchDealSales,
  refundVoucherManually,
} from "~/server/vendor-functions";

export const Route = createFileRoute("/vendor/deals/$id")({
  head: () => ({
    meta: [{ title: "Deal sales | Shop My Neighborhood" }],
  }),
  loader: async ({ params }) => {
    const data = await fetchDealSales({ data: { id: Number(params.id) } });
    if (data === null) throw redirect({ to: "/vendor/login" });
    if (data === "not_found") throw notFound();
    return data;
  },
  component: DealSalesPage,
});

type ActionState = { busy: boolean; ok?: boolean; message?: string };

function DealSalesPage() {
  const { me, deal, vouchers, pending, report, trails, publishBlockedReason } =
    Route.useLoaderData();
  const router = useRouter();
  const confirm = useServerFn(confirmVoucherPaymentManually);
  const refund = useServerFn(refundVoucherManually);
  const [actions, setActions] = useState<Record<string, ActionState>>({});
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  async function run(kind: "confirm" | "refund", code: string) {
    setActions((a) => ({ ...a, [code]: { busy: true } }));
    try {
      const result =
        kind === "confirm"
          ? await confirm({ data: { code } })
          : await refund({ data: { code } });
      setActions((a) => ({ ...a, [code]: { busy: false, ok: result.ok, message: result.message } }));
      if (result.ok) await router.invalidate();
    } catch {
      setActions((a) => ({
        ...a,
        [code]: { busy: false, ok: false, message: "That didn't work — please try again." },
      }));
    }
  }

  const inboundUrl = `${origin}/api/webhooks/vendor`;
  const examplePayload = JSON.stringify(
    {
      code: vouchers[0]?.code ?? "SMN-XXXX-XXXX",
      event: "payment_confirmed",
      note: "Optional note from your payment platform",
    },
    null,
    2,
  );
  const webhookExample = JSON.stringify(
    {
      event: "voucher.pending_created",
      code: vouchers[0]?.code ?? "SMN-XXXX-XXXX",
      order_ref: vouchers[0]?.order_ref ?? "ORD-ABC123",
      status: "pending_payment",
      deal_title: deal.title,
      deal_slug: deal.slug,
      buyer_name: "Jordan Alvarez",
      buyer_email: "jordan@example.com",
      quantity: 1,
      amount_cents: deal.price_cents,
      currency: "USD",
      return_url: `${origin}/voucher/${vouchers[0]?.code ?? "SMN-XXXX-XXXX"}/return`,
    },
    null,
    2,
  );

  return (
    <VendorShell vendorName={me.businessName} active="deals">
      <div className="mx-auto max-w-6xl px-4 pt-6 pb-12">
        <nav className="text-[0.72rem] text-ink-soft">
          <Link to="/vendor/deals" className="hover:text-brand">
            My deals
          </Link>
          <span className="mx-1.5">/</span>
          <span className="text-ink">Sales</span>
        </nav>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={deal.status} />
              <span className="text-[0.68rem] font-semibold tracking-[0.1em] text-ink-soft uppercase">
                {categoryName(deal.category_slug)} · {deal.vendor_city}
              </span>
            </div>
            <h1 className="mt-1.5 font-display text-2xl leading-tight font-semibold text-brand-dark sm:text-3xl">
              {deal.title}
            </h1>
            <p className="mt-1 font-mono text-[0.7rem] break-all text-ink-soft/80">
              Public page: /deals/{deal.slug}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/vendor/deals/$id/edit"
              params={{ id: String(deal.id) }}
              className="rounded-full bg-brand px-4 py-2 text-[0.8rem] font-semibold text-white transition hover:bg-brand-dark"
            >
              Edit deal
            </Link>
            {deal.status === "published" && (
              <Link
                to="/deals/$slug"
                params={{ slug: deal.slug }}
                className="rounded-full border border-black/15 bg-white px-4 py-2 text-[0.8rem] font-semibold text-ink-soft transition hover:border-brand hover:text-brand"
              >
                View public page
              </Link>
            )}
          </div>
        </div>

        {publishBlockedReason && deal.status === "paused" && (
          <p className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-[0.8rem] leading-snug text-amber-900">
            <span className="font-bold">This deal is not live.</span> {publishBlockedReason}
          </p>
        )}

        {/* ------------------------------------------------------- report */}
        <section className="mt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-xl font-semibold text-brand-dark">Voucher report</h2>
            <p className="text-[0.7rem] text-ink-soft">
              Vendor-reported — Shop My Neighborhood doesn&apos;t process the payments.
            </p>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Stat
              label="Sold"
              value={report.sold}
              hint={`Limit ${deal.voucher_limit} · confirmed vouchers`}
            />
            <Stat label="Redeemed" value={report.redeemed} hint="Used in store" tone="good" />
            <Stat label="Refunded" value={report.refunded} hint="Within 24 hours, unused" />
            <Stat
              label="Promo expired"
              value={report.expired}
              hint="Promotional value lapsed, paid value still valid"
              tone={report.expired > 0 ? "warn" : "default"}
            />
            <Stat
              label="Outstanding"
              value={report.outstanding}
              hint="Bought, not yet redeemed"
              tone={report.outstanding > 0 ? "warn" : "default"}
            />
            <Stat
              label="Voucher value collected"
              value={money(report.collectedCents)}
              hint="By you, on your own payment page"
              tone="good"
            />
          </div>
          {report.pending > 0 && (
            <p className="mt-2 text-[0.72rem] text-amber-800">
              {report.pending} voucher{report.pending === 1 ? "" : "s"} awaiting payment
              confirmation — not counted as sold yet.
            </p>
          )}
        </section>

        {/* -------------------------------------------- awaiting payment */}
        <section className="mt-7">
          <h2 className="font-display text-xl font-semibold text-brand-dark">
            Awaiting payment confirmation
          </h2>
          <p className="mt-1 text-[0.78rem] text-ink-soft">
            These shoppers were sent to your payment page. When the money lands in your account,
            confirm it here — or let your webhook do it automatically.
          </p>
          {pending.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-dashed border-black/15 bg-white/60 px-4 py-6 text-center text-[0.82rem] text-ink-soft">
              Nothing waiting. New purchases show up here within seconds.
            </p>
          ) : (
            <ul className="mt-3 grid gap-2">
              {pending.map((v) => (
                <PendingRow
                  key={v.id}
                  voucher={v}
                  state={actions[v.code] ?? { busy: false }}
                  onConfirm={() => run("confirm", v.code)}
                />
              ))}
            </ul>
          )}
        </section>

        {/* ------------------------------------------------ webhooks */}
        <section className="mt-7 rounded-3xl border border-brand/25 bg-brand/5 p-5">
          <h2 className="font-display text-xl font-semibold text-brand-dark">
            Webhook — keep in sync automatically
          </h2>
          <p className="mt-1 text-[0.8rem] leading-snug text-ink-soft">
            We POST a signed JSON body to your URL whenever a voucher is created or confirmed. Your
            payment platform (or your own site) can POST back to us to confirm a payment, so a
            voucher flips from <span className="font-mono text-[0.75rem]">pending_payment</span> to{" "}
            <span className="font-mono text-[0.75rem]">issued</span> the moment the money arrives.
          </p>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <CredentialRow
              label="Your webhook URL (we POST to this)"
              value={deal.webhook_url ?? ""}
              empty="Not set yet — add it on the edit form to receive events."
            />
            <CredentialRow
              label="Signing secret"
              value={deal.webhook_secret ?? ""}
              empty="No secret generated yet."
              mono
            />
          </div>

          <div className="mt-3">
            <p className="text-[0.7rem] font-semibold tracking-[0.1em] uppercase text-ink-soft">
              Inbound endpoint for your payment platform
            </p>
            <div className="mt-1 flex items-start gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-xl bg-white px-3 py-2 font-mono text-[0.72rem] text-brand-dark ring-1 ring-black/10">
                POST {inboundUrl || "/api/webhooks/vendor"}
              </code>
              <CopyButton value={inboundUrl} label="Copy URL" />
            </div>
            <p className="mt-1.5 text-[0.72rem] leading-snug text-ink-soft">
              Authenticate with <span className="font-mono">X-SMN-Signature: sha256=&lt;hmac&gt;</span>{" "}
              (HMAC-SHA256 of the raw body using your signing secret) or{" "}
              <span className="font-mono">Authorization: Bearer &lt;signing secret&gt;</span>.
            </p>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <PayloadCard title="What you POST to us" body={examplePayload} />
            <PayloadCard title="What we POST to you" body={webhookExample} />
          </div>
        </section>

        {/* -------------------------------------------------- vouchers */}
        <section className="mt-7">
          <h2 className="font-display text-xl font-semibold text-brand-dark">Buyers</h2>
          <p className="mt-1 text-[0.78rem] text-ink-soft">
            Only your business can see this list. Each row shows how the payment was confirmed and
            its full audit trail.
          </p>

          {vouchers.length === 0 ? (
            <div className="mt-3 rounded-3xl border border-dashed border-black/15 bg-white/60 p-8 text-center">
              <p className="font-display text-lg font-semibold text-ink">No vouchers sold yet</p>
              <p className="mx-auto mt-1 max-w-md text-[0.85rem] text-ink-soft">
                Once a shopper starts a purchase on the marketplace, their voucher appears here right
                away as “awaiting payment”.
              </p>
            </div>
          ) : (
            <ul className="mt-3 grid gap-2">
              {vouchers.map((v) => (
                <VoucherRow
                  key={v.id}
                  voucher={v}
                  trail={trails[v.code] ?? []}
                  state={actions[v.code] ?? { busy: false }}
                  onConfirm={() => run("confirm", v.code)}
                  onRefund={() => run("refund", v.code)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </VendorShell>
  );
}

function CredentialRow({
  label,
  value,
  empty,
  mono,
}: {
  label: string;
  value: string;
  empty: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-[0.7rem] font-semibold tracking-[0.1em] uppercase text-ink-soft">{label}</p>
      {value ? (
        <div className="mt-1 flex items-start gap-2">
          <code
            className={`min-w-0 flex-1 overflow-x-auto rounded-xl bg-white px-3 py-2 ${mono ? "font-mono" : ""} text-[0.72rem] break-all text-brand-dark ring-1 ring-black/10`}
          >
            {value}
          </code>
          <CopyButton value={value} />
        </div>
      ) : (
        <p className="mt-1 rounded-xl bg-white px-3 py-2 text-[0.75rem] text-ink-soft ring-1 ring-black/10">
          {empty}
        </p>
      )}
    </div>
  );
}

function PayloadCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl bg-white p-3 ring-1 ring-black/10">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.7rem] font-semibold tracking-[0.1em] uppercase text-ink-soft">{title}</p>
        <CopyButton value={body} />
      </div>
      <pre className="mt-2 max-h-52 overflow-auto rounded-xl bg-cream-deep/60 p-3 font-mono text-[0.68rem] leading-relaxed text-ink">
        {body}
      </pre>
    </div>
  );
}

function ActionMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return (
    <p
      role="status"
      className={`mt-1.5 rounded-lg px-2.5 py-1.5 text-[0.72rem] font-medium ${
        state.ok ? "bg-brand-green/15 text-brand-green-dark" : "bg-red-50 text-red-700"
      }`}
    >
      {state.message}
    </p>
  );
}

function PendingRow({
  voucher,
  state,
  onConfirm,
}: {
  voucher: VoucherSale;
  state: ActionState;
  onConfirm: () => void;
}) {
  return (
    <li className="rounded-2xl border border-amber-300 bg-amber-50/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-[0.82rem] font-semibold text-brand-dark">{voucher.code}</p>
          <p className="text-[0.78rem] text-ink">
            {voucher.buyer_name} · {voucher.quantity} voucher
            {voucher.quantity === 1 ? "" : "s"} · {money(voucher.amount_cents)}
          </p>
          <p className="text-[0.7rem] break-all text-ink-soft">
            {voucher.buyer_email} · started {formatDate(voucher.created_at)}
            {voucher.order_ref ? ` · ref ${voucher.order_ref}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onConfirm}
          disabled={state.busy}
          className="rounded-full bg-brand-green px-4 py-2 text-[0.78rem] font-semibold text-white transition hover:bg-brand-green-dark disabled:opacity-60"
        >
          {state.busy ? "Confirming…" : "Confirm payment received"}
        </button>
      </div>
      <ActionMessage state={state} />
    </li>
  );
}

function VoucherRow({
  voucher,
  trail,
  state,
  onConfirm,
  onRefund,
}: {
  voucher: VoucherSale;
  trail: { id: number; event: string; actor: string; note: string | null; created_at: string }[];
  state: ActionState;
  onConfirm: () => void;
  onRefund: () => void;
}) {
  const canConfirm = voucher.status === "pending_payment";
  const canRefund = voucher.status === "pending_payment" || voucher.status === "issued";
  const confirmed = voucher.confirmed_via
    ? voucher.confirmed_via === "webhook"
      ? "Confirmed by webhook"
      : voucher.confirmed_via === "demo"
        ? "Demo voucher (no payment)"
        : "Confirmed manually"
    : voucher.status === "pending_payment"
      ? "Awaiting payment"
      : "Not confirmed";

  return (
    <li className="rounded-2xl border border-black/5 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[0.82rem] font-semibold text-brand-dark">
              {voucher.code}
            </span>
            <StatusPill status={voucher.status} />
            {voucher.paid_value_only === 1 && (
              <span className="rounded-full bg-black/5 px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-[0.1em] text-ink-soft">
                Paid value only
              </span>
            )}
          </div>
          <p className="mt-1 text-[0.82rem] text-ink">
            {voucher.buyer_name} · {voucher.quantity} voucher{voucher.quantity === 1 ? "" : "s"} ·{" "}
            {money(voucher.amount_cents)}
          </p>
          <p className="text-[0.7rem] break-all text-ink-soft">
            {voucher.buyer_email} · bought {formatDate(voucher.created_at)}
          </p>
          <p className="mt-1 text-[0.7rem] font-medium text-ink-soft">
            {confirmed}
            {voucher.confirmed_at ? ` · ${formatDate(voucher.confirmed_at)}` : ""}
            {voucher.redeemed_at ? ` · redeemed ${formatDate(voucher.redeemed_at)}` : ""}
            {voucher.refunded_at ? ` · refunded ${formatDate(voucher.refunded_at)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {canConfirm && (
            <button
              type="button"
              onClick={onConfirm}
              disabled={state.busy}
              className="rounded-full bg-brand-green px-3 py-1.5 text-[0.72rem] font-semibold text-white transition hover:bg-brand-green-dark disabled:opacity-60"
            >
              Confirm payment
            </button>
          )}
          {canRefund && (
            <button
              type="button"
              onClick={onRefund}
              disabled={state.busy}
              className="rounded-full border border-black/15 bg-white px-3 py-1.5 text-[0.72rem] font-semibold text-ink-soft transition hover:border-rose-300 hover:text-rose-700 disabled:opacity-60"
            >
              Mark refunded
            </button>
          )}
        </div>
      </div>
      <ActionMessage state={state} />

      {trail.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[0.7rem] font-semibold text-brand hover:underline">
            Audit trail ({trail.length})
          </summary>
          <ol className="mt-1.5 space-y-1 border-l-2 border-brand/20 pl-3">
            {trail.map((event) => (
              <li key={event.id} className="text-[0.7rem] text-ink-soft">
                <span className="font-mono font-semibold text-brand-dark">{event.event}</span> ·{" "}
                {event.actor} · {formatDate(event.created_at)}
                {event.note ? <span className="block">{event.note}</span> : null}
              </li>
            ))}
          </ol>
        </details>
      )}
    </li>
  );
}
