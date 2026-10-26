/**
 * Voucher rules engine — behavioural verification matrix.
 *
 * Runs the real server code (deal rules, deal saving/publishing, voucher
 * purchase, vendor webhook, redemption, refunds, audit trail) against a
 * THROWAWAY SQLite database and asserts each case, printing PASS/FAIL with the
 * message the server code returned. Exits non-zero if any case fails.
 *
 *   bun run scripts/verify-voucher-flow.ts
 *
 * SAFETY: MARKETPLACE_DB_PATH is pointed at .data/verify.db *before* the DB
 * module is imported, and the script refuses to run if that resolves to the
 * live database (.data/marketplace.db). It deletes the throwaway file first, so
 * every run starts from an empty database. Nothing here touches production.
 */

import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// import.meta.dir is Bun-only; the URL form type-checks without @types/bun.
const SITE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const VERIFY_DB = resolve(SITE_ROOT, ".data", "verify.db");
const LIVE_DB = resolve(SITE_ROOT, ".data", "marketplace.db");

if (VERIFY_DB === LIVE_DB) {
  throw new Error(`refusing to run: verify path resolved to the live database (${LIVE_DB})`);
}
process.env.MARKETPLACE_DB_PATH = VERIFY_DB;
mkdirSync(dirname(VERIFY_DB), { recursive: true });
for (const file of [VERIFY_DB, `${VERIFY_DB}-wal`, `${VERIFY_DB}-shm`]) {
  rmSync(file, { force: true });
}

// Imported after the env var is set: db.ts reads MARKETPLACE_DB_PATH at load.
const dbModule = await import("../src/server/db");
const { createVoucher, getDealById, getDealBySlug, getVoucherRaw, listDeals } = await import(
  "../src/server/repository"
);
const {
  createDealForVendor,
  getVendorById,
  insertVendor,
  redeemVoucherForVendor,
  refundVoucherForVendor,
  confirmVoucherForVendor,
  setDealStatus,
  setSubscription,
  updateDealForVendor,
  voucherTrailForVendor,
} = await import("../src/server/vendors");

// Types come from the functions themselves: a dynamic import cannot destructure
// type-only exports.
type Vendor = Parameters<typeof createDealForVendor>[0];
type DealDraft = Parameters<typeof createDealForVendor>[1];
const { getVoucherEvents, localDay } = await import("../src/server/voucher-lifecycle");
const { signPayload } = await import("../src/server/webhooks");
const { handleVendorWebhook } = await import("../src/server/vendor-webhook");

if (dbModule.DB_FILE !== VERIFY_DB) {
  throw new Error(`wrong database: db.ts opened ${dbModule.DB_FILE}, expected ${VERIFY_DB}`);
}

const getDb = dbModule.getDb;

// ------------------------------------------------------------------ harness

class Failed extends Error {}

type CaseOutcome = { n: number; name: string; ok: boolean; detail: string };
const outcomes: CaseOutcome[] = [];

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Failed(message);
}

function expectEqual<T>(actual: T, expectedValue: T, what: string): void {
  if (actual !== expectedValue) {
    throw new Failed(`${what}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actual)}`);
  }
}

async function runCase(n: number, name: string, fn: () => Promise<string> | string): Promise<void> {
  try {
    const detail = await fn();
    outcomes.push({ n, name, ok: true, detail });
    console.log(`PASS  ${String(n).padStart(2, " ")}. ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    const detail = err instanceof Failed ? err.message : `threw: ${(err as Error).message}`;
    outcomes.push({ n, name, ok: false, detail });
    console.log(`FAIL  ${String(n).padStart(2, " ")}. ${name}\n         server said: ${detail}`);
  }
}

const DAY_MS = 86_400_000;

/** ISO timestamp `days` from today, at 12:00 UTC (midday, so no date shift). */
function dayTs(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10) + "T12:00:00.000Z";
}

const TODAY = localDay().isoDay;
const TODAY_WEEKDAY = localDay().weekdayKey;
const ALL_WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const FINE_PRINT =
  "One voucher per visit. Valid for the item described above. Not valid with other offers. " +
  "The paid value never expires; the promotional discount expires at the end of the redemption window.";
const PAYMENT_LINK = "https://buy.stripe.com/test_verify?utm_source=flyer&ref=deals-page";

// ------------------------------------------------------------------- setup

const vendorRow = insertVendor({
  businessName: "Verify Test Kitchen",
  citySlug: "tavares",
  categorySlug: "restaurants-cafes",
  email: "verify-vendor@example.com",
  phone: null,
  tier: "pro",
  passwordHash: "not-a-real-password-hash",
});
setSubscription(vendorRow.id, { status: "active" });
const VENDOR = getVendorById(vendorRow.id) as Vendor;
console.log(
  `\nThrowaway DB: ${VERIFY_DB}\nTest vendor: #${VENDOR.id} ${VENDOR.business_name} ` +
    `(tier ${VENDOR.tier}, subscription ${VENDOR.subscription_status})\n`,
);

function baseDraft(overrides: Partial<DealDraft> = {}): DealDraft {
  return {
    title: "Verify Flow Tasting Menu",
    description:
      "A verification deal created by the test script to exercise every voucher rule end to end.",
    highlights: ["Six courses", "House-made pasta"],
    finePrint: FINE_PRINT,
    priceCents: 4000,
    valueCents: 10000,
    voucherLimit: 50,
    categorySlug: "restaurants-cafes",
    citySlug: "tavares",
    startsAt: null,
    endsAt: null,
    perCustomerLimit: 1,
    redemptionStart: dayTs(-3),
    redemptionEnd: dayTs(45),
    validDays: [],
    blackoutDates: [],
    redemptionInstructions: "Show your voucher code to your server when you order.",
    paymentLinkUrl: PAYMENT_LINK,
    webhookUrl: "https://vendor.example.com/hooks/smn",
    acceptTerms: true,
    ...overrides,
  };
}

function setDealColumns(dealId: number, sql: string, ...args: (string | number | null)[]) {
  getDb().query(`UPDATE deals SET ${sql} WHERE id = ?`).run(...args, dealId);
}

function voucherRowOf(code: string) {
  const voucher = getVoucherRaw(code);
  if (!voucher) throw new Failed(`voucher ${code} disappeared from the database`);
  return voucher;
}

/** Asserts a call was refused and that its message contains `fragment`. */
function expectRefusal(
  result: { ok: boolean; message?: string; error?: string },
  fragment: RegExp,
  label: string,
): string {
  if (result.ok) throw new Failed(`${label}: expected a refusal, but the server allowed it`);
  const message = result.message ?? "(no message)";
  if (!fragment.test(message)) {
    throw new Failed(
      `${label}: expected the message to match ${String(fragment)}, server said: "${message}"`,
    );
  }
  return message;
}

// ------------------------------------------------------------------- cases

let dealMainId = 0;
let dealMainSlug = "";
let voucherCase6 = "";
let voucherIssued = "";
let voucherPaidValue = "";

await runCase(1, "a discount below 20% is refused, with the discount message", () => {
  const result = createDealForVendor(
    VENDOR,
    baseDraft({ title: "Barely A Discount", priceCents: 9000, valueCents: 10000 }),
  );
  if (result.ok) throw new Failed("expected the save to be refused, but it was accepted");
  const price = result.fields?.price ?? "";
  expect(Boolean(price), `expected a price error, server fields: ${JSON.stringify(result.fields)}`);
  expect(
    /at least 20% below the stated value/.test(price),
    `expected the discount message, server said: "${price}"`,
  );
  return price;
});

await runCase(2, "a redemption window under 14 days is refused", () => {
  const result = createDealForVendor(
    VENDOR,
    baseDraft({
      title: "Short Window",
      redemptionStart: dayTs(1),
      redemptionEnd: dayTs(14), // 13 days
    }),
  );
  if (result.ok) throw new Failed("expected the save to be refused, but it was accepted");
  const end = result.fields?.redemptionEnd ?? "";
  expect(Boolean(end), `expected a redemptionEnd error, server fields: ${JSON.stringify(result.fields)}`);
  expect(/at least 14 days long/.test(end), `expected the window message, server said: "${end}"`);
  return end;
});

await runCase(3, "publishing a deal with no payment_link_url is refused", () => {
  const saved = createDealForVendor(
    VENDOR,
    baseDraft({ title: "No Payment Link", acceptTerms: true }),
  );
  if (!saved.ok) throw new Failed(`could not create the deal: ${JSON.stringify(saved.fields ?? saved)}`);
  // The save path refuses an empty link, so clear it the way a legacy row would
  // look — this is the state publish must defend against.
  setDealColumns(saved.id, "payment_link_url = NULL, status = 'paused'");
  const published = setDealStatus(VENDOR, saved.id, "published");
  if (published.ok) throw new Failed("expected publish to be refused, but it succeeded");
  expect(
    /payment link/i.test(published.error),
    `expected the payment-link message, server said: "${published.error}"`,
  );
  return published.error;
});

await runCase(4, "publishing without terms_accepted_at is refused; accepting them allows publish", () => {
  const saved = createDealForVendor(
    VENDOR,
    baseDraft({ title: "No Terms Accepted", acceptTerms: false }),
  );
  if (!saved.ok) throw new Failed(`could not create the deal: ${JSON.stringify(saved.fields ?? saved)}`);
  expect(
    saved.published === false,
    "expected the deal to be saved as a draft when the terms are not accepted",
  );

  const blocked = setDealStatus(VENDOR, saved.id, "published");
  if (blocked.ok) throw new Failed("expected publish to be refused without accepted terms");
  expect(
    /Accept the voucher terms/.test(blocked.error),
    `expected the terms message, server said: "${blocked.error}"`,
  );

  const accepted = updateDealForVendor(
    VENDOR,
    saved.id,
    baseDraft({ title: "No Terms Accepted", acceptTerms: true }),
  );
  if (!accepted.ok) throw new Failed(`could not accept the terms: ${JSON.stringify(accepted.fields ?? accepted)}`);

  const published = setDealStatus(VENDOR, saved.id, "published");
  if (!published.ok) throw new Failed(`expected publish to succeed after accepting terms: ${published.error}`);
  expectEqual(published.status, "published", "deal status");
  return `refused with "${blocked.error.slice(0, 48)}…", then published once terms were accepted`;
});

await runCase(5, "a validation-valid deal publishes and appears in the public listing query", () => {
  const saved = createDealForVendor(VENDOR, baseDraft({ title: "Verify Flow Tasting Menu" }));
  if (!saved.ok) throw new Failed(`expected the save to succeed: ${JSON.stringify(saved.fields ?? saved)}`);
  expect(saved.published === true, "expected the deal to publish immediately when the plan is active and terms accepted");
  dealMainId = saved.id;
  dealMainSlug = saved.slug;

  const listed = listDeals().some((deal) => deal.slug === dealMainSlug);
  expect(listed, `deal ${dealMainSlug} is missing from listDeals() — the public listing query`);
  const direct = getDealBySlug(dealMainSlug);
  expectEqual(direct?.status, "published", "public deal status");
  return `${dealMainSlug} published (id ${dealMainId}) and listed publicly`;
});

await runCase(6, "a purchase creates a pending voucher with a code + ORD- ref and a safe payment URL", () => {
  const result = createVoucher({
    slug: dealMainSlug,
    buyerName: "Ada Buyer",
    buyerEmail: "ada@example.com",
    quantity: 1,
  });
  if (!result.ok) throw new Failed(`purchase refused: ${result.error} ${result.message ?? ""}`);
  voucherCase6 = result.code;

  const voucher = voucherRowOf(result.code);
  expectEqual(voucher.status, "pending_payment", "voucher status");
  expect(/^SMN-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(voucher.code), `code shape: ${voucher.code}`);
  expect(/^ORD-[A-Z0-9]{6}$/.test(result.orderRef), `order reference shape: ${result.orderRef}`);

  const url = result.paymentUrl;
  expect(Boolean(url), "expected a payment URL for a real vendor deal");
  const parsed = new URL(url as string);
  expectEqual(parsed.searchParams.get("client_reference_id"), result.code, "payment URL client_reference_id");
  expectEqual(parsed.searchParams.get("order_ref"), result.orderRef, "payment URL order_ref");
  expect((url as string).includes(result.orderRef), `payment URL is missing the ORD- reference: ${url}`);
  expectEqual(parsed.searchParams.get("utm_source"), "flyer", "pre-existing utm_source");
  expectEqual(parsed.searchParams.get("ref"), "deals-page", "pre-existing ref");
  return `${voucher.code} / ${result.orderRef}, payment URL kept its query string`;
});

await runCase(7, "a second purchase by the same email hits the per-customer limit", () => {
  const result = createVoucher({
    slug: dealMainSlug,
    buyerName: "Ada Buyer",
    buyerEmail: "ADA@example.com",
    quantity: 1,
  });
  if (result.ok) {
    throw new Failed(`the ${1}-per-customer limit was not enforced — a second voucher (${result.code}) was created`);
  }
  expectEqual(result.error, "customer_limit", "refusal reason");
  const message = result.message ?? "";
  expect(/limited to 1 voucher per customer/.test(message), `expected the limit in the message, server said: "${message}"`);
  return message;
});

await runCase(8, "vendor webhook: bad signature rejected, correct signature issues the voucher, repeats refused", async () => {
  const secret = getDealById(dealMainId)?.webhook_secret ?? "";
  expect(secret.startsWith("whsec_"), "deal has no webhook secret");
  const body = JSON.stringify({ code: voucherCase6, event: "payment_confirmed", note: "stripe pi_123" });
  const endpoint = "http://127.0.0.1/api/webhooks/vendor";

  const bad = await handleVendorWebhook(
    new Request(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-smn-signature": signPayload(body, "whsec_wrong") },
      body,
    }),
  );
  const badBody = (await bad.json()) as { error?: string };
  expectEqual(bad.status, 401, "bad-signature status");
  expectEqual(badBody.error, "bad_signature", "bad-signature error code");
  expectEqual(voucherRowOf(voucherCase6).status, "pending_payment", "status after a rejected webhook");

  const good = await handleVendorWebhook(
    new Request(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-smn-signature": signPayload(body, secret) },
      body,
    }),
  );
  const goodBody = (await good.json()) as { applied?: boolean; status?: string; confirmed_via?: string };
  expectEqual(good.status, 200, "good-signature status");
  expectEqual(goodBody.applied, true, "good-signature applied");
  const issued = voucherRowOf(voucherCase6);
  expectEqual(issued.status, "issued", "voucher status after payment_confirmed");
  expectEqual(issued.confirmed_via, "webhook", "confirmed_via");
  expect(Boolean(issued.confirmed_at), "confirmed_at was not written");
  voucherIssued = voucherCase6;

  // Repeat: refused, not silently re-applied. The voucher stays issued and the
  // audit trail keeps exactly one payment_confirmed row.
  const repeat = await handleVendorWebhook(
    new Request(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-smn-signature": signPayload(body, secret) },
      body,
    }),
  );
  const repeatBody = (await repeat.json()) as { applied?: boolean; message?: string };
  expectEqual(repeat.status, 409, "repeat status");
  expectEqual(repeatBody.applied, false, "repeat applied");
  expectEqual(voucherRowOf(voucherCase6).status, "issued", "status after a repeat webhook");
  const confirmedEvents = getVoucherEvents(issued.id).filter((e) => e.event === "payment_confirmed").length;
  expectEqual(confirmedEvents, 1, "payment_confirmed audit rows");
  return `401 on a bad signature, 200 → issued on the real one, repeat refused with 409 ("${repeatBody.message ?? ""}")`;
});

await runCase(9, "redeeming a pending_payment voucher is refused", () => {
  const purchase = createVoucher({
    slug: dealMainSlug,
    buyerName: "Pat Pending",
    buyerEmail: "pending@example.com",
    quantity: 1,
  });
  if (!purchase.ok) throw new Failed(`purchase refused: ${purchase.error} ${purchase.message ?? ""}`);
  expectEqual(voucherRowOf(purchase.code).status, "pending_payment", "voucher status");

  const redeem = redeemVoucherForVendor(VENDOR.id, purchase.code);
  const message = expectRefusal(redeem, /hasn't been confirmed yet/, "redeeming a pending voucher");
  expectEqual(voucherRowOf(purchase.code).status, "pending_payment", "status after the refused redemption");
  return message;
});

await runCase(10, "redeeming an issued voucher succeeds, and a second redemption is refused", () => {
  const redeem = redeemVoucherForVendor(VENDOR.id, voucherIssued);
  if (!redeem.ok) throw new Failed(`expected the redemption to succeed: ${redeem.message}`);
  expectEqual(redeem.voucher.status, "redeemed", "voucher status");
  const voucher = voucherRowOf(voucherIssued);
  expectEqual(voucher.status, "redeemed", "stored status");
  expect(Boolean(voucher.redeemed_at), "redeemed_at was not written");
  expectEqual(voucher.redeemed_by_vendor_id, VENDOR.id, "redeemed_by_vendor_id");
  expectEqual(voucher.paid_value_only, 0, "paid_value_only on a normal redemption");

  const again = redeemVoucherForVendor(VENDOR.id, voucherIssued);
  const message = expectRefusal(again, /already redeemed/, "second redemption");
  return `redeemed_at ${voucher.redeemed_at} by vendor #${VENDOR.id}; second attempt: ${message}`;
});

await runCase(11, "outside the window / blackout date / non-valid weekday are each refused, with distinct messages", () => {
  const purchase = createVoucher({
    slug: dealMainSlug,
    buyerName: "Wanda Window",
    buyerEmail: "wanda@example.com",
    quantity: 1,
  });
  if (!purchase.ok) throw new Failed(`purchase refused: ${purchase.error} ${purchase.message ?? ""}`);
  const confirm = confirmVoucherForVendor(VENDOR.id, purchase.code);
  if (!confirm.ok) throw new Failed(`could not confirm the voucher: ${confirm.message}`);

  // (a) before the window opens
  setDealColumns(dealMainId, "redemption_start = ?", dayTs(3));
  const before = redeemVoucherForVendor(VENDOR.id, purchase.code);
  const beforeMsg = expectRefusal(before, /can't be used until/, "redemption before the window");

  // (b) a weekday the deal doesn't allow (every day except today)
  const otherDays = ALL_WEEKDAYS.filter((d) => d !== TODAY_WEEKDAY && d.length > 0);
  setDealColumns(dealMainId, "redemption_start = ?, valid_days = ?", dayTs(-10), JSON.stringify(otherDays));
  const weekday = redeemVoucherForVendor(VENDOR.id, purchase.code);
  const weekdayMsg = expectRefusal(weekday, /can't be used on a/, "redemption on a non-valid weekday");

  // (c) a blackout date (today, inside the window)
  setDealColumns(
    dealMainId,
    "valid_days = ?, blackout_dates = ?",
    JSON.stringify([]),
    JSON.stringify([TODAY]),
  );
  const blackout = redeemVoucherForVendor(VENDOR.id, purchase.code);
  const blackoutMsg = expectRefusal(blackout, /Blacked out on/, "redemption on a blackout date");

  expectEqual(voucherRowOf(purchase.code).status, "issued", "status after three refusals");
  expect(
    beforeMsg !== weekdayMsg && weekdayMsg !== blackoutMsg && beforeMsg !== blackoutMsg,
    "the three refusal messages must be distinct",
  );
  setDealColumns(
    dealMainId,
    "redemption_start = ?, blackout_dates = ?",
    dayTs(-3),
    JSON.stringify([]),
  );
  return `${beforeMsg} | ${weekdayMsg} | ${blackoutMsg}`;
});

await runCase(12, "refund at 23h allowed, at 25h refused with the time reason, redeemed refused", () => {
  const buy = (email: string) => {
    const result = createVoucher({
      slug: dealMainSlug,
      buyerName: "Rita Refund",
      buyerEmail: email,
      quantity: 1,
    });
    if (!result.ok) throw new Failed(`purchase refused for ${email}: ${result.error} ${result.message ?? ""}`);
    return result.code;
  };

  const inside = buy("refund-23h@example.com");
  getDb()
    .query("UPDATE vouchers SET created_at = ? WHERE code = ?")
    .run(new Date(Date.now() - 23 * 3_600_000).toISOString(), inside);
  const okRefund = refundVoucherForVendor(VENDOR.id, inside);
  if (!okRefund.ok) throw new Failed(`a refund 23 hours after purchase was refused: ${okRefund.message}`);
  expectEqual(voucherRowOf(inside).status, "refunded", "status after the allowed refund");

  const outside = buy("refund-25h@example.com");
  getDb()
    .query("UPDATE vouchers SET created_at = ? WHERE code = ?")
    .run(new Date(Date.now() - 25 * 3_600_000).toISOString(), outside);
  const lateRefund = refundVoucherForVendor(VENDOR.id, outside);
  const lateMsg = expectRefusal(lateRefund, /24-hour refund window closed/, "refund 25 hours after purchase");
  expectEqual(voucherRowOf(outside).status, "pending_payment", "status after the refused refund");

  const redeemedRefund = refundVoucherForVendor(VENDOR.id, voucherIssued);
  const redeemedMsg = expectRefusal(redeemedRefund, /was redeemed on/, "refunding a redeemed voucher");

  return `23h: refunded. 25h: "${lateMsg.slice(0, 60)}…". redeemed: "${redeemedMsg.slice(0, 60)}…"`;
});

await runCase(13, "the audit trail reads pending_created → payment_confirmed → redeemed, in order", () => {
  const trail = getVoucherEvents(voucherRowOf(voucherIssued).id).map((event) => event.event);
  const expected = ["pending_created", "payment_confirmed", "redeemed"];
  if (trail.length < expected.length || expected.some((event, i) => trail[i] !== event)) {
    throw new Failed(`audit trail was ${JSON.stringify(trail)}, expected ${JSON.stringify(expected)} first`);
  }
  const vendorTrail = voucherTrailForVendor(VENDOR.id, voucherIssued);
  expect(Boolean(vendorTrail && vendorTrail.length === trail.length), "voucherTrailForVendor disagrees with voucher_events");
  return trail.join(" → ");
});

await runCase(14, "redemption after redemption_end records a paid-value-only redemption instead of failing", () => {
  const purchase = createVoucher({
    slug: dealMainSlug,
    buyerName: "Paul Paidvalue",
    buyerEmail: "paidvalue@example.com",
    quantity: 1,
  });
  if (!purchase.ok) throw new Failed(`purchase refused: ${purchase.error} ${purchase.message ?? ""}`);
  voucherPaidValue = purchase.code;
  const confirm = confirmVoucherForVendor(VENDOR.id, voucherPaidValue);
  if (!confirm.ok) throw new Failed(`could not confirm the voucher: ${confirm.message}`);

  // The promotional window closed two days ago; the paid value never expires.
  setDealColumns(dealMainId, "redemption_start = ?, redemption_end = ?", dayTs(-60), dayTs(-2));
  const redeem = redeemVoucherForVendor(VENDOR.id, voucherPaidValue);
  if (!redeem.ok) {
    throw new Failed(
      `a redemption after redemption_end failed outright instead of recording a paid-value-only redemption: ${redeem.message}`,
    );
  }
  expectEqual(redeem.paidValueOnly, true, "paidValueOnly flag on the result");
  const voucher = voucherRowOf(voucherPaidValue);
  expectEqual(voucher.status, "redeemed", "voucher status");
  expectEqual(voucher.paid_value_only, 1, "paid_value_only");
  expect(Boolean(voucher.redeemed_at), "redeemed_at was not written");
  const last = getVoucherEvents(voucher.id).at(-1);
  expectEqual(last?.event, "redeemed", "last audit event");
  expect(
    /Paid-value-only redemption/.test(last?.note ?? ""),
    `expected the audit note to record a paid-value-only redemption, got: "${last?.note ?? ""}"`,
  );
  return `redeemed at paid value only (${(voucher.amount_cents / 100).toFixed(2)}), audit note recorded`;
});

// ------------------------------------------------------------------ summary

const failed = outcomes.filter((outcome) => !outcome.ok);
const total = outcomes.length;
console.log(
  `\n${total - failed.length}/${total} cases passed` +
    (failed.length ? ` — FAILED: ${failed.map((f) => String(f.n)).join(", ")}` : " — all green"),
);
console.log(`Database used: ${dbModule.DB_FILE}`);
if (failed.length > 0) {
  for (const outcome of failed) console.error(`\nFAIL ${outcome.n}. ${outcome.name}\n  ${outcome.detail}`);
  process.exit(1);
}
process.exit(0);
