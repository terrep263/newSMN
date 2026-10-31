// SERVER-ONLY. Transactional emails for the Free Trial Vendor system.
// Every message is sent to a vendor or buyer who took the triggering action
// (requested a trial, bought a voucher); none is marketing or cold outreach.
import type { MailMessage } from "./mail";
import { siteOrigin } from "./webhooks";
import { TRIAL, END_REASON_LABEL, type TrialEndReason } from "../lib/trial-rules";

const SIGN_OFF = "Shop My Neighborhood\nLake County, Florida";
const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });

function msg(to: string, subject: string, lines: string[]): MailMessage {
  return { to, subject, text: ["Hi,", "", ...lines, "", SIGN_OFF].join("\n") };
}

export function trialApprovedEmail(i: { to: string; businessName: string; liveDeadlineAt: string; expiresAt: string }): MailMessage {
  return msg(i.to, "Your free trial is approved", [
    `${i.businessName} is approved for the Shop My Neighborhood free trial.`,
    "",
    "What you get: no monthly fee, 1 deal, up to 100 vouchers, for 6 months. We never take a cut of your sales; customers pay you directly through your own Stripe account.",
    "",
    "Next steps:",
    `1. Connect your Stripe account: ${siteOrigin()}/vendor/trial`,
    "2. Create your deal (it is reviewed before it goes live; max price $75).",
    "",
    `Please have your deal live by ${dateLabel(i.liveDeadlineAt)} (${TRIAL.liveDeadlineDays} days from approval). Your trial runs until ${dateLabel(i.expiresAt)}.`,
  ]);
}

export function trialRejectedEmail(i: { to: string; businessName: string; note: string | null }): MailMessage {
  return msg(i.to, "Update on your free trial request", [
    `We weren't able to approve ${i.businessName} for the free trial right now.`,
    ...(i.note ? ["", `Note from our team: ${i.note}`] : []),
    "",
    "Reply to this email if you have questions.",
  ]);
}

export function deadlineReminderEmail(i: { to: string; businessName: string; daysLeft: number; liveDeadlineAt: string }): MailMessage {
  return msg(i.to, `${i.daysLeft} days left to put your deal live`, [
    `${i.businessName} needs a live deal by ${dateLabel(i.liveDeadlineAt)} or the trial approval lapses.`,
    "",
    `Finish here: ${siteOrigin()}/vendor/trial`,
  ]);
}

export function dealApprovedEmail(i: { to: string; dealTitle: string; live: boolean }): MailMessage {
  return msg(
    i.to,
    i.live ? `Your deal is live: ${i.dealTitle}` : `Your deal is approved: ${i.dealTitle}`,
    i.live
      ? [`"${i.dealTitle}" is approved and now live on Shop My Neighborhood.`, "", `Share kit and sales: ${siteOrigin()}/vendor/trial`]
      : [
          `"${i.dealTitle}" is approved. It goes live as soon as your Stripe account can accept payments.`,
          "",
          `Connect Stripe: ${siteOrigin()}/vendor/trial`,
        ],
  );
}

export function dealChangesRequestedEmail(i: { to: string; dealTitle: string; note: string | null }): MailMessage {
  return msg(i.to, `Changes needed: ${i.dealTitle}`, [
    `"${i.dealTitle}" needs changes before it can go live.`,
    ...(i.note ? ["", `Reviewer note: ${i.note}`] : []),
    "",
    `Edit and resubmit: ${siteOrigin()}/vendor/trial`,
  ]);
}

export function dealPausedEmail(i: { to: string; dealTitle: string; why: string }): MailMessage {
  return msg(i.to, `Your deal is paused: ${i.dealTitle}`, [
    `"${i.dealTitle}" has been paused. ${i.why}`,
    "",
    "Vouchers already sold stay redeemable.",
    `Details: ${siteOrigin()}/vendor/trial`,
  ]);
}

export function progressEmail(i: {
  to: string;
  businessName: string;
  milestone: "first_sale" | "half" | "near_limit" | "no_sales";
  sold: number;
}): MailMessage {
  const link = `${siteOrigin()}/vendor/trial`;
  switch (i.milestone) {
    case "first_sale":
      return msg(i.to, "Your first voucher sold", [
        `${i.businessName} just made its first verified sale. Redeem codes at ${siteOrigin()}/vendor/redeem when customers arrive.`,
      ]);
    case "half":
      return msg(i.to, `${i.sold} of ${TRIAL.maxVouchers} vouchers sold`, [
        `${i.businessName} is halfway through its ${TRIAL.maxVouchers}-voucher trial allowance.`,
        "",
        `See your numbers and upgrade options: ${link}`,
      ]);
    case "near_limit":
      return msg(i.to, `${i.sold} of ${TRIAL.maxVouchers} vouchers sold — nearly at the limit`, [
        `${i.businessName} is close to the trial limit. When ${TRIAL.maxVouchers} are sold the deal pauses; vouchers already sold stay redeemable.`,
        "",
        `Upgrade to keep selling: ${link}`,
      ]);
    case "no_sales":
      return msg(i.to, "No sales yet — a few ideas", [
        `${i.businessName}'s deal has been live ${TRIAL.noSalesAlertDays} days without a sale.`,
        "",
        `Your share kit (ready-to-post text and link) is here: ${link}`,
      ]);
  }
}

export function expiryReminderEmail(i: { to: string; businessName: string; daysLeft: number; expiresAt: string }): MailMessage {
  return msg(i.to, `Your free trial ends in ${i.daysLeft} days`, [
    `${i.businessName}'s free trial ends on ${dateLabel(i.expiresAt)}. Vouchers already sold stay redeemable after it ends.`,
    "",
    `Upgrade to keep selling: ${siteOrigin()}/vendor/trial`,
  ]);
}

export function trialEndedEmail(i: { to: string; businessName: string; reason: TrialEndReason }): MailMessage {
  return msg(i.to, "Your free trial has ended", [
    `${i.businessName}'s free trial ended: ${END_REASON_LABEL[i.reason]}.`,
    "",
    "Vouchers you already sold stay redeemable. Nothing is owed to us.",
    `To keep selling, choose a plan: ${siteOrigin()}/vendor/dashboard`,
  ]);
}

export function buyerWelcomeEmail(i: { to: string; name: string }): MailMessage {
  return msg(i.to, "Your Shop My Neighborhood account", [
    `${i.name}, your account is ready. Your vouchers are always at ${siteOrigin()}/account.`,
  ]);
}
