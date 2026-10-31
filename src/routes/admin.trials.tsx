import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { MarketplaceShell } from "~/components/site-chrome";
import { END_REASON_LABEL, TRIAL_STATUS_LABEL } from "~/lib/trial-rules";
import { formatDate, money } from "~/lib/taxonomy";
import {
  adminDecideTrial,
  adminResolveAlert,
  adminReviewDeal,
  adminSetCityCap,
  adminSetDealPaused,
  adminTerminateTrial,
  adminTrialData,
  adminTrialLogin,
  adminTrialSession,
  type AdminTrialData,
} from "~/server/admin-trial-functions";

export const Route = createFileRoute("/admin/trials")({
  head: () => ({ meta: [{ title: "Free trial admin | Shop My Neighborhood" }, { name: "robots", content: "noindex" }] }),
  loader: async () => {
    const session = await adminTrialSession();
    if (!session.enabled) throw notFound();
    const data = session.authorized ? await adminTrialData() : "unauthorized";
    return { session, data };
  },
  component: AdminTrialsPage,
});

const card = "rounded-2xl border border-black/5 bg-white p-5 shadow-sm";
const small = "rounded-full px-4 py-2 text-[0.8rem] font-semibold disabled:opacity-60";

function AdminTrialsPage() {
  const { session, data } = Route.useLoaderData();
  const router = useRouter();
  const login = useServerFn(adminTrialLogin);
  const [token, setToken] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function authorize(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await login({ data: { token } });
      setNotice(r.message);
      if (r.ok) {
        setToken("");
        await router.invalidate();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <MarketplaceShell>
      <div className="mx-auto max-w-6xl px-4 py-10">
        <p className="kicker">Private administration</p>
        <h1 className="mt-1 font-display text-3xl font-semibold text-brand-dark">Free trial program</h1>
        {!session.authorized || data === "unauthorized" ? (
          <form onSubmit={authorize} className={`${card} mt-6 max-w-md`}>
            <label className="block text-sm font-semibold text-ink">
              Admin token
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)} className="mt-1.5 w-full rounded-xl border border-black/10 px-3 py-2.5 font-normal" autoComplete="current-password" />
            </label>
            <button disabled={busy} className={`${small} mt-4 bg-brand text-white`}>{busy ? "Checking…" : "Open console"}</button>
            {notice && <p className="mt-3 text-sm text-rose-700">{notice}</p>}
          </form>
        ) : (
          <Console data={data} />
        )}
      </div>
    </MarketplaceShell>
  );
}

function useAct() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function act(fn: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setMsg(r.message);
      await router.invalidate();
    } catch {
      setMsg("That action failed.");
    } finally {
      setBusy(false);
    }
  }
  return { act, msg, busy };
}

function Console({ data }: { data: AdminTrialData }) {
  const { act, msg, busy } = useAct();
  const decide = useServerFn(adminDecideTrial);
  const review = useServerFn(adminReviewDeal);
  const terminate = useServerFn(adminTerminateTrial);
  const pause = useServerFn(adminSetDealPaused);
  const setCap = useServerFn(adminSetCityCap);
  const resolve = useServerFn(adminResolveAlert);
  const ask = (q: string) => window.prompt(q) ?? "";

  return (
    <div className="mt-6 space-y-6">
      {msg && <p role="status" className="rounded-xl bg-brand/10 px-4 py-3 text-sm text-brand-dark">{msg}</p>}
      {!data.stripeConfigured && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Stripe is not configured in this runtime (STRIPE_SECRET_KEY missing). Vendors can be approved and deals reviewed, but nobody can connect or buy yet.
        </p>
      )}

      <section className={card}>
        <h2 className="font-display text-xl font-semibold text-brand-dark">Funnel</h2>
        <ol className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {data.funnel.map((f) => (
            <li key={f.label} className="rounded-xl border border-black/10 px-3 py-2">
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-ink-soft">{f.label}</p>
              <p className="font-display text-2xl font-bold text-brand-dark">{f.count}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={card}>
        <h2 className="font-display text-xl font-semibold text-brand-dark">Alerts ({data.alerts.length})</h2>
        {data.alerts.length === 0 ? <p className="mt-2 text-sm text-ink-soft">Nothing needs attention.</p> : (
          <ul className="mt-3 divide-y divide-black/5">
            {data.alerts.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                <div>
                  <span className="mr-2 rounded-full bg-amber-100 px-2 py-0.5 text-[0.65rem] font-bold uppercase text-amber-900">{a.kind.replace(/_/g, " ")}</span>
                  {a.message}
                  <span className="ml-2 text-[0.75rem] text-ink-soft">{formatDate(a.createdAt)}</span>
                </div>
                <button className="text-[0.78rem] font-semibold text-brand hover:underline" disabled={busy} onClick={() => act(() => resolve({ data: { id: a.id } }))}>Resolve</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card}>
        <h2 className="font-display text-xl font-semibold text-brand-dark">Trial requests ({data.requests.length})</h2>
        {data.requests.length === 0 ? <p className="mt-2 text-sm text-ink-soft">No requests waiting.</p> : (
          <ul className="mt-3 space-y-3">
            {data.requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 p-3">
                <div className="text-sm">
                  <p className="font-semibold text-brand-dark">{r.business}</p>
                  <p className="text-ink-soft">{r.vendorEmail} · {r.city} · {r.category} · {formatDate(r.requestedAt)}</p>
                  {(r.cityFull || r.categoryTaken) && <p className="text-rose-700">{r.cityFull ? "City cap reached. " : ""}{r.categoryTaken ? "Category already taken in this city." : ""}</p>}
                </div>
                <div className="flex gap-2">
                  <button disabled={busy || r.cityFull || r.categoryTaken} className={`${small} bg-brand-green text-white`} onClick={() => act(() => decide({ data: { id: r.id, decision: "approved", note: ask("Optional note to the vendor") } }))}>Approve</button>
                  <button disabled={busy} className={`${small} border border-rose-300 text-rose-900`} onClick={() => act(() => decide({ data: { id: r.id, decision: "rejected", note: ask("Reason (shown to the vendor)") } }))}>Decline</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card}>
        <h2 className="font-display text-xl font-semibold text-brand-dark">Deals awaiting review ({data.dealReviews.length})</h2>
        {data.dealReviews.length === 0 ? <p className="mt-2 text-sm text-ink-soft">No deals waiting.</p> : (
          <ul className="mt-3 space-y-4">
            {data.dealReviews.map((d) => (
              <li key={d.dealId} className="rounded-xl border border-black/10 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold text-brand-dark">{d.title} {d.changed && <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[0.65rem] font-bold uppercase text-amber-900">edited</span>}</p>
                    <p className="text-ink-soft">{d.business} · {d.city} · {d.category}</p>
                    <p className="mt-2 text-ink">{money(d.priceCents)} for {money(d.valueCents)} value · {d.voucherLimit} vouchers · redeem {formatDate(d.redemptionStart)} – {formatDate(d.redemptionEnd)}</p>
                    <p className="mt-2 whitespace-pre-wrap text-ink-soft">{d.description}</p>
                    <p className="mt-2 whitespace-pre-wrap text-[0.78rem] text-ink-soft"><strong>Fine print:</strong> {d.finePrint}</p>
                    <p className="mt-1 whitespace-pre-wrap text-[0.78rem] text-ink-soft"><strong>Redeem:</strong> {d.redemptionInstructions}</p>
                  </div>
                  <div className="flex gap-2">
                    <button disabled={busy} className={`${small} bg-brand-green text-white`} onClick={() => act(() => review({ data: { dealId: d.dealId, decision: "approved" } }))}>Approve</button>
                    <button disabled={busy} className={`${small} border border-rose-300 text-rose-900`} onClick={() => { const n = ask("What should the vendor change? (required)"); if (n.trim()) void act(() => review({ data: { dealId: d.dealId, decision: "rejected", note: n } })); }}>Request changes</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card}>
        <h2 className="font-display text-xl font-semibold text-brand-dark">Trials</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-[0.7rem] uppercase tracking-[0.1em] text-ink-soft">
              <tr><th className="py-2 pr-3">Business</th><th className="pr-3">City / category</th><th className="pr-3">Status</th><th className="pr-3">Sold</th><th className="pr-3">Deal</th><th className="pr-3">Dates</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {data.trials.map((t) => (
                <tr key={t.id} className="align-top">
                  <td className="py-2 pr-3 font-semibold text-brand-dark">{t.business}{!t.stripeReady && t.status === "active" && <span className="block text-[0.7rem] font-normal text-amber-700">Stripe not ready</span>}</td>
                  <td className="pr-3 text-ink-soft">{t.city}<br />{t.category}</td>
                  <td className="pr-3">{TRIAL_STATUS_LABEL[t.status]}{t.endReason && <span className="block text-[0.72rem] text-ink-soft">{END_REASON_LABEL[t.endReason]}</span>}</td>
                  <td className="pr-3">{t.verifiedSold}/100{t.complaints > 0 && <span className="block text-[0.72rem] text-rose-700">{t.complaints} complaint{t.complaints === 1 ? "" : "s"}</span>}</td>
                  <td className="pr-3">{t.dealStatus ?? "—"}{t.pausedReason && <span className="block text-[0.72rem] text-ink-soft">{t.pausedReason.replace(/_/g, " ")}</span>}</td>
                  <td className="pr-3 text-[0.78rem] text-ink-soft">{t.approvedAt ? `approved ${formatDate(t.approvedAt)}` : ""}{t.firstLiveAt ? <><br />live {formatDate(t.firstLiveAt)}</> : t.liveDeadlineAt && t.status === "active" ? <><br />go-live by {formatDate(t.liveDeadlineAt)}</> : null}{t.expiresAt && t.status === "active" ? <><br />ends {formatDate(t.expiresAt)}</> : null}</td>
                  <td className="space-x-2 whitespace-nowrap py-2 text-right">
                    {t.status === "active" && t.dealId != null && t.dealStatus === "published" && <button className="text-[0.78rem] font-semibold text-ink-soft hover:text-brand" disabled={busy} onClick={() => act(() => pause({ data: { dealId: t.dealId!, paused: true, note: ask("Why pause?") } }))}>Pause deal</button>}
                    {t.status === "active" && t.dealId != null && t.dealStatus === "paused" && ["complaints", "admin"].includes(t.pausedReason ?? "") && <button className="text-[0.78rem] font-semibold text-brand hover:underline" disabled={busy} onClick={() => act(() => pause({ data: { dealId: t.dealId!, paused: false } }))}>Resume deal</button>}
                    {t.status === "active" && <button className="text-[0.78rem] font-semibold text-rose-700 hover:underline" disabled={busy} onClick={() => { if (window.confirm(`Terminate ${t.business}'s trial? Sold vouchers stay redeemable.`)) void act(() => terminate({ data: { id: t.id, note: ask("Reason") } })); }}>Terminate</button>}
                  </td>
                </tr>
              ))}
              {data.trials.length === 0 && <tr><td colSpan={7} className="py-4 text-ink-soft">No trials yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className={card}>
        <h2 className="font-display text-xl font-semibold text-brand-dark">City caps</h2>
        <p className="mt-1 text-sm text-ink-soft">Approved trial vendors per city (maximum 12; one per category).</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.cities.map((c) => (
            <li key={c.slug} className="flex items-center justify-between rounded-xl border border-black/10 px-3 py-2 text-sm">
              <span><strong>{c.name}</strong> <span className="text-ink-soft">{c.used}/{c.cap}{c.requested ? ` · ${c.requested} waiting` : ""}</span></span>
              <button className="text-[0.78rem] font-semibold text-brand hover:underline" disabled={busy} onClick={() => { const v = ask(`New cap for ${c.name} (0–12)`); if (v.trim() !== "") void act(() => setCap({ data: { city: c.slug, cap: Number(v) } })); }}>Change</button>
            </li>
          ))}
        </ul>
      </section>

      <section className={card}>
        <h2 className="font-display text-xl font-semibold text-brand-dark">Audit log (latest 80)</h2>
        <ul className="mt-3 max-h-96 divide-y divide-black/5 overflow-y-auto text-[0.82rem]">
          {data.audit.map((a, i) => (
            <li key={i} className="py-1.5"><span className="text-ink-soft">{new Date(a.at).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })}</span> · <strong>{a.actor}</strong> · {a.action}{a.business ? ` · ${a.business}` : ""}{a.detail ? ` — ${a.detail}` : ""}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
