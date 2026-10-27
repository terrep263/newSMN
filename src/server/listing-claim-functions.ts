// Client-safe entry points. All server logic lives in ./listing-claims and is loaded
// only inside handlers so it never enters the browser bundle.
import { createServerFn } from "@tanstack/react-start";

export type {
  AdminClaim, ClaimSearchBusiness, ClaimStatus, ClaimSummary, OwnedListing, OwnedListingUpdate, SubmitClaimResult,
} from "./listing-claims";
import type {
  AdminClaim, ClaimSearchBusiness, ClaimSummary, OwnedListing, OwnedListingUpdate, SubmitClaimResult,
} from "./listing-claims";

const claims = () => import("./listing-claims");

export const searchClaimBusinesses = createServerFn({ method: "GET" })
  .validator((input: { q?: string; city?: string }) => input)
  .handler(async ({ data }): Promise<ClaimSearchBusiness[] | "unauthenticated"> => (await claims()).searchClaimBusinessesImpl(data));

export const submitListingClaim = createServerFn({ method: "POST" })
  .validator((input: { businessId: number; proofNote?: string }) => input)
  .handler(async ({ data }): Promise<SubmitClaimResult> => {
    const c = await claims();
    const vendor = await c.sessionVendor();
    if (!vendor) return { ok: false, message: "Please log in to claim a listing." };
    return await c.submitListingClaimForVendor(vendor, data);
  });

export const fetchVendorClaimStatus = createServerFn({ method: "GET" })
  .handler(async (): Promise<ClaimSummary | null | "unauthenticated"> => (await claims()).fetchVendorClaimStatusImpl());

export const fetchOwnedListing = createServerFn({ method: "GET" }).handler(async (): Promise<OwnedListing | null | "unauthenticated"> => {
  const c = await claims();
  const vendor = await c.sessionVendor();
  if (!vendor) return "unauthenticated";
  return await c.ownedListingForVendor(vendor.id);
});

export const updateOwnedListing = createServerFn({ method: "POST" })
  .validator((input: OwnedListingUpdate) => input)
  .handler(async ({ data }): Promise<{ ok: boolean; message: string }> => {
    const c = await claims();
    const vendor = await c.sessionVendor();
    if (!vendor) return { ok: false, message: "Please log in again." };
    return await c.updateOwnedListingForVendor(vendor, data);
  });

export const adminClaimSession = createServerFn({ method: "GET" }).handler(async () => {
  const c = await claims();
  return { enabled: c.adminClaimsEnabled(), authorized: await c.isAdminAuthorized() };
});

export const adminClaimLogin = createServerFn({ method: "POST" })
  .validator((input: { token?: string }) => input)
  .handler(async ({ data }) => (await claims()).adminClaimLoginImpl(data.token));

export const fetchPendingClaims = createServerFn({ method: "GET" }).handler(async (): Promise<AdminClaim[] | "unauthorized"> => {
  const c = await claims();
  if (!(await c.isAdminAuthorized())) return "unauthorized";
  return await c.pendingListingClaims();
});

export const decideListingClaim = createServerFn({ method: "POST" })
  .validator((input: { claimId: number; decision: "approved" | "rejected"; note?: string }) => input)
  .handler(async ({ data }): Promise<{ ok: boolean; message: string }> => {
    const c = await claims();
    return await c.decideListingClaimForAdmin(await c.isAdminAuthorized(), data);
  });
