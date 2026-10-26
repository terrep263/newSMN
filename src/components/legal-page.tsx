import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { MarketplaceShell } from "~/components/site-chrome";

/** Date shown on every legal page. Update when the wording changes. */
export const LEGAL_UPDATED = "October 26, 2026";

/** Shared frame for the Terms, Privacy and Refund pages. */
export function LegalPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <MarketplaceShell>
      <article className="mx-auto max-w-3xl px-4 py-12">
        <p className="kicker">Legal</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-brand-dark sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 text-[0.78rem] text-ink-soft">Last updated {LEGAL_UPDATED}</p>
        <p className="mt-5 text-base leading-relaxed text-ink-soft">{intro}</p>
        <div className="mt-8 space-y-8">{children}</div>
        <nav className="mt-12 flex flex-wrap gap-x-5 gap-y-2 border-t border-black/10 pt-6 text-sm font-semibold text-brand-dark">
          <Link to="/terms" className="hover:text-brand">
            Terms
          </Link>
          <Link to="/privacy" className="hover:text-brand">
            Privacy
          </Link>
          <Link to="/refunds" className="hover:text-brand">
            Refunds
          </Link>
        </nav>
      </article>
    </MarketplaceShell>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-xl font-semibold text-brand-dark">{heading}</h2>
      <div className="mt-3 space-y-3 text-[0.95rem] leading-relaxed text-ink-soft">{children}</div>
    </section>
  );
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-brand-green-dark">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
