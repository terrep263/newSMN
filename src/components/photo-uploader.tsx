import { useRef, useState } from "react";

import type { PhotoActionResult } from "~/server/photo-functions";

const MAX_EDGE = 1280;

/** Downscale in the browser so uploads stay small; always re-encodes to JPEG. */
async function toJpegDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

export function PhotoUploader({
  photoId,
  label,
  onSave,
  onDone,
}: {
  photoId: number | null;
  label: string;
  onSave: (dataUrl: string | null) => Promise<PhotoActionResult>;
  onDone: () => void | Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(dataUrl: string | null) {
    setBusy(true);
    setNotice(null);
    try {
      const result = await onSave(dataUrl);
      setNotice({ ok: result.ok, text: result.message });
      if (result.ok) await onDone();
    } catch {
      setNotice({ ok: false, text: "The photo could not be saved. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return setNotice({ ok: false, text: "Choose a JPG, PNG or WebP image." });
    try {
      await run(await toJpegDataUrl(file));
    } catch {
      setNotice({ ok: false, text: "That image could not be read. Try a different photo." });
    }
  }

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4">
      <p className="text-sm font-semibold text-ink">{label}</p>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {photoId ? (
          <img src={`/api/photos/${photoId}`} alt="" className="h-24 w-36 rounded-xl object-cover ring-1 ring-black/10" />
        ) : (
          <div className="grid h-24 w-36 place-items-center rounded-xl bg-black/5 text-xs text-ink-soft">No photo yet</div>
        )}
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onPick} />
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className="rounded-full bg-brand px-4 py-2 text-xs font-semibold text-white disabled:opacity-60">
            {busy ? "Saving…" : photoId ? "Replace photo" : "Upload photo"}
          </button>
          {photoId && (
            <button type="button" disabled={busy} onClick={() => run(null)} className="rounded-full border border-black/15 px-4 py-2 text-xs font-semibold text-ink disabled:opacity-60">
              Remove
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-[0.72rem] text-ink-soft">JPG, PNG or WebP. Photos are resized automatically. Without a photo, a colored plate is shown.</p>
      {notice && <p className={`mt-3 rounded-xl px-3 py-2 text-xs ${notice.ok ? "bg-brand-green/15 text-brand-green-dark" : "bg-rose-50 text-rose-900"}`}>{notice.text}</p>}
    </div>
  );
}
