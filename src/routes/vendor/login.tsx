import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { MarketplaceShell } from "~/components/site-chrome";
import { SITE } from "~/lib/taxonomy";
import { fetchVendorMe, vendorLogin } from "~/server/vendor-functions";

export const Route = createFileRoute("/vendor/login")({
  head: () => ({
    meta: [{ title: "Vendor log in | Shop My Neighborhood" }],
  }),
  loader: () => fetchVendorMe(),
  component: LoginPage,
});

const inputClass =
  "mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/25 focus:outline-none";

function LoginPage() {
  const me = Route.useLoaderData();
  const router = useRouter();
  const login = useServerFn(vendorLogin);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setFields({});
    setMessage(null);
    try {
      const result = await login({ data: { email, password } });
      if (result.ok) {
        await router.invalidate();
        await router.navigate({ to: "/vendor/dashboard" });
        return;
      }
      setFields(result.fields ?? {});
      setMessage(result.message);
    } catch {
      setMessage("Something went wrong logging in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <MarketplaceShell vendorName={me?.businessName}>
      <div className="mx-auto max-w-md px-4 pt-10">
        <nav className="text-[0.72rem] text-ink-soft">
          <Link to="/vendor" className="hover:text-brand">
            For Vendors
          </Link>
          <span className="mx-1.5">/</span>
          <span className="text-ink">Log in</span>
        </nav>

        <h1 className="mt-4 font-display text-2xl font-semibold text-brand-dark sm:text-3xl">
          Vendor log in
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          Sign in to manage your deals, see vouchers sold and redeem customer codes.
        </p>

        {me && (
          <p className="mt-4 rounded-xl bg-brand/5 px-3 py-2 text-[0.8rem] text-ink-soft">
            You&apos;re already signed in as <strong>{me.businessName}</strong>.{" "}
            <Link to="/vendor/dashboard" className="font-semibold text-brand hover:underline">
              Go to your dashboard
            </Link>
            .
          </p>
        )}

        <form onSubmit={onSubmit} className="mt-6 grid gap-4" noValidate>
          <div>
            <label htmlFor="email" className="block text-[0.72rem] font-semibold text-ink">
              Email
            </label>
            <input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourbusiness.com"
              aria-invalid={Boolean(fields.email)}
            />
            {fields.email && (
              <p className="mt-1 text-[0.72rem] font-medium text-red-600">{fields.email}</p>
            )}
          </div>
          <div>
            <label htmlFor="password" className="block text-[0.72rem] font-semibold text-ink">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(fields.password)}
            />
            {fields.password && (
              <p className="mt-1 text-[0.72rem] font-medium text-red-600">{fields.password}</p>
            )}
          </div>

          {message && (
            <p
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[0.8rem] font-medium text-red-700"
            >
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Log in"}
          </button>
        </form>

        <div className="mt-5 rounded-2xl border border-black/10 bg-white p-4 text-[0.78rem] leading-relaxed text-ink-soft shadow-sm">
          <p className="font-semibold text-ink">Password reset isn&apos;t live yet.</p>
          <p className="mt-1">
            If you&apos;re locked out or forgot your password, email{" "}
            <a className="font-semibold text-brand hover:underline" href={`mailto:${SITE.email}`}>
              {SITE.email}
            </a>{" "}
            or call {SITE.phone} and we&apos;ll sort it out by hand. Repeated failed logins on the same
            email are slowed down for a few minutes.
          </p>
        </div>

        <p className="mt-5 text-[0.8rem] text-ink-soft">
          New here?{" "}
          <Link to="/vendor/signup" className="font-semibold text-brand hover:underline">
            Create a vendor account
          </Link>
          .
        </p>
      </div>
    </MarketplaceShell>
  );
}
