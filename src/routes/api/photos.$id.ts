// GET /api/photos/:id — serves an uploaded photo. Ids are never reused (new
// upload = new id), so responses can be cached indefinitely.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/photos/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const id = Number(params.id);
        if (!Number.isInteger(id) || id < 1) return new Response("Not found", { status: 404 });
        const { getPhoto } = await import("../../server/photos");
        const photo = getPhoto(id);
        if (!photo) return new Response("Not found", { status: 404 });
        return new Response(photo.bytes as unknown as BodyInit, {
          headers: {
            "content-type": photo.mime,
            "cache-control": "public, max-age=31536000, immutable",
            "x-content-type-options": "nosniff",
          },
        });
      },
    },
  },
});
