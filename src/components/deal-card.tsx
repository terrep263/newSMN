import { Link } from "@tanstack/react-router";

import { CategoryIcon } from "~/components/icons";
import { categoryName, money, percentOff, type Category } from "~/lib/taxonomy";
import { CATEGORIES } from "~/lib/taxonomy";
import type { Deal } from "~/server/repository";

// Gradient artwork per image_hint. Deliberately abstract: these are sample deals,
// so no stock photography pretends to show a real business.
const PLATES: Record<string, [string, string]> = {
  coffee: ["#8a5a3b", "#c98b5e"],
  taproom: ["#2b4b7c", "#4a6fa5"],
  dental: ["#3f7f9e", "#7fc3c0"],
  handyman: ["#6b5b3e", "#b59a6a"],
  barber: ["#2f3a4a", "#6b7c91"],
  boutique: ["#7a4a6b", "#b07a9c"],
  detailing: ["#334155", "#5a7a9a"],
  office: ["#2b4b7c", "#5d86b5"],
  wellness: ["#3f8f41", "#83c98a"],
  fitness: ["#3a5a40", "#6ea86e"],
  market: ["#5c7a2e", "#9bbf5a"],
  cottage: ["#4a6fa5", "#8fb2d4"],
  default: ["#4a6fa5", "#7fa5cf"],
};

export function SampleBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-[0.12em] text-amber-900 ring-1 ring-amber-300 ${className}`}
      title="This is demo data from a fictional sample vendor — not a real business offer."
    >
      Sample deal
    </span>
  );
}

export function DealPlate({
  deal,
  className = "",
  tall = false,
}: {
  deal: Deal;
  className?: string;
  tall?: boolean;
}) {
  const [from, to] = PLATES[deal.image_hint] ?? PLATES.default;
  const category: Category | undefined = CATEGORIES.find((c) => c.slug === deal.category_slug);
  return (
    <div
      className={`deal-plate ${tall ? "aspect-[16/9]" : "aspect-[16/10]"} ${className}`}
      style={{ backgroundImage: `linear-gradient(135deg, ${from} 0%, ${to} 100%)` }}
    >
      <div className="absolute inset-0 grid place-items-center text-white/25">
        <CategoryIcon slug={deal.category_slug} className="h-16 w-16" strokeWidth={1.2} />
      </div>
      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
        <span className="rounded-full bg-white/90 px-2.5 py-1 text-[0.6rem] font-bold uppercase tracking-[0.12em] text-brand-dark backdrop-blur">
          {category?.short ?? categoryName(deal.category_slug)}
        </span>
        {deal.is_sample && <SampleBadge />}
      </div>
    </div>
  );
}

export function VouchersLeft({ deal, className = "" }: { deal: Deal; className?: string }) {
  const left = Math.max(0, deal.voucher_limit - deal.vouchers_sold);
  const pct = deal.voucher_limit > 0 ? Math.min(100, Math.round((deal.vouchers_sold / deal.voucher_limit) * 100)) : 100;
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between text-[0.72rem] font-medium text-ink-soft">
        <span>
          <span className={`font-bold ${left === 0 ? "text-red-600" : "text-brand-green-dark"}`}>{left}</span>{" "}
          {left === 1 ? "voucher" : "vouchers"} left
        </span>
        <span className="text-ink-soft/70">
          {deal.vouchers_sold} of {deal.voucher_limit} sold
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/10">
        <div
          className="h-full rounded-full bg-brand-green"
          style={{ width: `${Math.max(pct, left === 0 ? 100 : 3)}%`, opacity: left === 0 ? 0.4 : 1 }}
        />
      </div>
    </div>
  );
}

export function DealCard({ deal }: { deal: Deal }) {
  const off = percentOff(deal.price_cents, deal.value_cents);
  const left = Math.max(0, deal.voucher_limit - deal.vouchers_sold);
  return (
    <article className="group flex flex-col overflow-hidden rounded-3xl border border-black/5 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-16px_rgba(16,24,40,0.25)] transition hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(16,24,40,0.05),0_16px_36px_-18px_rgba(16,24,40,0.35)]">
      <Link to="/deals/$slug" params={{ slug: deal.slug }} className="block">
        <DealPlate deal={deal} />
      </Link>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <Link to="/deals/$slug" params={{ slug: deal.slug }} className="block">
            <h3 className="line-clamp-2 font-display text-[1.02rem] leading-snug font-semibold text-ink group-hover:text-brand-dark">
              {deal.title}
            </h3>
          </Link>
          <p className="mt-1.5 text-[0.8rem] text-ink-soft">
            {deal.vendor_name} · {deal.vendor_city}
          </p>
        </div>

        <div className="mt-auto space-y-3">
          <div className="flex items-end gap-2">
            <span className="text-xl font-bold text-brand-dark">{money(deal.price_cents)}</span>
            <span className="pb-0.5 text-sm text-ink-soft line-through">{money(deal.value_cents)}</span>
            <span className="mb-0.5 rounded-md bg-brand-green/15 px-1.5 py-0.5 text-[0.68rem] font-bold text-brand-green-dark">
              {off}% off
            </span>
          </div>
          <VouchersLeft deal={deal} />
          <Link
            to="/deals/$slug"
            params={{ slug: deal.slug }}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark"
          >
            {left === 0 ? "Sold out" : "View deal"}
          </Link>
        </div>
      </div>
    </article>
  );
}
