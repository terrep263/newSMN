// SERVER-ONLY. Vendor authentication: password hashing, the session cookie and
// the server-side session row. Nothing here ever trusts the browser with a
// vendor_id — the session token is the only identity, and it is looked up in the
// sessions table on every request.
//
// Passwords are hashed with Bun.password (argon2id) and verified with
// Bun.password.verify. The plain password is never stored, returned or logged.

import { randomBytes } from "node:crypto";

import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";

import * as store from "./vendors";

export const SESSION_COOKIE = "smn_vendor_session";
/** 30 days, matching the sessions.expires_at row. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "argon2id" });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(password, hash);
  } catch {
    return false;
  }
}

function writeSessionCookie(token: string): void {
  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

/** Creates a session row and writes the httpOnly cookie. Returns the vendor. */
export function startSession(vendor: store.Vendor): store.Vendor {
  store.purgeExpiredSessions();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  store.insertSession(token, vendor.id, expiresAt);
  writeSessionCookie(token);
  return vendor;
}

/** The logged-in vendor for this request, straight from the session table. */
export function currentVendor(): store.Vendor | null {
  const token = getCookie(SESSION_COOKIE);
  if (!token) return null;
  return store.vendorForSession(token);
}

/** Deletes the session row and clears the cookie. */
export function endSession(): void {
  const token = getCookie(SESSION_COOKIE);
  if (token) store.deleteSession(token);
  deleteCookie(SESSION_COOKIE, { path: "/" });
}
