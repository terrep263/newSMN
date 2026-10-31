import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { MarketplaceShell } from "~/components/site-chrome";
import { formatDate, money } from "~/lib/taxonomy";
import {
  buyerLogin,
  buyerLogout,
  buyerRegister,
  fetchMyVouchers,
  reportDeal,
  type BuyerVoucherView,
} from "~/server/trial-functions";

export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: "My vouchers | Shop My Neighborhood" }, { name: "robots", content: "noindex" }] }),
  loader: () => fetchMyVouchers({ data: undefined as never }),
  component: AccountPage,
});

const inputClass =
  "mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/25 focus:outline-none";

const STATUS: Record<string, string> = {
  pending_payment: "Waiting for payment",
  issued: "Ready to use",
  redeemed: "Redeemed",
  refunded: "Refunded",
  expired: "Promo expired (paid value still good)",
};

function AccountPage() {
  const data = Route.useLoaderData();
  return (
    <MarketplaceShell>
      <div className="mx-auto max-w-3xl px-4 py-10">
        {data ? <Vouchers name={data.buyer.name} email={data.buyer.email} vouchers={data.vouchers} /> : <SignIn />}
      </div>
    </MarketplaceShell>
  );
}

function SignIn() {
  const router = useRouter();
  const login = useServerFn(buyerLogin);
  const register = useServerFn(buyerRegister);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = mode === "login" ? await login({ data: { email, password } }) : await register({ data: { name, email, password } });
      if (!r.ok) setMsg(r.message);
      else await router.invalidate();
    } catch {
      setMsg("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-md">
      <h1 className="font-display text-3xl font-semibold text-brand-dark">{mode === "login" ? "Sign in" : "Create your account"}</h1>
      <p className="mt-2 text-sm text-ink-soft">Your vouchers from free-trial local businesses live here.</p>
      <form onSubmit={submit} className="mt-6 grid gap-4" noValidate>
        {mode === "register" && <label className="text-sm font-medium">Name<input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>}
        <label className="text-sm font-medium">Email<input type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
        <label className="text-sm font-medium">Password<input type="password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} /></label>
        {msg && <p role="alert" className="text-sm text-rose-700">{msg}</p>}
        <button disabled={busy} className="rounded-full bg-brand px-5 py-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60">{busy ? "One moment…" : mode === "login" ? "Sign in" : "Create account"}</button>
      </form>
      <button className="mt-4 text-sm font-semibold text-brand hover:underline" onClick={() => { setMode(mode === "login" ? "register" : "login"); setMsg(null); }}>
        {mode === "login" ? "New here? Create an account" : "Have an account? Sign in"}
      </button>
    </div>
  );
}

function Vouchers({ name, email, vouchers }: { name: string; email: string; vouchers: BuyerVoucherView[] }) {
  const router = useRouter();
  const logout = useServerFn(buyerLogout);
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="kicker">My account</p>
          <h1 className="font-display text-3xl font-semibold text-brand-dark">Hi, {name}</h1>
          <p className="mt-1 text-sm text-ink-soft">{email}</p>
        </div>
        <button className="rounded-full border border-black/15 bg-white px-4 py-2 text-[0.8rem] font-semibold text-ink-soft hover:border-brand hover:text-brand" onClick={async () => { await logout({ data: undefined as never }); await router.invalidate(); }}>
          Sign out
        </button>
      </div>
      <h2 className="mt-8 font-display text-xl font-semibold text-brand-dark">My vouchers</h2>
      {vouchers.length === 0 ? (
        <p className="mt-3 text-sm text-ink-soft">
          No vouchers yet. <Link to="/deals" className="font-semibold text-brand hover:underline">Browse deals</Link>.
        </p>
      ) : (
        <ul className="mt-3 grid gap-3">
          {vouchers.map((v) => <VoucherRow key={v.code} v={v} />)}
        </ul>
      )}
    </>
  );
}

function VoucherRow({ v }: { v: BuyerVoucherView }) {
  const router = useRouter();
  const report = useServerFn(reportDeal);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <li className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link to="/voucher/$code" params={{ code: v.code }} className="font-semibold text-brand-dark hover:underline">{v.dealTitle}</Link>
          <p className="text-[0.8rem] text-ink-soft">{v.vendorName} · {v.quantity} × · {money(v.amountCents)} · {formatDate(v.createdAt)}</p>
          <p className="mt-1 font-mono text-[0.85rem] text-ink">{v.code}</p>
        </div>
        <span className="rounded-full bg-brand/10 px-2.5 py-1 text-[0.65rem] font-bold uppercase tracking-[0.1em] text-brand-dark">{STATUS[v.status] ?? v.status}</span>
      </div>
      {v.isTrial && v.confirmed && !v.complained && (
        <div className="mt-3">
          {!open ? (
            <button className="text-[0.78rem] font-semibold text-ink-soft hover:text-rose-700" onClick={() => setOpen(true)}>Report a problem with this deal</button>
          ) : (
            <div>
              <label className="text-sm font-medium">What went wrong?
                <textarea className={inputClass} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <div className="mt-2 flex gap-2">
                <button
                  disabled={busy}
                  className="rounded-full bg-rose-700 px-4 py-2 text-[0.8rem] font-semibold text-white disabled:opacity-60"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const r = await report({ data: { code: v.code, reason } });
                      setMsg(r.message);
                      if (r.ok) { setOpen(false); await router.invalidate(); }
                    } finally { setBusy(false); }
                  }}
                >Send report</button>
                <button className="text-[0.8rem] text-ink-soft" onClick={() => setOpen(false)}>Cancel</button>
              </div>
            </div>
          )}
          {msg && <p role="status" className="mt-2 text-[0.8rem] text-ink-soft">{msg}</p>}
        </div>
      )}
      {v.complained && <p className="mt-2 text-[0.78rem] text-ink-soft">You reported this deal. Thank you.</p>}
    </li>
  );
}
