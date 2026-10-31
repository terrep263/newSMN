import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type ReactNode } from "react";

import { Icon } from "~/components/icons";
import { MarketplaceShell } from "~/components/site-chrome";
import { vendorLogout } from "~/server/vendor-functions";

export type VendorTab = "dashboard" | "deals" | "redeem" | "trial";

const TABS: { id: VendorTab; to: string; label: string }[] = [
  { id: "dashboard", to: "/vendor/dashboard", label: "Dashboard" },
  { id: "deals", to: "/vendor/deals", label: "My deals" },
  { id: "redeem", to: "/vendor/redeem", label: "Redeem a voucher" },
  { id: "trial", to: "/vendor/trial", label: "Free trial" },
];

export function LogoutButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  const logout = useServerFn(vendorLogout);
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await logout({ data: {} });
          await router.invalidate();
          await router.navigate({ to: "/vendor" });
        } finally {
          setBusy(false);
        }
      }}
      className={`shrink-0 rounded-full border border-black/15 bg-white px-3 py-1.5 text-[0.72rem] font-semibold text-ink-soft transition hover:border-brand hover:text-brand disabled:opacity-60 ${className}`}
    >
      {busy ? "Logging out…" : "Log out"}
    </button>
  );
}

/** The honest notice shown everywhere a vendor could think money moved. */
export function UnbilledNotice({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-[0.78rem] leading-snug text-amber-900 ${className}`}
    >
      <p className="font-bold">Your plan starts when billing goes live — no card has been charged.</p>
      <p className="mt-1">
        Payments aren&apos;t connected yet, so nothing has been billed and no voucher money has moved.
        Everything below is demo/test data.
      </p>
    </div>
  );
}

/** Vendor page frame: marketplace chrome + the vendor tab bar. */
export function VendorShell({
  vendorName,
  tierLabel,
  active,
  children,
}: {
  vendorName: string;
  tierLabel?: string;
  active?: VendorTab;
  children: ReactNode;
}) {
  return (
    <MarketplaceShell vendorName={vendorName}>
      <div className="no-print border-b border-black/5 bg-white/80">
        <div className="mx-auto max-w-6xl px-4">
          <div className="flex items-center justify-between gap-3 pt-2.5">
            <div className="min-w-0">
              <p className="truncate text-[0.85rem] font-semibold text-brand-dark">{vendorName}</p>
              {tierLabel && (
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-ink-soft">
                  {tierLabel} plan · unbilled
                </p>
              )}
            </div>
            <LogoutButton />
          </div>
          <nav className="mt-2 flex gap-1 overflow-x-auto">
            {TABS.map((tab) => {
              const isActive = active === tab.id;
              return (
                <Link
                  key={tab.id}
                  to={tab.to}
                  className={`whitespace-nowrap rounded-t-lg px-3 py-2 text-[0.8rem] font-semibold transition ${
                    isActive
                      ? "border-b-2 border-brand text-brand-dark"
                      : "border-b-2 border-transparent text-ink-soft hover:text-brand"
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
            <Link
              to="/deals"
              className="ml-auto hidden items-center gap-1 self-center whitespace-nowrap px-3 pb-2 text-[0.75rem] font-semibold text-ink-soft hover:text-brand sm:flex"
            >
              View public marketplace
              <Icon name="arrow" className="h-3.5 w-3.5" />
            </Link>
          </nav>
        </div>
      </div>
      <main>{children}</main>
    </MarketplaceShell>
  );
}

/** Small stat block used on the dashboard and deal pages. */
export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "good" | "warn";
}) {
  const valueTone =
    tone === "good" ? "text-brand-green-dark" : tone === "warn" ? "text-amber-700" : "text-brand-dark";
  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-ink-soft">{label}</p>
      <p className={`mt-1.5 font-display text-2xl leading-none font-bold ${valueTone}`}>{value}</p>
      {hint && <p className="mt-1.5 text-[0.72rem] leading-snug text-ink-soft">{hint}</p>}
    </div>
  );
}

export function StatusPill({
  status,
}: {
  status: "published" | "paused" | "pending_payment" | "issued" | "redeemed" | "refunded" | "expired";
}) {
  const map: Record<string, [string, string]> = {
    published: ["bg-brand-green/15 text-brand-green-dark ring-brand-green/30", "Live"],
    paused: ["bg-amber-100 text-amber-900 ring-amber-300", "Paused"],
    pending_payment: ["bg-amber-100 text-amber-900 ring-amber-300", "Awaiting payment"],
    issued: ["bg-brand/10 text-brand-dark ring-brand/25", "Issued"],
    redeemed: ["bg-black/5 text-ink-soft ring-black/10", "Redeemed"],
    refunded: ["bg-rose-100 text-rose-900 ring-rose-300", "Refunded"],
    expired: ["bg-black/5 text-ink-soft ring-black/10", "Promo expired"],
  };
  const [cls, text] = map[status] ?? map.paused;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-[0.1em] ring-1 ${cls}`}
    >
      {text}
    </span>
  );
}

/** Usage bar for "2 of 3 active deals" style counters. */
export function UsageBar({
  used,
  limit,
  suffix,
}: {
  used: number;
  limit: number | null;
  suffix?: string;
}) {
  const unlimited = limit === null;
  const pct = unlimited || limit === 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between text-[0.75rem] font-medium text-ink-soft">
        <span>
          <span className="font-bold text-brand-dark">{used}</span> of{" "}
          {unlimited ? "unlimited" : limit} {suffix}
        </span>
        {!unlimited && <span className="text-ink-soft/70">{Math.max(0, (limit ?? 0) - used)} left</span>}
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/10">
        <div
          className="h-full rounded-full bg-brand-green"
          style={{ width: unlimited ? "35%" : `${pct}%`, opacity: unlimited ? 0.5 : 1 }}
        />
      </div>
    </div>
  );
}
