import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { Icon } from "~/components/icons";
import { MarketplaceShell } from "~/components/site-chrome";
import { CATEGORIES, CITIES, SITE } from "~/lib/taxonomy";
import { TIERS } from "~/lib/tiers";
import { fetchVendorMe, vendorSignup } from "~/server/vendor-functions";

export const Route = createFileRoute("/vendor/signup")({
  head: () => ({
    meta: [{ title: "Create a vendor account | Shop My Neighborhood" }],
  }),
  loader: () => fetchVendorMe(),
  component: SignupPage,
});

const inputClass =
  "mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/25 focus:outline-none";
const labelClass = "block text-[0.72rem] font-semibold text-ink";

function SignupPage() {
  const me = Route.useLoaderData();
  const router = useRouter();
  const signup = useServerFn(vendorSignup);

  const [form, setForm] = useState({
    businessName: "",
    citySlug: "",
    categorySlug: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
    tier: "starter",
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setFields({});
    setMessage(null);
    try {
      const result = await signup({ data: form });
      if (result.ok) {
        await router.invalidate();
        // Billing connected: go straight to Stripe's hosted page to pay for the
        // chosen tier. Nothing is charged until the card is entered there.
        if (result.checkoutUrl) {
          window.location.assign(result.checkoutUrl);
          return;
        }
        // Billing not connected: the account exists and the dashboard explains
        // that a plan still has to be chosen once payments are switched on.
        await router.navigate({ to: "/vendor/dashboard" });
        return;
      }
      setFields(result.fields);
      setMessage(result.message);
    } catch {
      setMessage("Something went wrong creating your account. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <MarketplaceShell vendorName={me?.businessName}>
      <div className="mx-auto max-w-5xl px-4 pt-8">
        <nav className="text-[0.72rem] text-ink-soft">
          <Link to="/vendor" className="hover:text-brand">
            For Vendors
          </Link>
          <span className="mx-1.5">/</span>
          <span className="text-ink">Create your account</span>
        </nav>

        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div>
            <h1 className="font-display text-2xl font-semibold text-brand-dark sm:text-3xl">
              Create your vendor account
            </h1>
            <p className="mt-2 text-sm text-ink-soft">
              One account per business. You can create and edit deals as soon as you&apos;re in.
            </p>

            <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-[0.78rem] leading-snug text-amber-900">
              <span className="font-bold">
                Your plan starts when billing goes live — no card has been charged.
              </span>{" "}
              We record the plan you choose today and don&apos;t ask for payment details, because
              payments aren&apos;t connected yet.
            </div>

            {me && (
              <p className="mt-3 rounded-xl bg-brand/5 px-3 py-2 text-[0.78rem] text-ink-soft">
                You&apos;re currently signed in as <strong>{me.businessName}</strong>. Signing up again
                creates a second, separate business account.
              </p>
            )}

            <form onSubmit={onSubmit} className="mt-5 grid gap-4" noValidate>
              <div>
                <label htmlFor="businessName" className={labelClass}>
                  Business name
                </label>
                <input
                  id="businessName"
                  className={inputClass}
                  value={form.businessName}
                  onChange={(e) => set("businessName", e.target.value)}
                  autoComplete="organization"
                  placeholder="Lakeside Coffee Co."
                  aria-invalid={Boolean(fields.businessName)}
                />
                {fields.businessName && (
                  <p className="mt-1 text-[0.72rem] font-medium text-red-600">{fields.businessName}</p>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="citySlug" className={labelClass}>
                    City
                  </label>
                  <select
                    id="citySlug"
                    className={inputClass}
                    value={form.citySlug}
                    onChange={(e) => set("citySlug", e.target.value)}
                    aria-invalid={Boolean(fields.citySlug)}
                  >
                    <option value="">Choose a city…</option>
                    {CITIES.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {fields.citySlug && (
                    <p className="mt-1 text-[0.72rem] font-medium text-red-600">{fields.citySlug}</p>
                  )}
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
                    aria-invalid={Boolean(fields.categorySlug)}
                  >
                    <option value="">Choose a category…</option>
                    {CATEGORIES.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {fields.categorySlug && (
                    <p className="mt-1 text-[0.72rem] font-medium text-red-600">{fields.categorySlug}</p>
                  )}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="email" className={labelClass}>
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    inputMode="email"
                    className={inputClass}
                    value={form.email}
                    onChange={(e) => set("email", e.target.value)}
                    autoComplete="email"
                    placeholder="you@yourbusiness.com"
                    aria-invalid={Boolean(fields.email)}
                  />
                  {fields.email && (
                    <p className="mt-1 text-[0.72rem] font-medium text-red-600">{fields.email}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="phone" className={labelClass}>
                    Phone <span className="font-normal text-ink-soft">(optional)</span>
                  </label>
                  <input
                    id="phone"
                    type="tel"
                    inputMode="tel"
                    className={inputClass}
                    value={form.phone}
                    onChange={(e) => set("phone", e.target.value)}
                    autoComplete="tel"
                    placeholder="352-555-0123"
                    aria-invalid={Boolean(fields.phone)}
                  />
                  {fields.phone && (
                    <p className="mt-1 text-[0.72rem] font-medium text-red-600">{fields.phone}</p>
                  )}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="password" className={labelClass}>
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    className={inputClass}
                    value={form.password}
                    onChange={(e) => set("password", e.target.value)}
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    aria-invalid={Boolean(fields.password)}
                  />
                  {fields.password && (
                    <p className="mt-1 text-[0.72rem] font-medium text-red-600">{fields.password}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="confirmPassword" className={labelClass}>
                    Confirm password
                  </label>
                  <input
                    id="confirmPassword"
                    type="password"
                    className={inputClass}
                    value={form.confirmPassword}
                    onChange={(e) => set("confirmPassword", e.target.value)}
                    autoComplete="new-password"
                    placeholder="Type it again"
                    aria-invalid={Boolean(fields.confirmPassword)}
                  />
                  {fields.confirmPassword && (
                    <p className="mt-1 text-[0.72rem] font-medium text-red-600">
                      {fields.confirmPassword}
                    </p>
                  )}
                </div>
              </div>

              <fieldset>
                <legend className={labelClass}>Plan</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {TIERS.map((tier) => (
                    <label
                      key={tier.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 text-sm transition ${
                        form.tier === tier.id
                          ? "border-brand bg-brand/5 ring-1 ring-brand/30"
                          : "border-black/10 bg-white hover:border-brand/40"
                      }`}
                    >
                      <input
                        type="radio"
                        name="tier"
                        value={tier.id}
                        checked={form.tier === tier.id}
                        onChange={() => set("tier", tier.id)}
                        className="mt-1 h-4 w-4 accent-[#4A6FA5]"
                      />
                      <span>
                        <span className="block font-semibold text-ink">
                          {tier.name}{" "}
                          <span className="font-normal text-ink-soft">
                            {tier.id === "free" ? "$0" : `${tier.priceLabel}/mo`}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-[0.72rem] leading-snug text-ink-soft">
                          {tier.dealsLabel} ·{" "}
                          {Number.isFinite(tier.monthlyVoucherPool)
                            ? `${tier.poolLabel}`
                            : "Unlimited vouchers"}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                {fields.tier && (
                  <p className="mt-1 text-[0.72rem] font-medium text-red-600">{fields.tier}</p>
                )}
                <p className="mt-2 text-[0.72rem] text-ink-soft">
                  Nothing is charged today. You can change plan once billing is live.
                </p>
              </fieldset>

              {message && (
                <p
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[0.78rem] font-medium text-red-700"
                >
                  {message}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Creating your account…" : "Create account and continue"}
              </button>
              <p className="text-[0.72rem] text-ink-soft">
                Already have an account?{" "}
                <Link to="/vendor/login" className="font-semibold text-brand hover:underline">
                  Log in
                </Link>
                .
              </p>
            </form>
          </div>

          <aside className="space-y-4">
            <div className="rounded-3xl border border-black/5 bg-white p-5 shadow-sm">
              <h2 className="font-display text-lg font-semibold text-ink">What happens next</h2>
              <ol className="mt-3 grid gap-2 text-[0.8rem] text-ink-soft">
                {[
                  "Your account is created and you're signed in.",
                  "Your plan is recorded as chosen but unbilled.",
                  "Create your first deal and it appears in the marketplace immediately.",
                ].map((line, i) => (
                  <li key={line} className="flex gap-2">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand/10 text-[0.62rem] font-bold text-brand-dark">
                      {i + 1}
                    </span>
                    <span>{line}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="rounded-3xl bg-brand-dark p-5 text-white shadow-sm">
              <p className="flex items-center gap-2 font-display text-lg font-semibold">
                <Icon name="check" className="h-4 w-4 text-brand-green" />
                No commission, ever
              </p>
              <p className="mt-2 text-[0.8rem] leading-relaxed text-white/85">
                You keep 100% of voucher revenue. The flat monthly plan is the only fee.
              </p>
              <p className="mt-3 text-[0.72rem] text-white/70">
                Help: <a className="underline" href={`mailto:${SITE.email}`}>{SITE.email}</a>
              </p>
            </div>
          </aside>
        </div>
      </div>
    </MarketplaceShell>
  );
}
