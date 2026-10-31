import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";

import { money } from "~/lib/taxonomy";
import { beginTrialCheckout, buyerLogin, buyerRegister, fetchBuyerMe, type BuyerMe } from "~/server/trial-functions";

const inputClass =
  "mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/25 focus:outline-none";

/** Buy panel for free-trial deals: sign in, then pay the business directly on Stripe. */
export function TrialBuyPanel({
  slug,
  priceCents,
  maxQuantity,
  vendorName,
}: {
  slug: string;
  priceCents: number;
  maxQuantity: number;
  vendorName: string;
}) {
  const getMe = useServerFn(fetchBuyerMe);
  const checkout = useServerFn(beginTrialCheckout);
  const login = useServerFn(buyerLogin);
  const register = useServerFn(buyerRegister);

  const [me, setMe] = useState<BuyerMe | null | undefined>(undefined);
  const [mode, setMode] = useState<"register" | "login">("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    getMe({ data: undefined as never }).then((m) => live && setMe(m)).catch(() => live && setMe(null));
    return () => {
      live = false;
    };
  }, [getMe]);

  const options = Array.from({ length: Math.max(1, Math.min(5, maxQuantity)) }, (_, i) => i + 1);

  async function pay() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await checkout({ data: { slug, quantity } });
      if (r.ok && r.url) {
        window.location.assign(r.url);
        return;
      }
      if (r.needsLogin) setMe(null);
      setMessage(r.message);
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onAuth(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    setFields({});
    try {
      const r = mode === "login" ? await login({ data: { email, password } }) : await register({ data: { name, email, password } });
      if (!r.ok) {
        setMessage(r.message);
        setFields(r.fields ?? {});
        return;
      }
      setMe(await getMe({ data: undefined as never }));
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (me === undefined) return <div className="h-12 animate-pulse rounded-2xl bg-black/5" aria-busy="true" />;

  if (me) {
    return (
      <div>
        <p className="text-[0.8rem] text-ink-soft">
          Signed in as <strong>{me.name}</strong>.{" "}
          <Link to="/account" className="font-semibold text-brand hover:underline">My vouchers</Link>
        </p>
        <label className="mt-3 block text-sm font-medium">
          Quantity
          <select className={inputClass} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))}>
            {options.map((n) => (
              <option key={n} value={n}>{n} — {money(priceCents * n)}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={pay}
          disabled={busy}
          className="mt-3 w-full rounded-full bg-brand px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
        >
          {busy ? "Opening checkout…" : `Pay ${vendorName} ${money(priceCents * quantity)}`}
        </button>
        {message && <p role="alert" className="mt-2 text-[0.8rem] text-rose-700">{message}</p>}
      </div>
    );
  }

  return (
    <form onSubmit={onAuth} noValidate>
      <p className="text-sm font-semibold text-brand-dark">{mode === "register" ? "Create a free account to buy" : "Sign in to buy"}</p>
      <p className="mt-1 text-[0.75rem] text-ink-soft">Your voucher lives in your account. The business only sees your name and voucher code.</p>
      {mode === "register" && (
        <label className="mt-3 block text-sm font-medium">Name<input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />{fields.name && <span className="text-[0.75rem] text-rose-700">{fields.name}</span>}</label>
      )}
      <label className="mt-3 block text-sm font-medium">Email<input type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />{fields.email && <span className="text-[0.75rem] text-rose-700">{fields.email}</span>}</label>
      <label className="mt-3 block text-sm font-medium">Password<input type="password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} />{fields.password && <span className="text-[0.75rem] text-rose-700">{fields.password}</span>}</label>
      <button disabled={busy} className="mt-4 w-full rounded-full bg-brand px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60">
        {busy ? "One moment…" : mode === "register" ? "Create account" : "Sign in"}
      </button>
      {message && <p role="alert" className="mt-2 text-[0.8rem] text-rose-700">{message}</p>}
      <button type="button" className="mt-3 text-[0.8rem] font-semibold text-brand hover:underline" onClick={() => { setMode(mode === "register" ? "login" : "register"); setMessage(null); setFields({}); }}>
        {mode === "register" ? "Already have an account? Sign in" : "New here? Create an account"}
      </button>
    </form>
  );
}
