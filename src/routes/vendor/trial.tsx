import { Link, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { CopyButton } from "~/components/copy-button";
import { Stat, UsageBar, VendorShell } from "~/components/vendor-chrome";
import { WEEKDAYS } from "~/lib/deal-rules";
import { END_REASON_LABEL, TRIAL, TRIAL_STATUS_LABEL } from "~/lib/trial-rules";
import { formatDate, money } from "~/lib/taxonomy";
import { fetchVendorMe } from "~/server/vendor-functions";
import {
  beginStripeConnect,
  endMyTrial,
  fetchTrialState,
  refreshStripeStatus,
  requestFreeTrial,
  saveTrialDealFn,
  setTrialPaused,
  type TrialDealView,
  type TrialState,
} from "~/server/trial-functions";

export const Route = createFileRoute("/vendor/trial")({
  head: () => ({ meta: [{ title: "Free trial | Shop My Neighborhood" }, { name: "robots", content: "noindex" }] }),
  loader: async () => {
    const me = await fetchVendorMe();
    if (!me) throw redirect({ to: "/vendor/login" });
    const state = await fetchTrialState();
    if (!state) throw redirect({ to: "/vendor/login" });
    return { me, state };
  },
  component: TrialPage,
});

const inputClass =
  "mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/25 focus:outline-none";
const btn =
  "rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60";
const btnGhost =
  "rounded-full border border-black/15 bg-white px-4 py-2 text-[0.8rem] font-semibold text-ink-soft transition hover:border-brand hover:text-brand disabled:opacity-60";

function Card({ title, children, tone }: { title?: string; children: React.ReactNode; tone?: "warn" | "good" }) {
  const border = tone === "warn" ? "border-amber-300 bg-amber-50" : tone === "good" ? "border-brand-green/40 bg-brand-green/5" : "border-black/5 bg-white";
  return (
    <section className={`rounded-2xl border p-5 shadow-sm ${border}`}>
      {title && <h2 className="font-display text-lg font-semibold text-brand-dark">{title}</h2>}
      <div className={title ? "mt-3" : ""}>{children}</div>
    </section>
  );
}

function TrialPage() {
  const { me, state } = Route.useLoaderData();
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useServerFn(requestFreeTrial);
  const connect = useServerFn(beginStripeConnect);
  const refresh = useServerFn(refreshStripeStatus);
  const pause = useServerFn(setTrialPaused);
  const endTrial = useServerFn(endMyTrial);

  async function run(fn: () => Promise<{ ok: boolean; message: string; url?: string }>) {
    setBusy(true);
    setNote(null);
    try {
      const r = await fn();
      if (r.ok && r.url) {
        window.location.assign(r.url);
        return;
      }
      setNote(r.message);
      await router.invalidate();
    } catch {
      setNote("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const t = state.trial;
  return (
    <VendorShell vendorName={me.businessName} active="trial">
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-8">
        <div>
          <p className="kicker">Free trial</p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-brand-dark sm:text-3xl">
            {t ? `Free trial — ${TRIAL_STATUS_LABEL[t.status]}` : "Try Shop My Neighborhood free"}
          </h1>
        </div>
        {note && (
          <p role="status" className="rounded-xl border border-brand/25 bg-brand/5 px-4 py-3 text-sm text-brand-dark">
            {note}
          </p>
        )}

        {!t && <Offer state={state} busy={busy} onRequest={() => run(() => request({ data: undefined as never }))} />}

        {t?.status === "requested" && (
          <Card tone="warn" title="Waiting for approval">
            <p className="text-sm text-ink-soft">
              We review every request by hand. You'll get an email when it's decided. Requested {formatDate(t.requestedAt)}.
            </p>
          </Card>
        )}

        {t && ["rejected", "lapsed", "ended", "terminated"].includes(t.status) && <Finished state={state} />}

        {t?.status === "active" && (
          <>
            <Progress state={state} />
            <StripeCard state={state} busy={busy} onConnect={() => run(() => connect({ data: undefined as never }))} onRefresh={() => run(() => refresh({ data: undefined as never }))} />
            <DealCard state={state} />
            {state.deal && state.deal.reviewState === "approved" && (
              <Card title="Live status">
                <p className="text-sm text-ink-soft">
                  {state.deal.status === "published"
                    ? "Your deal is live and selling."
                    : `Your deal is paused${state.deal.pausedReason ? ` (${reasonLabel(state.deal.pausedReason)})` : ""}.`}
                </p>
                <div className="mt-3 flex gap-2">
                  {state.deal.status === "published" ? (
                    <button className={btnGhost} disabled={busy} onClick={() => run(() => pause({ data: { paused: true } }))}>Pause deal</button>
                  ) : (
                    <button className={btnGhost} disabled={busy} onClick={() => run(() => pause({ data: { paused: false } }))}>Resume deal</button>
                  )}
                </div>
              </Card>
            )}
            {state.shareKit && <ShareKit kit={state.shareKit} />}
            {state.neighbors.length > 0 && (
              <Card title="Other local businesses in the trial">
                <p className="text-sm text-ink-soft">Cross-promote with your neighbors — send customers their way and ask them to do the same.</p>
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {state.neighbors.map((n) => (
                    <li key={n.slug}>
                      <Link to="/deals/$slug" params={{ slug: n.slug }} className="block rounded-xl border border-black/10 px-3 py-2 text-sm hover:border-brand">
                        <span className="font-semibold text-brand-dark">{n.name}</span>
                        <span className="block text-[0.78rem] text-ink-soft">{n.dealTitle}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <Card title="Upgrade or end">
              <p className="text-sm text-ink-soft">
                Want more than 1 deal or 100 vouchers? Upgrading ends the trial and moves you to a paid plan. Vouchers already sold stay redeemable either way.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link to="/vendor/dashboard" className={btn}>See paid plans</Link>
                <button
                  className={btnGhost}
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("End your free trial now? Your deal will pause. Sold vouchers stay redeemable.")) void run(() => endTrial({ data: undefined as never }));
                  }}
                >
                  End my trial
                </button>
              </div>
            </Card>
          </>
        )}
      </div>
    </VendorShell>
  );
}

function reasonLabel(r: string): string {
  const map: Record<string, string> = {
    awaiting_review: "waiting for review",
    awaiting_stripe: "waiting for Stripe to be connected",
    changes_pending_review: "your changes are waiting for review",
    changes_requested: "changes requested",
    complaints: "paused after buyer reports",
    admin: "paused by My Neighborhood",
    vendor: "paused by you",
  };
  return map[r] ?? r;
}

function Offer({ state, busy, onRequest }: { state: TrialState; busy: boolean; onRequest: () => void }) {
  return (
    <>
      <Card title="What you get">
        <ul className="grid gap-2 text-sm text-ink-soft sm:grid-cols-2">
          <li>No monthly fee, ever, during the trial</li>
          <li>1 deal, up to {TRIAL.maxVouchers} vouchers</li>
          <li>Up to {money(TRIAL.maxPriceCents)} per voucher, {TRIAL.maxPerDay} sold per day</li>
          <li>{TRIAL.durationMonths} months from approval</li>
          <li>Customers pay <strong>you</strong> through your own Stripe account</li>
          <li>We never take a cut of your sales or touch your money</li>
        </ul>
        <p className="mt-3 text-[0.8rem] text-ink-soft">
          One trial per business. Every trial deal is reviewed before it goes live, and you need a live deal within {TRIAL.liveDeadlineDays} days of approval.
        </p>
      </Card>
      {state.eligibility.ok ? (
        <Card tone="good">
          <p className="text-sm text-ink">
            <strong>{state.eligibility.businessName}</strong> is eligible. Request your free trial and we'll review it.
          </p>
          <button className={`${btn} mt-3`} disabled={busy} onClick={onRequest}>Request my free trial</button>
        </Card>
      ) : (
        <Card tone="warn">
          <p className="text-sm text-amber-900">{state.eligibility.reason}</p>
          {state.eligibility.code === "no_claim" && (
            <Link to="/vendor/claim" className={`${btn} mt-3 inline-block`}>Claim my listing</Link>
          )}
        </Card>
      )}
    </>
  );
}

function Finished({ state }: { state: TrialState }) {
  const t = state.trial!;
  return (
    <Card title="This trial is over">
      <p className="text-sm text-ink-soft">
        {t.status === "rejected"
          ? "This request wasn't approved."
          : `Ended ${formatDate(t.endedAt)}${t.endReason ? ` — ${END_REASON_LABEL[t.endReason]}` : ""}.`}
        {t.decisionNote ? ` Note: ${t.decisionNote}` : ""}
      </p>
      {t.status !== "rejected" && (
        <p className="mt-2 text-sm text-ink-soft">You sold {t.verifiedSold} voucher{t.verifiedSold === 1 ? "" : "s"}. They stay redeemable on the Redeem page.</p>
      )}
      <Link to="/vendor/dashboard" className={`${btn} mt-4 inline-block`}>Choose a paid plan</Link>
    </Card>
  );
}

function Progress({ state }: { state: TrialState }) {
  const t = state.trial!;
  return (
    <Card title="Your trial">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Sold" value={`${t.verifiedSold}/${TRIAL.maxVouchers}`} hint="Stripe-verified sales" />
        <Stat label="Today" value={`${t.soldToday}/${TRIAL.maxPerDay}`} hint="Daily limit" />
        <Stat
          label={t.firstLiveAt ? "Trial ends" : "Go live by"}
          value={t.firstLiveAt ? (t.daysToEnd != null ? `${Math.max(0, t.daysToEnd)}d` : "—") : t.daysToLive != null ? `${Math.max(0, t.daysToLive)}d` : "—"}
          tone={!t.firstLiveAt && (t.daysToLive ?? 99) <= TRIAL.deadlineWarnDays ? "warn" : "default"}
          hint={t.firstLiveAt ? formatDate(t.expiresAt) : formatDate(t.liveDeadlineAt)}
        />
        <Stat label="Checkouts open" value={t.heldNow} hint="Held up to 30 min" />
      </div>
      <div className="mt-4">
        <UsageBar used={t.verifiedSold} limit={TRIAL.maxVouchers} suffix="vouchers" />
      </div>
      {!t.firstLiveAt && (
        <p className="mt-3 text-[0.8rem] text-ink-soft">
          Get a deal approved and live by {formatDate(t.liveDeadlineAt)} or this approval lapses.
        </p>
      )}
    </Card>
  );
}

function StripeCard({ state, busy, onConnect, onRefresh }: { state: TrialState; busy: boolean; onConnect: () => void; onRefresh: () => void }) {
  const t = state.trial!;
  if (t.chargesEnabled)
    return (
      <Card tone="good" title="Stripe connected">
        <p className="text-sm text-ink-soft">Customers pay you directly through your own Stripe account. You handle refunds, disputes and payouts in your Stripe dashboard. We take no fee.</p>
      </Card>
    );
  return (
    <Card tone="warn" title="Connect your Stripe account">
      <p className="text-sm text-amber-900">
        Customers pay you directly through your own Stripe account — we never hold your money and take no fee. Your deal goes live as soon as Stripe can take payments.
      </p>
      {!state.stripeConfigured && <p className="mt-2 text-[0.8rem] text-amber-900">Payments are being switched on — this button will work as soon as they are.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button className={btn} disabled={busy || !state.stripeConfigured} onClick={onConnect}>
          {t.stripeConnected ? "Finish Stripe setup" : "Connect Stripe"}
        </button>
        {t.stripeConnected && <button className={btnGhost} disabled={busy} onClick={onRefresh}>I finished — check again</button>}
      </div>
    </Card>
  );
}

function ShareKit({ kit }: { kit: NonNullable<TrialState["shareKit"]> }) {
  return (
    <Card title="Share kit">
      <p className="text-sm text-ink-soft">Ready-to-post text. Copy, paste, send.</p>
      {[["Your link", kit.url], ["Short post", kit.short], ["Email / longer post", kit.long]].map(([label, text]) => (
        <div key={label} className="mt-3 rounded-xl border border-black/10 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-ink-soft">{label}</p>
            <CopyButton value={text!} />
          </div>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-[0.85rem] text-ink">{text}</p>
        </div>
      ))}
    </Card>
  );
}

// ------------------------------------------------------------------ deal form

function DealCard({ state }: { state: TrialState }) {
  const deal = state.deal;
  const router = useRouter();
  const save = useServerFn(saveTrialDealFn);
  const [f, setF] = useState(() => initial(deal));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f, v: string | boolean | string[]) => setF((p) => ({ ...p, [k]: v }));
  const err = (k: string) => errs[k] && <p className="mt-1 text-[0.75rem] text-rose-700">{errs[k]}</p>;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrs({});
    setMsg(null);
    try {
      const r = await save({ data: { ...f } });
      setErrs(r.fields ?? {});
      setMsg(r.message);
      if (r.ok) await router.invalidate();
    } catch {
      setMsg("Something went wrong saving. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={deal ? "Your deal" : "Create your deal"}>
      {deal && <ReviewBanner deal={deal} />}
      <p className="text-[0.8rem] text-ink-soft">
        Price up to {money(state.limits.maxPriceCents)}, up to {state.limits.maxVouchers} vouchers. Your deal is listed in your own city and category. Changing the title, price, value, limit, dates or terms sends it back for review.
      </p>
      <form onSubmit={onSubmit} className="mt-4 grid gap-4" noValidate>
        <label className="text-sm font-medium">Title<input className={inputClass} value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={120} />{err("title")}</label>
        <label className="text-sm font-medium">Description<textarea className={inputClass} rows={4} value={f.description} onChange={(e) => set("description", e.target.value)} />{err("description")}</label>
        <label className="text-sm font-medium">Highlights (one per line)<textarea className={inputClass} rows={3} value={f.highlights} onChange={(e) => set("highlights", e.target.value)} />{err("highlights")}</label>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="text-sm font-medium">Voucher price ($)<input className={inputClass} inputMode="decimal" value={f.price} onChange={(e) => set("price", e.target.value)} />{err("price")}</label>
          <label className="text-sm font-medium">Worth ($)<input className={inputClass} inputMode="decimal" value={f.value} onChange={(e) => set("value", e.target.value)} />{err("value")}</label>
          <label className="text-sm font-medium">Vouchers to sell<input className={inputClass} inputMode="numeric" value={f.voucherLimit} onChange={(e) => set("voucherLimit", e.target.value)} />{err("voucherLimit")}</label>
        </div>
        <label className="text-sm font-medium">Per customer limit (1–5)<input className={inputClass} inputMode="numeric" value={String(f.perCustomerLimit)} onChange={(e) => set("perCustomerLimit", e.target.value)} />{err("perCustomerLimit")}</label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">Redeemable from<input type="date" className={inputClass} value={f.redemptionStart} onChange={(e) => set("redemptionStart", e.target.value)} />{err("redemptionStart")}</label>
          <label className="text-sm font-medium">Redeemable until<input type="date" className={inputClass} value={f.redemptionEnd} onChange={(e) => set("redemptionEnd", e.target.value)} />{err("redemptionEnd")}</label>
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Valid days (none selected = every day)</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => (
              <label key={d.key} className="flex items-center gap-1.5 rounded-full border border-black/10 px-3 py-1 text-[0.8rem]">
                <input type="checkbox" checked={f.validDays.includes(d.key)} onChange={(e) => set("validDays", e.target.checked ? [...f.validDays, d.key] : f.validDays.filter((x) => x !== d.key))} />
                {d.short}
              </label>
            ))}
          </div>
          {err("validDays")}
        </fieldset>
        <label className="text-sm font-medium">Blackout dates (YYYY-MM-DD, one per line)<textarea className={inputClass} rows={2} value={f.blackoutDates} onChange={(e) => set("blackoutDates", e.target.value)} />{err("blackoutDates")}</label>
        <label className="text-sm font-medium">Fine print<textarea className={inputClass} rows={3} value={f.finePrint} onChange={(e) => set("finePrint", e.target.value)} />{err("finePrint")}</label>
        <label className="text-sm font-medium">How customers redeem<textarea className={inputClass} rows={2} value={f.redemptionInstructions} onChange={(e) => set("redemptionInstructions", e.target.value)} />{err("redemptionInstructions")}</label>
        <label className="flex items-start gap-2 text-[0.85rem] text-ink-soft">
          <input type="checkbox" className="mt-1" checked={f.acceptTerms} onChange={(e) => set("acceptTerms", e.target.checked)} />
          <span>I accept the voucher terms: customers pay me directly through my Stripe account, I handle refunds, and paid value never expires.</span>
        </label>
        {err("terms")}
        {msg && <p role="status" className="text-sm text-brand-dark">{msg}</p>}
        <div><button className={btn} disabled={busy}>{busy ? "Saving…" : deal ? "Save changes" : "Submit for review"}</button></div>
      </form>
    </Card>
  );
}

function ReviewBanner({ deal }: { deal: TrialDealView }) {
  if (deal.reviewState === "pending")
    return <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-[0.8rem] text-amber-900">In review. It can't go live until we approve it.</p>;
  if (deal.reviewState === "rejected")
    return <p className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-[0.8rem] text-rose-900">Changes needed: {deal.reviewNote ?? "see the reviewer's note"}. Edit and save to resubmit.</p>;
  if (deal.reviewState === "approved")
    return <p className="mb-3 rounded-xl bg-brand-green/10 px-3 py-2 text-[0.8rem] text-brand-green-dark">Approved. <a className="font-semibold underline" href={deal.publicUrl}>View public page</a></p>;
  return null;
}

function initial(deal: TrialDealView | null) {
  return {
    title: deal?.title ?? "",
    description: deal?.description ?? "",
    highlights: deal?.highlights ?? "",
    finePrint: deal?.finePrint ?? "",
    price: deal?.price ?? "",
    value: deal?.value ?? "",
    voucherLimit: String(deal?.voucherLimit ?? 100),
    perCustomerLimit: String(deal?.perCustomerLimit ?? 2),
    redemptionStart: deal?.redemptionStart ?? "",
    redemptionEnd: deal?.redemptionEnd ?? "",
    validDays: deal?.validDays ?? ([] as string[]),
    blackoutDates: deal?.blackoutDates ?? "",
    redemptionInstructions: deal?.redemptionInstructions ?? "",
    acceptTerms: Boolean(deal),
  };
}

