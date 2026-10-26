import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import type { BillingState } from "~/server/billing-functions";
import {
  openBillingPortal,
  refreshSubscriptionFromStripe,
  startTierCheckout,
} from "~/server/billing-functions";

function statusTone(status: string): string {
  switch (status) {
    case "active":
    case "trialing":
      return "bg-green-100 text-green-900 ring-green-300";
    case "past_due":
    case "incomplete":
      return "bg-amber-100 text-amber-900 ring-amber-300";
    case "canceled":
      return "bg-red-100 text-red-900 ring-red-300";
    default:
      return "bg-slate-100 text-slate-700 ring-slate-300";
  }
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/**
 * Plan + billing card. Shows the real subscription state mirrored from Stripe,
 * starts a Stripe Checkout Session for a tier, opens the Stripe billing portal,
 * and re-reads the subscription from Stripe when the webhook is not configured.
 *
 * With no Stripe secret saved in the runtime, every button that would take a
 * payment is disabled and the card says so plainly — it never implies a card
 * was charged or a plan is active when it isn't.
 */
export function BillingPanel({ state }: { state: BillingState }) {
  const router = useRouter();
  const startCheckout = useServerFn(startTierCheckout);
  const openPortal = useServerFn(openBillingPortal);
  const refresh = useServerFn(refreshSubscriptionFromStripe);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const renewsOn = formatDate(state.currentPeriodEnd);

  async function upgrade(tier: string) {
    setBusy(tier);
    setError(null);
    setNotice(null);
    try {
      const result = await startCheckout({ data: { tier } });
      if (result.ok) {
        // Stripe's hosted page. No card is charged until the customer pays there.
        window.location.assign(result.url);
        return;
      }
      setError(result.message);
    } catch {
      setError("Couldn't reach billing just now. No card was charged.");
    } finally {
      setBusy(null);
    }
  }

  async function manage() {
    setBusy("portal");
    setError(null);
    setNotice(null);
    try {
      const result = await openPortal();
      if (result.ok) {
        window.location.assign(result.url);
        return;
      }
      setError(result.message);
    } catch {
      setError("Couldn't open the billing portal just now.");
    } finally {
      setBusy(null);
    }
  }

  async function doRefresh() {
    setBusy("refresh");
    setError(null);
    setNotice(null);
    try {
      const result = await refresh();
      setNotice(result.message);
      await router.invalidate();
    } catch {
      setError("Couldn't reach Stripe just now.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-3xl border border-black/5 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[0.68rem] font-semibold tracking-[0.14em] text-ink-soft uppercase">
            Plan and billing
          </p>
          <p className="mt-1 font-display text-2xl font-bold text-brand-dark">
            {state.active ? state.tierName : state.tier === "free" ? "Free listing" : state.tierName}
          </p>
          <p className="text-[0.8rem] text-ink-soft">
            {state.priceLabel}
            {state.tier === "free" ? "" : "/mo"} · subscription status:{" "}
            <span className="font-semibold text-ink">{state.statusLabel}</span>
            {renewsOn && state.active ? ` · renews ${renewsOn}` : ""}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[0.62rem] font-bold tracking-[0.1em] uppercase ring-1 ${statusTone(state.status)}`}
        >
          {state.statusLabel}
        </span>
      </div>

      {!state.configured && (
        <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-[0.78rem] leading-snug text-amber-900">
          <p className="font-bold">Billing isn&apos;t connected yet — no card can be charged.</p>
          <p className="mt-1">
            The Stripe secret key hasn&apos;t been saved for this site, so checkout can&apos;t start
            and no subscription can be billed. Your account, listing and drafts are safe; plans and
            deals go live the moment the key is added and a payment is completed.
          </p>
          {state.missingEnv.length > 0 && (
            <p className="mt-2 font-mono text-[0.7rem] opacity-80">
              Missing: {state.missingEnv.join(", ")}
            </p>
          )}
        </div>
      )}

      {state.configured && !state.webhookConfigured && (
        <div className="mt-4 rounded-2xl border border-brand/20 bg-brand/5 px-4 py-3 text-[0.78rem] leading-snug text-brand-dark">
          <p className="font-semibold">Automatic status updates are off.</p>
          <p className="mt-1">
            Without a webhook signing secret, Stripe can&apos;t tell the site when a subscription is
            renewed or fails. Use <strong>Refresh from Stripe</strong> below to re-read it.
          </p>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[0.78rem] text-red-700">{error}</p>
      )}
      {notice && (
        <p className="mt-3 rounded-xl bg-green-50 px-3 py-2 text-[0.78rem] text-green-800">{notice}</p>
      )}

      <div className="mt-5 border-t border-black/5 pt-4">
        <p className="text-[0.72rem] font-semibold text-ink">
          {state.active ? "Change plan" : "Choose a plan to publish deals"}
        </p>
        <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
          {state.plans.map((plan) => {
            const current = state.active && state.tier === plan.id;
            return (
              <button
                key={plan.id}
                type="button"
                disabled={!state.configured || current || busy !== null}
                onClick={() => upgrade(plan.id)}
                className={`rounded-2xl border px-3 py-2.5 text-left transition ${
                  current
                    ? "border-brand-green bg-green-50"
                    : "border-black/10 bg-white hover:border-brand hover:bg-brand/5"
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <span className="block text-[0.8rem] font-bold text-brand-dark">
                  {plan.name} · {plan.priceLabel}/mo
                </span>
                <span className="mt-0.5 block text-[0.7rem] text-ink-soft">{plan.dealsLabel}</span>
                <span className="mt-1.5 block text-[0.7rem] font-semibold text-brand">
                  {current ? "Current plan" : busy === plan.id ? "Opening Stripe…" : "Choose plan"}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[0.7rem] leading-snug text-ink-soft">
          Choosing a plan opens Stripe&apos;s secure checkout. Nothing is charged until you enter a
          card there, and vouchers sold afterwards are paid to your business — not commission.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-black/5 pt-4">
        <button
          type="button"
          onClick={manage}
          disabled={!state.configured || !state.hasCustomer || busy !== null}
          className="rounded-full border border-black/15 bg-white px-4 py-2 text-[0.78rem] font-semibold text-ink-soft transition hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy === "portal" ? "Opening…" : "Manage billing"}
        </button>
        <button
          type="button"
          onClick={doRefresh}
          disabled={!state.configured || busy !== null}
          className="rounded-full border border-black/15 bg-white px-4 py-2 text-[0.78rem] font-semibold text-ink-soft transition hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy === "refresh" ? "Checking Stripe…" : "Refresh from Stripe"}
        </button>
        {state.configured && !state.hasCustomer && (
          <span className="text-[0.7rem] text-ink-soft">
            Manage billing appears once a plan has been purchased.
          </span>
        )}
      </div>
    </div>
  );
}
