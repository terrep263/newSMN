// Server function that gives pages the public origin for canonical URLs.
import { createServerFn } from "@tanstack/react-start";

export const fetchSiteOrigin = createServerFn({ method: "GET" }).handler(async (): Promise<string> => {
  const { resolveOrigin } = await import("./seo");
  let host: string | undefined;
  let proto: string | undefined;
  try {
    const server = await import("@tanstack/react-start/server");
    host = server.getRequestHeader("x-forwarded-host") ?? server.getRequestHost();
    proto = server.getRequestHeader("x-forwarded-proto") ?? server.getRequestProtocol();
  } catch {
    /* no request context — resolveOrigin falls back to the brand domain */
  }
  return resolveOrigin(host, proto);
});
