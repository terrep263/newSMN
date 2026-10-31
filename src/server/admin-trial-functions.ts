// Client-safe entry points for the free-trial admin console. All logic lives in
// ./admin-trials and ./trials and is imported inside handlers only.
import { createServerFn } from "@tanstack/react-start";

import type { AdminTrialData } from "./admin-trials";
export type { AdminTrialData };

type Outcome = { ok: boolean; message: string };
const admin = () => import("./admin-trials");
const engine = () => import("./trials");
const note = (v: unknown) => String(v ?? "").trim().slice(0, 500) || null;

export const adminTrialSession = createServerFn({ method: "GET" }).handler(async () => {
  const a = await admin();
  return { enabled: a.adminEnabled(), authorized: a.isAdmin() };
});

export const adminTrialLogin = createServerFn({ method: "POST" })
  .validator((input: { token?: string }) => input)
  .handler(async ({ data }): Promise<Outcome> => (await admin()).adminLogin(data.token));

export const adminTrialData = createServerFn({ method: "GET" }).handler(async (): Promise<AdminTrialData | "unauthorized"> => {
  const a = await admin();
  if (!a.isAdmin()) return "unauthorized";
  return a.loadAdminData();
});

async function guarded(fn: (t: typeof import("./trials")) => Outcome): Promise<Outcome> {
  const a = await admin();
  if (!a.isAdmin()) return { ok: false, message: "Not authorized." };
  return fn(await engine());
}

export const adminDecideTrial = createServerFn({ method: "POST" })
  .validator((input: { id: number; decision: "approved" | "rejected"; note?: string }) => input)
  .handler(({ data }) =>
    guarded((t) => {
      const r = data.decision === "approved" ? t.approveTrial(Number(data.id), note(data.note)) : t.rejectTrial(Number(data.id), note(data.note));
      return r.ok ? { ok: true, message: data.decision === "approved" ? "Trial approved. The vendor has been emailed." : "Request declined." } : { ok: false, message: r.message };
    }),
  );

export const adminReviewDeal = createServerFn({ method: "POST" })
  .validator((input: { dealId: number; decision: "approved" | "rejected"; note?: string }) => input)
  .handler(({ data }) =>
    guarded((t) => {
      const r = t.reviewTrialDeal(Number(data.dealId), data.decision, note(data.note));
      return r.ok ? { ok: true, message: data.decision === "approved" ? "Deal approved." : "Changes requested." } : { ok: false, message: r.message };
    }),
  );

export const adminTerminateTrial = createServerFn({ method: "POST" })
  .validator((input: { id: number; note?: string }) => input)
  .handler(({ data }) =>
    guarded((t) => {
      const r = t.terminateTrial(Number(data.id), note(data.note) ?? "");
      return r.ok ? { ok: true, message: "Trial terminated. Sold vouchers stay redeemable." } : { ok: false, message: r.message };
    }),
  );

export const adminSetDealPaused = createServerFn({ method: "POST" })
  .validator((input: { dealId: number; paused: boolean; note?: string }) => input)
  .handler(({ data }) =>
    guarded((t) => {
      const r = data.paused ? t.adminPauseTrialDeal(Number(data.dealId), note(data.note) ?? "") : t.adminResumeTrialDeal(Number(data.dealId));
      return r.ok ? { ok: true, message: data.paused ? "Deal paused." : "Deal resumed (goes live if Stripe is ready)." } : { ok: false, message: r.message };
    }),
  );

export const adminSetCityCap = createServerFn({ method: "POST" })
  .validator((input: { city: string; cap: number }) => input)
  .handler(({ data }) =>
    guarded((t) => {
      const r = t.setCityCap(String(data.city), Number(data.cap));
      return r.ok ? { ok: true, message: "City cap saved." } : { ok: false, message: r.message };
    }),
  );

export const adminResolveAlert = createServerFn({ method: "POST" })
  .validator((input: { id: number }) => input)
  .handler(async ({ data }): Promise<Outcome> => {
    const a = await admin();
    if (!a.isAdmin()) return { ok: false, message: "Not authorized." };
    a.resolveAlert(Number(data.id));
    return { ok: true, message: "Alert resolved." };
  });
