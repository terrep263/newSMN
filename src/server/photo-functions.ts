// Authenticated photo upload / remove for vendors. Server code is imported dynamically.
import { createServerFn } from "@tanstack/react-start";

export type PhotoActionResult = { ok: boolean; message: string; photoId: number | null };

async function vendorOrNull() {
  const auth = await import("./auth");
  return auth.currentVendor();
}

const UNAUTH: PhotoActionResult = { ok: false, message: "Please log in again.", photoId: null };

function toResult(r: { ok: boolean; photoId?: number | null; message?: string }, done: string): PhotoActionResult {
  return r.ok ? { ok: true, message: done, photoId: r.photoId ?? null } : { ok: false, message: r.message ?? "Could not save the photo.", photoId: null };
}

export const setDealPhotoFn = createServerFn({ method: "POST" })
  .validator((input: { dealId: number; dataUrl: string | null }) => input)
  .handler(async ({ data }): Promise<PhotoActionResult> => {
    const vendor = await vendorOrNull();
    if (!vendor) return UNAUTH;
    const photos = await import("./photos");
    const dataUrl = data.dataUrl === null ? null : String(data.dataUrl);
    return toResult(photos.setDealPhoto(vendor.id, Number(data.dealId), dataUrl), dataUrl === null ? "Photo removed." : "Photo saved.");
  });

export const setListingPhotoFn = createServerFn({ method: "POST" })
  .validator((input: { dataUrl: string | null }) => input)
  .handler(async ({ data }): Promise<PhotoActionResult> => {
    const vendor = await vendorOrNull();
    if (!vendor) return UNAUTH;
    const photos = await import("./photos");
    const dataUrl = data.dataUrl === null ? null : String(data.dataUrl);
    return toResult(photos.setListingPhoto(vendor.id, dataUrl), dataUrl === null ? "Photo removed." : "Photo saved.");
  });
