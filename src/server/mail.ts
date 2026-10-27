// SERVER-ONLY. Transactional email through Resend's HTTPS API.
// A failed or skipped send never breaks the action that triggered it.
import { siteOrigin } from "./webhooks";

const FROM = process.env.MAIL_FROM?.trim() || "Shop My Neighborhood <hello@shopmyneighborhood.com>";
const SEND_TIMEOUT_MS = 8000;

export type MailMessage = { to: string; subject: string; text: string };

/** Sends one email. Resolves true only when Resend accepted it; never throws. */
export async function sendMail(message: MailMessage): Promise<boolean> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) { console.warn(`[mail] RESEND_API_KEY is not set; skipped "${message.subject}"`); return false; }
  try {
    const replyTo = process.env.MAIL_REPLY_TO?.trim();
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [message.to], subject: message.subject, text: message.text, ...(replyTo ? { reply_to: replyTo } : {}) }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!response.ok) { console.error(`[mail] Resend refused "${message.subject}": HTTP ${response.status} ${(await response.text()).slice(0, 300)}`); return false; }
    return true;
  } catch (error) {
    console.error(`[mail] could not send "${message.subject}":`, (error as Error).message);
    return false;
  }
}

/** Fire and forget: the caller continues immediately. */
export function sendMailInBackground(message: MailMessage | null): void {
  if (message) void sendMail(message);
}

const SIGN_OFF = "Shop My Neighborhood\nLake County, Florida";

export function welcomeEmail(vendor: { email: string; business_name: string }): MailMessage {
  return {
    to: vendor.email,
    subject: "Welcome to Shop My Neighborhood",
    text: [
      `Hi ${vendor.business_name},`,
      "",
      "Your Shop My Neighborhood vendor account is ready.",
      "",
      `Sign in to your dashboard: ${siteOrigin()}/vendor/dashboard`,
      "",
      SIGN_OFF,
    ].join("\n"),
  };
}

export function claimDecisionEmail(input: { to: string; businessName: string; approved: boolean }): MailMessage {
  if (input.approved) {
    return {
      to: input.to,
      subject: "Your listing claim is approved",
      text: [
        "Hi,",
        "",
        `Your claim for ${input.businessName} on Shop My Neighborhood is approved. The listing is now yours to edit, including its hours, phone, website, description and photo.`,
        "",
        `Edit your listing: ${siteOrigin()}/vendor/listing`,
        "",
        SIGN_OFF,
      ].join("\n"),
    };
  }
  return {
    to: input.to,
    subject: "Update on your listing claim",
    text: [
      "Hi,",
      "",
      `We weren't able to approve your claim for ${input.businessName} on Shop My Neighborhood.`,
      "",
      "If you believe this is a mistake, reply to this email and we will take another look.",
      "",
      SIGN_OFF,
    ].join("\n"),
  };
}

export function voucherSoldEmail(input: {
  to: string; dealTitle: string; code: string; buyerName: string; quantity: number; amountCents: number;
}): MailMessage {
  return {
    to: input.to,
    subject: `Voucher confirmed: ${input.dealTitle}`,
    text: [
      "Hi,",
      "",
      `A voucher for "${input.dealTitle}" has been confirmed.`,
      "",
      `Code: ${input.code}`,
      `Buyer: ${input.buyerName}`,
      `Quantity: ${input.quantity}`,
      `Amount: $${(input.amountCents / 100).toFixed(2)}`,
      "",
      `See it in your dashboard: ${siteOrigin()}/vendor/dashboard`,
      "",
      SIGN_OFF,
    ].join("\n"),
  };
}
