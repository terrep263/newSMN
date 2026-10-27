// SERVER-ONLY (never import from a route or component; reach it through listing-claim-functions). Directory listing ownership and owner review. Every vendor action
// resolves its identity from the signed session cookie; a browser never supplies a vendor id.
import { getCookie, setCookie } from "@tanstack/react-start/server";
import type { Vendor } from "./vendors";
import { claimDecisionEmail, sendMailInBackground } from "./mail";

export type ClaimStatus = "pending" | "approved" | "rejected";
export type ClaimSummary = {
  id: number; status: ClaimStatus; method: "auto_domain" | "manual"; created_at: string;
  decided_at: string | null; decided_note: string | null; business_name: string; business_slug: string;
};
export type ClaimSearchBusiness = {
  id: number; name: string; slug: string; city_name: string; city_slug: string; website: string | null;
  is_claimed: number;
};
export type OwnedListing = {
  id: number; slug: string; name: string; city_name: string; city_slug: string;
  opening_hours: string | null; phone: string | null; website: string | null; description: string | null;
  photo_id: number | null;
};
export type SubmitClaimResult = { ok: true; status: ClaimStatus; message: string } | { ok: false; message: string };
export type OwnedListingUpdate = {
  /** Optional defensive target: a supplied id must belong to the signed-in owner. */
  businessId?: number;
  openingHours?: string; phone?: string; website?: string; description?: string;
};

export const ADMIN_COOKIE = "smn_claim_admin";

export async function sessionVendor() {
  const auth = await import("./auth");
  return auth.currentVendor();
}

function websiteDomain(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    const host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
    return host.replace(/^www\./, "") || null;
  } catch { return null; }
}
function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase().replace(/^www\./, "") || null;
}
export function shortText(value: unknown, max: number): string | null {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text ? text.slice(0, max) : null;
}
function safeWebsite(value: unknown): string | null {
  const text = shortText(value, 500);
  if (!text) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch { return null; }
}

/** Core claim operation shared by the authenticated server function and verifier. */
export async function submitListingClaimForVendor(
  vendor: Pick<Vendor, "id" | "email">,
  data: { businessId: number; proofNote?: string },
): Promise<SubmitClaimResult> {
  const { getDb } = await import("./db");
  const db = getDb();
  const businessId = Number(data.businessId);
  if (!Number.isInteger(businessId) || businessId < 1)
    return { ok: false, message: "Choose a business from the directory results." };
  const proofNote = shortText(data.proofNote, 500);
  const outcome = db.transaction(() => {
    const business = db.query<{ id: number; name: string; website: string | null; is_claimed: number }, [number]>(
      "SELECT id, name, website, is_claimed FROM businesses WHERE id = ?",
    ).get(businessId);
    if (!business) return { ok: false as const, message: "That directory listing is no longer available." };
    if (business.is_claimed) return { ok: false as const, message: "This business has already been claimed." };
    const existing = db.query<{ id: number }, [number, number]>("SELECT id FROM listing_claims WHERE vendor_id = ? AND business_id = ?").get(vendor.id, businessId);
    if (existing) return { ok: false as const, message: "You have already submitted a claim for this business." };
    const pending = db.query<{ id: number }, [number]>("SELECT id FROM listing_claims WHERE vendor_id = ? AND status = 'pending'").get(vendor.id);
    if (pending) return { ok: false as const, message: "You already have a claim awaiting review. Please wait for a decision before claiming another listing." };
    const active = db.query<{ id: number }, [number]>("SELECT id FROM listing_claims WHERE business_id = ? AND status IN ('pending', 'approved')").get(businessId);
    if (active) return { ok: false as const, message: "This business already has a claim in progress." };
    const automatic = emailDomain(vendor.email) !== null && emailDomain(vendor.email) === websiteDomain(business.website);
    const now = new Date().toISOString();
    const status: ClaimStatus = automatic ? "approved" : "pending";
    const method = automatic ? "auto_domain" : "manual";
    db.query(
      "INSERT INTO listing_claims (business_id, vendor_id, status, method, proof_note, created_at, decided_at, decided_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(businessId, vendor.id, status, method, proofNote, now, automatic ? now : null, automatic ? "Approved automatically: account email domain matches the listing website." : null);
    if (automatic) {
      const changed = db.query("UPDATE businesses SET is_claimed = 1, claimed_by_vendor_id = ?, updated_at = ? WHERE id = ? AND is_claimed = 0").run(vendor.id, now, businessId);
      if (changed.changes !== 1) throw new Error("This business was claimed at the same time. Please refresh and try again.");
    }
    return automatic
      ? { ok: true as const, status, message: "Your account email domain matches this listing's website, so your claim has been approved." }
      : { ok: true as const, status, message: "Your claim is awaiting review. Shop My Neighborhood will review it and contact you at your account email." };
  });
  try {
    const result = outcome();
    if (result.ok && result.status === "approved") {
      const named = db.query<{ name: string }, [number]>("SELECT name FROM businesses WHERE id = ?").get(businessId);
      sendMailInBackground(claimDecisionEmail({ to: vendor.email, businessName: named?.name ?? "your business", approved: true }));
    }
    return result;
  } catch (error) {
    const message = error instanceof Error && error.message.includes("UNIQUE")
      ? "This business already has a claim in progress, or you already have a claim awaiting review."
      : error instanceof Error ? error.message : "We couldn't submit that claim.";
    return { ok: false, message };
  }
}

/** Lookup used by the route and verifier; ownership is checked in the SQL predicate. */
export async function ownedListingForVendor(vendorId: number): Promise<OwnedListing | null> {
  const { getDb } = await import("./db");
  return getDb().query<OwnedListing, [number]>(
    `SELECT b.id, b.slug, b.name, b.city_name, b.city_slug, b.opening_hours, b.phone, b.website, b.description, b.photo_id
       FROM businesses b JOIN listing_claims c ON c.business_id = b.id
      WHERE c.vendor_id = ? AND c.status = 'approved' AND b.is_claimed = 1 AND b.claimed_by_vendor_id = ?
      ORDER BY c.decided_at DESC LIMIT 1`,
  ).get(vendorId, vendorId) ?? null;
}

/** Core edit operation. A caller-supplied id is never trusted: it must match the owner. */
export async function updateOwnedListingForVendor(
  vendor: Pick<Vendor, "id">,
  data: OwnedListingUpdate,
): Promise<{ ok: boolean; message: string }> {
  const { getDb } = await import("./db"); const db = getDb();
  const openingHours = shortText(data.openingHours, 300);
  const phone = shortText(data.phone, 40);
  const description = shortText(data.description, 800);
  const rawWebsite = shortText(data.website, 500);
  const website = safeWebsite(rawWebsite);
  if (rawWebsite && !website) return { ok: false, message: "Enter a valid website URL." };
  if (phone && !/^[0-9+()\-.\s]+$/.test(phone)) return { ok: false, message: "Use a valid phone number." };
  const suppliedId = data.businessId === undefined ? null : Number(data.businessId);
  if (suppliedId !== null && (!Number.isInteger(suppliedId) || suppliedId < 1))
    return { ok: false, message: "Choose the approved listing assigned to your account." };
  const target = suppliedId === null
    ? "(SELECT business_id FROM listing_claims WHERE vendor_id = ? AND status = 'approved' ORDER BY decided_at DESC LIMIT 1)"
    : "?";
  const args: (string | number | null)[] = [openingHours, phone, website, description, new Date().toISOString()];
  if (suppliedId === null) args.push(vendor.id); else args.push(suppliedId);
  args.push(vendor.id);
  const result = db.query(
    `UPDATE businesses SET opening_hours = ?, phone = ?, website = ?, description = ?, updated_at = ?
      WHERE id = ${target} AND is_claimed = 1 AND claimed_by_vendor_id = ?`,
  ).run(...args);
  if (result.changes === 1) return { ok: true, message: "Your directory listing has been updated." };
  return suppliedId === null
    ? { ok: false, message: "You do not have an approved listing to edit." }
    : { ok: false, message: "You do not own that approved listing." };
}

export async function searchClaimBusinessesImpl(data: { q?: string; city?: string }): Promise<ClaimSearchBusiness[] | "unauthenticated"> {
  if (!(await sessionVendor())) return "unauthenticated";
  const { getDb } = await import("./db");
  const q = shortText(data.q, 120) ?? "";
  const city = shortText(data.city, 80) ?? "";
  if (!q && !city) return [];
  const where: string[] = ["is_claimed = 0"];
  const values: string[] = [];
  if (q) { where.push("name LIKE ? COLLATE NOCASE"); values.push(`%${q}%`); }
  if (city) { where.push("city_slug = ?"); values.push(city); }
  return getDb().query<ClaimSearchBusiness, string[]>(
    `SELECT id, name, slug, city_name, city_slug, website, is_claimed FROM businesses WHERE ${where.join(" AND ")} ORDER BY name COLLATE NOCASE LIMIT 40`,
  ).all(...values);
}

export async function fetchVendorClaimStatusImpl(): Promise<ClaimSummary | null | "unauthenticated"> {
  const vendor = await sessionVendor();
  if (!vendor) return "unauthenticated";
  const { getDb } = await import("./db");
  return getDb().query<ClaimSummary, [number]>(
    `SELECT c.id, c.status, c.method, c.created_at, c.decided_at, c.decided_note, b.name AS business_name, b.slug AS business_slug
     FROM listing_claims c JOIN businesses b ON b.id = c.business_id WHERE c.vendor_id = ? ORDER BY c.created_at DESC LIMIT 1`,
  ).get(vendor.id) ?? null;
}

function configuredAdminToken(): string | null { return process.env.ADMIN_CLAIM_TOKEN?.trim() || null; }
async function safeTokenMatch(candidate: string, secret: string): Promise<boolean> {
  const { timingSafeEqual } = await import("node:crypto");
  const a = Buffer.from(candidate); const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function adminCookieValue(secret: string): Promise<string> { const { createHmac } = await import("node:crypto"); return createHmac("sha256", secret).update("shop-my-neighborhood:claims-admin").digest("base64url"); }
export async function isAdminAuthorized(): Promise<boolean> {
  const secret = configuredAdminToken();
  if (!secret) return false;
  const value = getCookie(ADMIN_COOKIE) ?? "";
  const expected = await adminCookieValue(secret);
  const { timingSafeEqual } = await import("node:crypto");
  return value.length === expected.length && timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}
export function adminClaimsEnabled(): boolean { return Boolean(configuredAdminToken()); }

/** Server-only token decision, kept separate so it can be behaviourally verified. */
export async function adminClaimLoginForToken(token: string | undefined): Promise<{ ok: boolean; message: string }> {
  const secret = configuredAdminToken();
  if (!secret) return { ok: false, message: "Not found." };
  if (!(await safeTokenMatch(String(token ?? ""), secret))) return { ok: false, message: "That admin token is not valid." };
  return { ok: true, message: "Authorized." };
}

export async function adminClaimLoginImpl(token: string | undefined) {
  const result = await adminClaimLoginForToken(token);
  if (!result.ok) return result;
  const secret = configuredAdminToken()!;
  setCookie(ADMIN_COOKIE, await adminCookieValue(secret), { httpOnly: true, sameSite: "lax", secure: true, path: "/admin/claims", maxAge: 8 * 60 * 60 });
  return result;
}

export type AdminClaim = ClaimSummary & { vendor_email: string; proof_note: string | null };
export async function pendingListingClaims(): Promise<AdminClaim[]> {
  const { getDb } = await import("./db");
  return getDb().query<AdminClaim, []>(
    `SELECT c.id, c.status, c.method, c.proof_note, c.created_at, c.decided_at, c.decided_note,
            b.name AS business_name, b.slug AS business_slug, v.email AS vendor_email
       FROM listing_claims c JOIN businesses b ON b.id = c.business_id JOIN vendors v ON v.id = c.vendor_id
      WHERE c.status = 'pending' ORDER BY c.created_at ASC`,
  ).all();
}
export async function decideListingClaimForAdmin(
  authorized: boolean,
  data: { claimId: number; decision: "approved" | "rejected"; note?: string },
): Promise<{ ok: boolean; message: string }> {
  if (!authorized) return { ok: false, message: "Not authorized." };
  const claimId = Number(data.claimId); const decision = data.decision;
  if (!Number.isInteger(claimId) || !["approved", "rejected"].includes(decision)) return { ok: false, message: "Invalid claim decision." };
  const note = shortText(data.note, 500); const { getDb } = await import("./db"); const db = getDb();
  const action = db.transaction(() => {
    const claim = db.query<{ business_id: number; vendor_id: number }, [number]>("SELECT business_id, vendor_id FROM listing_claims WHERE id = ? AND status = 'pending'").get(claimId);
    if (!claim) return { ok: false, message: "This claim is no longer awaiting review." };
    const now = new Date().toISOString();
    if (decision === "approved") {
      const updated = db.query("UPDATE businesses SET is_claimed = 1, claimed_by_vendor_id = ?, updated_at = ? WHERE id = ? AND is_claimed = 0").run(claim.vendor_id, now, claim.business_id);
      if (updated.changes !== 1) return { ok: false, message: "This business has already been claimed." };
    }
    db.query("UPDATE listing_claims SET status = ?, decided_at = ?, decided_note = ? WHERE id = ? AND status = 'pending'").run(decision, now, note, claimId);
    return { ok: true, message: decision === "approved" ? "Claim approved and listing assigned." : "Claim rejected." };
  });
  const result = action();
  if (result.ok) {
    const who = db.query<{ email: string; name: string }, [number]>(
      "SELECT v.email AS email, b.name AS name FROM listing_claims c JOIN vendors v ON v.id = c.vendor_id JOIN businesses b ON b.id = c.business_id WHERE c.id = ?",
    ).get(claimId);
    if (who) sendMailInBackground(claimDecisionEmail({ to: who.email, businessName: who.name, approved: decision === "approved" }));
  }
  return result;
}
