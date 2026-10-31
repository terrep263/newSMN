// Deal rules — the rules a voucher deal has to meet before it can be published.
// Pure functions only (no node APIs, no DB), so the vendor form can use the very
// same checks for its live preview and inline errors that the server runs before
// saving. The server is still the authority: vendors.ts calls validateDealRules()
// and refuses the save when it returns anything.

export type Weekday = {
  /** Stored value, e.g. "mon". */
  key: string;
  /** Label the vendor and shopper see, e.g. "Mon". */
  short: string;
  /** Full name, used in redemption rejection messages. */
  name: string;
  /** JavaScript Date#getDay() number (0 = Sunday). */
  jsDay: number;
};

export const WEEKDAYS: Weekday[] = [
  { key: "sun", short: "Sun", name: "Sunday", jsDay: 0 },
  { key: "mon", short: "Mon", name: "Monday", jsDay: 1 },
  { key: "tue", short: "Tue", name: "Tuesday", jsDay: 2 },
  { key: "wed", short: "Wed", name: "Wednesday", jsDay: 3 },
  { key: "thu", short: "Thu", name: "Thursday", jsDay: 4 },
  { key: "fri", short: "Fri", name: "Friday", jsDay: 5 },
  { key: "sat", short: "Sat", name: "Saturday", jsDay: 6 },
];

export const WEEKDAY_KEYS = WEEKDAYS.map((d) => d.key);

export function weekdayByKey(key: string): Weekday | null {
  return WEEKDAYS.find((d) => d.key === key) ?? null;
}

export function weekdayByJsDay(jsDay: number): Weekday | null {
  return WEEKDAYS.find((d) => d.jsDay === jsDay) ?? null;
}

/** "Any day" / "Mon, Wed and Fri" / "Mon–Fri" when every weekday is allowed. */
export function validDaysLabel(days: string[]): string {
  const keys = WEEKDAYS.filter((d) => days.includes(d.key)).map((d) => d.key);
  if (keys.length === 0 || keys.length === WEEKDAYS.length) return "Any day";
  return WEEKDAYS.filter((d) => keys.includes(d.key))
    .map((d) => d.short)
    .join(", ");
}

/** Minimum window a deal must stay redeemable for. */
export const MIN_REDEMPTION_DAYS = 14;
/** Platform default minimum discount (percent). */
export const DEFAULT_MIN_DISCOUNT_PCT = 20;
/** A deal can never ask for fewer than 80 characters of fine print. */
export const MIN_FINE_PRINT_CHARS = 80;
/** Purchases one customer may make of the same deal. */
export const MAX_PER_CUSTOMER = 5;

const DAY_MS = 86_400_000;

export function discountPct(priceCents: number, valueCents: number): number {
  if (!Number.isFinite(priceCents) || !Number.isFinite(valueCents) || valueCents <= 0) return 0;
  return ((valueCents - priceCents) / valueCents) * 100;
}

export function money(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars)
    ? `$${dollars.toLocaleString("en-US")}`
    : `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "2026-03-04" -> "Mar 4, 2026" without pulling in a timezone shift. */
export function isoDayLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const text = iso.length > 10 ? iso.slice(0, 10) : iso;
  const d = new Date(`${text}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === value;
}

/** Days between two ISO timestamps, rounded to whole days. */
export function windowDays(startIso: string | null, endIso: string | null): number {
  if (!startIso || !endIso) return 0;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.floor((end - start) / DAY_MS);
}

export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && url.hostname.includes(".");
  } catch {
    return false;
  }
}

export type DealRulesDraft = {
  priceCents: number;
  valueCents: number;
  /** Defaults to 20 when the deal row has no value yet. */
  minDiscountPct: number;
  voucherLimit: number;
  perCustomerLimit: number;
  finePrint: string;
  redemptionInstructions: string;
  /** ISO timestamps, or null when unset. */
  redemptionStart: string | null;
  redemptionEnd: string | null;
  /** Weekday keys, empty = every day. */
  validDays: string[];
  /** YYYY-MM-DD dates. */
  blackoutDates: string[];
  paymentLinkUrl: string;
  webhookUrl: string;
  /** Free-trial deals are paid through Stripe Connect, so no payment link or webhook is checked. */
  skipPayment?: boolean;
};

/** field -> message. Empty object means every rule passed. */
export type DealRuleErrors = Record<string, string>;

/**
 * Every rule a deal has to satisfy, with one message per rule so the vendor sees
 * exactly what to change. Tier limits (per-deal cap and monthly pool) are added by
 * the caller because they need the vendor's plan.
 */
export function validateDealRules(draft: DealRulesDraft): DealRuleErrors {
  const fields: DealRuleErrors = {};
  const minPct =
    Number.isFinite(draft.minDiscountPct) && draft.minDiscountPct > 0
      ? draft.minDiscountPct
      : DEFAULT_MIN_DISCOUNT_PCT;

  // --- price and value
  if (!Number.isFinite(draft.priceCents) || draft.priceCents <= 0) {
    fields.price = "Enter a voucher price greater than $0.";
  }
  if (!Number.isFinite(draft.valueCents) || draft.valueCents <= 0) {
    fields.value = "Enter what the voucher is worth.";
  }
  if (Number.isFinite(draft.priceCents) && draft.priceCents > 0 && Number.isFinite(draft.valueCents) && draft.valueCents > 0) {
    if (draft.priceCents >= draft.valueCents) {
      fields.value = "The voucher value must be higher than the price.";
    } else {
      const pct = discountPct(draft.priceCents, draft.valueCents);
      if (pct < minPct) {
        const ceiling = Math.floor((draft.valueCents * (100 - minPct)) / 100);
        fields.price =
          `Price must be at least ${minPct}% below the stated value. ` +
          `A ${money(draft.valueCents)} voucher has to sell for ${money(ceiling)} or less ` +
          `(you're at ${pct.toFixed(1)}% off).`;
      }
    }
  }

  // --- inventory
  if (!Number.isInteger(draft.voucherLimit) || draft.voucherLimit < 1) {
    fields.voucherLimit = "Set a voucher limit of at least 1.";
  }

  if (
    !Number.isInteger(draft.perCustomerLimit) ||
    draft.perCustomerLimit < 1 ||
    draft.perCustomerLimit > MAX_PER_CUSTOMER
  ) {
    fields.perCustomerLimit = `The per-customer limit must be a whole number from 1 to ${MAX_PER_CUSTOMER}.`;
  }

  // --- redemption window
  const start = draft.redemptionStart;
  const end = draft.redemptionEnd;
  if (!start) {
    fields.redemptionStart = "Choose the first day the voucher can be redeemed.";
  } else if (Number.isNaN(new Date(start).getTime())) {
    fields.redemptionStart = "That redemption start date isn't valid.";
  }
  if (!end) {
    fields.redemptionEnd = "Choose the last day the voucher can be redeemed.";
  } else if (Number.isNaN(new Date(end).getTime())) {
    fields.redemptionEnd = "That redemption end date isn't valid.";
  }
  if (start && end && !Number.isNaN(new Date(start).getTime()) && !Number.isNaN(new Date(end).getTime())) {
    if (new Date(end).getTime() <= new Date(start).getTime()) {
      fields.redemptionEnd = "The redemption window has to end after it starts.";
    } else {
      const days = windowDays(start, end);
      if (days < MIN_REDEMPTION_DAYS) {
        fields.redemptionEnd =
          `The redemption window must be at least ${MIN_REDEMPTION_DAYS} days long — ` +
          `this one is ${days} day${days === 1 ? "" : "s"}.`;
      }
    }
  }

  // --- valid weekdays
  const unknownDays = draft.validDays.filter((d) => !WEEKDAY_KEYS.includes(d));
  if (unknownDays.length > 0) {
    fields.validDays = `Use weekday names like Mon, Tue or Wed — "${unknownDays[0]}" isn't one.`;
  }

  // --- blackout dates
  const badBlackout = draft.blackoutDates.find((d) => !isIsoDay(d));
  if (badBlackout) {
    fields.blackoutDates = `Blackout dates need to be real dates written as YYYY-MM-DD — "${badBlackout}" isn't.`;
  } else if (draft.blackoutDates.length > 0) {
    if (!start || !end) {
      fields.blackoutDates = "Set the redemption window before adding blackout dates.";
    } else {
      const startDay = start.slice(0, 10);
      const endDay = end.slice(0, 10);
      const outside = draft.blackoutDates.find((d) => d < startDay || d > endDay);
      if (outside) {
        fields.blackoutDates =
          `Blackout dates have to fall inside the redemption window ` +
          `(${isoDayLabel(startDay)} – ${isoDayLabel(endDay)}) — ${isoDayLabel(outside)} doesn't.`;
      }
    }
  }

  // --- copy
  const finePrint = draft.finePrint.trim();
  if (finePrint.length < MIN_FINE_PRINT_CHARS) {
    fields.finePrint =
      `Fine print needs at least ${MIN_FINE_PRINT_CHARS} characters so customers know the limits before they buy ` +
      `(you have ${finePrint.length}). Cover what's included, restrictions, and that the promotional value expires.`;
  } else if (finePrint.length > 1200) {
    fields.finePrint = "Fine print must be under 1,200 characters.";
  }

  if (!draft.redemptionInstructions.trim()) {
    fields.redemptionInstructions =
      "Tell the customer what to do when they arrive — show the code, mention it when booking, etc.";
  } else if (draft.redemptionInstructions.length > 500) {
    fields.redemptionInstructions = "Keep the redemption instructions under 500 characters.";
  }

  // --- how the vendor gets paid
  if (draft.skipPayment) return fields;
  const link = draft.paymentLinkUrl.trim();
  if (!link) {
    fields.paymentLinkUrl =
      "Add your payment link (Stripe, Square, PayPal — whatever you use). Customers pay you there, so a deal can't sell vouchers without it.";
  } else if (!isHttpsUrl(link)) {
    fields.paymentLinkUrl = "The payment link must be a full https:// address, like https://buy.stripe.com/abc123.";
  }

  const hook = draft.webhookUrl.trim();
  if (hook && !isHttpsUrl(hook)) {
    fields.webhookUrl = "The webhook URL must be a full https:// address, or leave it empty.";
  }

  return fields;
}

/**
 * The terms a vendor accepts before a voucher deal can be published. Kept as
 * data so the form, the stored acceptance and the public terms block all read
 * from one place.
 */
export const VOUCHER_TERMS: string[] = [
  "Voucher money is paid directly to my business on my own payment page. Shop My Neighborhood never takes, holds or refunds voucher money.",
  "The paid value of a voucher never expires. The promotional discount expires at the redemption end date I set.",
  "Each voucher is redeemable once, by the business that issued it.",
  "Refunds are only available within 24 hours of purchase, and only while the voucher has not been redeemed. I return the money through my own payment provider.",
];

/** Terms the shopper is shown before buying, in plain language. */
export const SHOPPER_PAYMENT_NOTICE =
  "You pay the business directly on their own payment page. Shop My Neighborhood never takes, holds or refunds your money.";
