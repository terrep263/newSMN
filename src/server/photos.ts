// SERVER-ONLY. Photo storage: validated image bytes in SQLite, attached to a
// deal or a claimed directory listing. Ownership is enforced in the SQL.
import { getDb } from "./db";

export const MAX_PHOTO_BYTES = 1_500_000;

export type PhotoResult = { ok: true; photoId: number } | { ok: false; message: string };

/** Detect the real image type from magic bytes; never trust the client's claim. */
export function sniffImage(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length > 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 12 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (
    bytes.length > 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) return "image/webp";
  return null;
}

export function decodeDataUrl(dataUrl: unknown): { bytes: Uint8Array; mime: string } | { error: string } {
  const match = /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ""));
  if (!match) return { error: "Choose a JPG, PNG or WebP image." };
  const bytes = new Uint8Array(Buffer.from(match[1], "base64"));
  if (bytes.length === 0) return { error: "That image is empty." };
  if (bytes.length > MAX_PHOTO_BYTES) return { error: "That image is too large. Try a smaller photo." };
  const mime = sniffImage(bytes);
  if (!mime) return { error: "Choose a JPG, PNG or WebP image." };
  return { bytes, mime };
}

function insertPhoto(vendorId: number, bytes: Uint8Array, mime: string): number {
  const res = getDb()
    .query("INSERT INTO photos (mime, bytes, vendor_id, created_at) VALUES (?, ?, ?, ?)")
    .run(mime, bytes, vendorId, new Date().toISOString());
  return Number(res.lastInsertRowid);
}

function dropPhoto(photoId: number | null | undefined) {
  if (photoId) getDb().query("DELETE FROM photos WHERE id = ?").run(photoId);
}

export function getPhoto(id: number): { mime: string; bytes: Uint8Array } | null {
  return getDb().query<{ mime: string; bytes: Uint8Array }, [number]>("SELECT mime, bytes FROM photos WHERE id = ?").get(id) ?? null;
}

/** Set (dataUrl given) or clear (dataUrl null) the photo of a deal the vendor owns. */
export function setDealPhoto(vendorId: number, dealId: number, dataUrl: string | null): PhotoResult | { ok: true; photoId: null } {
  const db = getDb();
  const deal = db
    .query<{ photo_id: number | null }, [number, number]>("SELECT photo_id FROM deals WHERE id = ? AND vendor_id = ?")
    .get(dealId, vendorId);
  if (!deal) return { ok: false, message: "You do not own that deal." };
  if (dataUrl === null) {
    db.query("UPDATE deals SET photo_id = NULL WHERE id = ? AND vendor_id = ?").run(dealId, vendorId);
    dropPhoto(deal.photo_id);
    return { ok: true, photoId: null };
  }
  const decoded = decodeDataUrl(dataUrl);
  if ("error" in decoded) return { ok: false, message: decoded.error };
  const photoId = insertPhoto(vendorId, decoded.bytes, decoded.mime);
  db.query("UPDATE deals SET photo_id = ? WHERE id = ? AND vendor_id = ?").run(photoId, dealId, vendorId);
  dropPhoto(deal.photo_id);
  return { ok: true, photoId };
}

/** Set or clear the photo of the directory listing this vendor has an approved claim on. */
export function setListingPhoto(vendorId: number, dataUrl: string | null): PhotoResult | { ok: true; photoId: null } {
  const db = getDb();
  const listing = db
    .query<{ id: number; photo_id: number | null }, [number, number]>(
      `SELECT b.id, b.photo_id FROM businesses b JOIN listing_claims c ON c.business_id = b.id
        WHERE c.vendor_id = ? AND c.status = 'approved' AND b.is_claimed = 1 AND b.claimed_by_vendor_id = ?
        ORDER BY c.decided_at DESC LIMIT 1`,
    )
    .get(vendorId, vendorId);
  if (!listing) return { ok: false, message: "You do not have an approved listing to edit." };
  const stamp = new Date().toISOString();
  if (dataUrl === null) {
    db.query("UPDATE businesses SET photo_id = NULL, updated_at = ? WHERE id = ?").run(stamp, listing.id);
    dropPhoto(listing.photo_id);
    return { ok: true, photoId: null };
  }
  const decoded = decodeDataUrl(dataUrl);
  if ("error" in decoded) return { ok: false, message: decoded.error };
  const photoId = insertPhoto(vendorId, decoded.bytes, decoded.mime);
  db.query("UPDATE businesses SET photo_id = ?, updated_at = ? WHERE id = ?").run(photoId, stamp, listing.id);
  dropPhoto(listing.photo_id);
  return { ok: true, photoId };
}
