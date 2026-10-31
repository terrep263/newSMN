// SERVER-ONLY. Buyer accounts for free-trial purchases. The platform keeps the
// buyer's data; trial vendors only ever see the buyer's name and voucher code.
// Same pattern as vendor auth: argon2id password hash (Bun.password), an httpOnly
// session cookie, and a server-side session row looked up on every request.

import { randomBytes } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";

import { getDb } from "./db";
import { sendMailInBackground } from "./mail";
import { buyerWelcomeEmail } from "./trial-mail";

export const BUYER_COOKIE = "smn_buyer_session";
export const BUYER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export type Buyer = { id: number; name: string; email: string; created_at: string };

export type BuyerResult = { ok: true; buyer: Buyer } | { ok: false; message: string; fields?: Record<string, string> };

async function hash(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "argon2id" });
}
async function verify(password: string, h: string): Promise<boolean> {
  try {
    return await Bun.password.verify(password, h);
  } catch {
    return false;
  }
}

function loginLockMs(email: string, now = Date.now()): number {
  const row = getDb()
    .query<{ fail_count: number; window_start: string }, [string]>(
      "SELECT fail_count, window_start FROM buyer_login_attempts WHERE email = ?",
    )
    .get(email);
  if (!row || row.fail_count < LOGIN_MAX_FAILURES) return 0;
  return Math.max(0, new Date(row.window_start).getTime() + LOGIN_WINDOW_MS - now);
}
function recordFailure(email: string, now = Date.now()): void {
  const db = getDb();
  const row = db
    .query<{ fail_count: number; window_start: string }, [string]>(
      "SELECT fail_count, window_start FROM buyer_login_attempts WHERE email = ?",
    )
    .get(email);
  const iso = new Date(now).toISOString();
  if (!row || new Date(row.window_start).getTime() + LOGIN_WINDOW_MS < now) {
    db.query(
      "INSERT INTO buyer_login_attempts (email, fail_count, window_start, last_attempt) VALUES (?, 1, ?, ?) ON CONFLICT(email) DO UPDATE SET fail_count = 1, window_start = excluded.window_start, last_attempt = excluded.last_attempt",
    ).run(email, iso, iso);
  } else {
    db.query("UPDATE buyer_login_attempts SET fail_count = fail_count + 1, last_attempt = ? WHERE email = ?").run(iso, email);
  }
}

export async function registerBuyer(input: { name: string; email: string; password: string }): Promise<BuyerResult> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const fields: Record<string, string> = {};
  if (name.length < 2 || name.length > 80) fields.name = "Enter your name (2–80 characters).";
  if (!EMAIL_RE.test(email) || email.length > 200) fields.email = "Enter a valid email address.";
  if (input.password.length < 8 || input.password.length > 200) fields.password = "Use a password of at least 8 characters.";
  if (Object.keys(fields).length) return { ok: false, message: "Check the highlighted fields.", fields };
  const db = getDb();
  if (db.query("SELECT 1 FROM buyers WHERE email = ?").get(email))
    return { ok: false, message: "An account with that email already exists. Sign in instead.", fields: { email: "Already registered." } };
  const buyer = db
    .query<Buyer, [string, string, string, string]>(
      "INSERT INTO buyers (name, email, password_hash, created_at) VALUES (?, ?, ?, ?) RETURNING id, name, email, created_at",
    )
    .get(name, email, await hash(input.password), new Date().toISOString())!;
  sendMailInBackground(buyerWelcomeEmail({ to: buyer.email, name: buyer.name }));
  return { ok: true, buyer };
}

export async function loginBuyer(input: { email: string; password: string }): Promise<BuyerResult> {
  const email = input.email.trim().toLowerCase();
  const wait = loginLockMs(email);
  if (wait > 0) return { ok: false, message: `Too many attempts. Try again in ${Math.ceil(wait / 60000)} minutes.` };
  const row = getDb()
    .query<Buyer & { password_hash: string }, [string]>("SELECT * FROM buyers WHERE email = ?")
    .get(email);
  const good = row ? await verify(input.password, row.password_hash) : false;
  if (!row || !good) {
    recordFailure(email);
    return { ok: false, message: "That email and password don't match." };
  }
  getDb().query("DELETE FROM buyer_login_attempts WHERE email = ?").run(email);
  return { ok: true, buyer: { id: row.id, name: row.name, email: row.email, created_at: row.created_at } };
}

export function startBuyerSession(buyer: Buyer): void {
  const db = getDb();
  db.query("DELETE FROM buyer_sessions WHERE expires_at < ?").run(new Date().toISOString());
  const token = randomBytes(32).toString("base64url");
  db.query("INSERT INTO buyer_sessions (token, buyer_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
    token,
    buyer.id,
    new Date(Date.now() + BUYER_SESSION_TTL_MS).toISOString(),
    new Date().toISOString(),
  );
  setCookie(BUYER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: Math.floor(BUYER_SESSION_TTL_MS / 1000),
  });
}

export function buyerForToken(token: string | undefined): Buyer | null {
  if (!token) return null;
  return (
    getDb()
      .query<Buyer, [string, string]>(
        `SELECT b.id, b.name, b.email, b.created_at FROM buyer_sessions s JOIN buyers b ON b.id = s.buyer_id
          WHERE s.token = ? AND s.expires_at > ?`,
      )
      .get(token, new Date().toISOString()) ?? null
  );
}

export function currentBuyer(): Buyer | null {
  return buyerForToken(getCookie(BUYER_COOKIE));
}

export function endBuyerSession(): void {
  const token = getCookie(BUYER_COOKIE);
  if (token) getDb().query("DELETE FROM buyer_sessions WHERE token = ?").run(token);
  deleteCookie(BUYER_COOKIE, { path: "/" });
}

export type BuyerVoucher = {
  code: string;
  dealTitle: string;
  dealSlug: string;
  vendorName: string;
  quantity: number;
  amountCents: number;
  status: string;
  createdAt: string;
  confirmed: boolean;
  complained: boolean;
  isTrial: boolean;
};

export function vouchersForBuyer(buyerId: number): BuyerVoucher[] {
  return getDb()
    .query<
      { code: string; title: string; slug: string; vendor_name: string; quantity: number; amount_cents: number; status: string; created_at: string; confirmed_at: string | null; complained: number; trial_id: number | null },
      [number]
    >(
      `SELECT v.code, d.title, d.slug, d.vendor_name, v.quantity, v.amount_cents, v.status, v.created_at, v.confirmed_at,
              EXISTS (SELECT 1 FROM trial_complaints c WHERE c.deal_id = d.id AND c.buyer_id = v.buyer_id) AS complained,
              d.trial_id
         FROM vouchers v JOIN deals d ON d.id = v.deal_id
        WHERE v.buyer_id = ? AND NOT (v.status = 'expired' AND v.confirmed_at IS NULL)
        ORDER BY v.id DESC`,
    )
    .all(buyerId)
    .map((r) => ({
      code: r.code,
      dealTitle: r.title,
      dealSlug: r.slug,
      vendorName: r.vendor_name,
      quantity: r.quantity,
      amountCents: r.amount_cents,
      status: r.status,
      createdAt: r.created_at,
      confirmed: !!r.confirmed_at,
      complained: !!r.complained,
      isTrial: r.trial_id != null,
    }));
}
