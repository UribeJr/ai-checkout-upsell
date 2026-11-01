import prisma from "../../db.server";

/**
 * Saves one offer event. Each event type is recorded at most once per
 * decision (unique decisionId + type), so retries and re-renders count once.
 * Returns "recorded", "duplicate" or "failed". Never throws: measurement
 * must not break signing or checkout.
 */
export async function recordEvent({ decision, type, value = null, reason = null }) {
  try {
    const currencyCode = JSON.parse(decision.orderContext).currencyCode ?? null;
    await prisma.offerEvent.create({
      data: {
        shop: decision.shop,
        decisionId: decision.id,
        type,
        value,
        currencyCode: value == null ? null : currencyCode,
        reason,
      },
    });
    console.log(
      `[events] ${decision.referenceId}: ${type}` +
        (value != null ? ` ${value} ${currencyCode}` : "") +
        (reason ? ` (${reason})` : ""),
    );
    return "recorded";
  } catch (error) {
    if (error.code === "P2002") return "duplicate";
    console.error(`[events] ${decision.referenceId}: could not record ${type}:`, error.message);
    return "failed";
  }
}
