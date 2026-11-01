/**
 * Rules for offer events sent by the post-purchase extension. No database
 * or network here (tested in test/offer-events.test.js).
 *
 * Event types:
 * - IMPRESSION: the offer page was shown with Shopify-calculated totals
 * - DECLINED: the buyer pressed "Decline this offer"
 * - ACCEPTED: the server signed the changeset (recorded by the server only)
 * - APPLIED: Shopify applied the changeset; the only event that counts as revenue
 * - APPLY_FAILED: signing was refused, or Shopify didn't apply the changeset
 */

export const EVENT_TYPES = ["IMPRESSION", "DECLINED", "ACCEPTED", "APPLIED", "APPLY_FAILED"];

// ACCEPTED is left out: only /api/sign-changeset records it.
export const CLIENT_EVENT_TYPES = ["IMPRESSION", "DECLINED", "APPLIED", "APPLY_FAILED"];

const REASON_MAX = 60;

/**
 * Checks an event sent by the extension against the stored decision.
 * Returns { event: { type, value, reason } } or { error }.
 *
 * An APPLIED value comes from Shopify's calculatedPurchase in the buyer's
 * browser, so it is only trusted when 0 < value <= the offer's list price.
 * Otherwise the event is still recorded, without a value.
 */
export function validateClientEvent({ type, value, reason }, decision) {
  if (!CLIENT_EVENT_TYPES.includes(type)) return { error: "unknown_type" };
  if (!decision.selectedVariantId) return { error: "no_offer" };

  if (type === "APPLIED") {
    const amount = Number(value);
    const valid =
      Number.isFinite(amount) &&
      amount > 0 &&
      decision.offerPrice != null &&
      amount <= decision.offerPrice;
    return {
      event: valid
        ? { type, value: Math.round(amount * 100) / 100, reason: null }
        : { type, value: null, reason: "value_rejected" },
    };
  }

  if (type === "APPLY_FAILED") {
    return { event: { type, value: null, reason: cleanReason(reason) } };
  }

  return { event: { type, value: null, reason: null } };
}

// Shopify error codes are short identifiers; keep only that shape.
function cleanReason(reason) {
  if (typeof reason !== "string") return "unknown";
  const cleaned = reason.replace(/[^a-z0-9_]/gi, "").slice(0, REASON_MAX);
  return cleaned || "unknown";
}
