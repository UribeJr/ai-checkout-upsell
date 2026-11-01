/**
 * Offer analytics from stored decisions and their events. Pure (tested in
 * test/metrics.test.js); metrics.server.js loads the data.
 *
 * Definitions:
 * - Impression: the offer page was shown with Shopify-calculated totals.
 * - Conversion: applied offers / impressions.
 * - Attributed revenue: sum of APPLIED values (added line after discount,
 *   before shipping and tax). Attributed, not proven incremental: that would
 *   need a holdout group. Refunds and cancellations are not subtracted.
 * - Top offers: ranked by revenue per impression, then impressions.
 */

// Below this many impressions an offer's rates are shown with a warning.
// Our own threshold, not a statistical test.
export const LOW_SAMPLE_IMPRESSIONS = 30;

const ratio = (part, whole) => (whole > 0 ? part / whole : null);
const money = (value) => Math.round(value * 100) / 100;

/**
 * `decisions`: [{ selectedProductId, events: [{ type, value }] }].
 * `titles`: { productId: title }.
 * Returns { totals, topOffers }. Rates are null when there is nothing to
 * divide by.
 */
export function summarize(decisions, titles = {}) {
  const totals = {
    checkouts: decisions.length,
    offersDecided: 0,
    impressions: 0,
    declined: 0,
    accepted: 0,
    applied: 0,
    applyFailed: 0,
    revenue: 0,
  };
  const byProduct = new Map();

  for (const decision of decisions) {
    if (!decision.selectedProductId) continue;
    totals.offersDecided += 1;

    const types = new Set(decision.events.map((event) => event.type));
    const revenue = decision.events
      .filter((event) => event.type === "APPLIED" && event.value != null)
      .reduce((sum, event) => sum + event.value, 0);

    totals.impressions += types.has("IMPRESSION") ? 1 : 0;
    totals.declined += types.has("DECLINED") ? 1 : 0;
    totals.accepted += types.has("ACCEPTED") ? 1 : 0;
    totals.applied += types.has("APPLIED") ? 1 : 0;
    totals.applyFailed += types.has("APPLY_FAILED") ? 1 : 0;
    totals.revenue += revenue;

    const offer = byProduct.get(decision.selectedProductId) ?? {
      productId: decision.selectedProductId,
      title: titles[decision.selectedProductId] ?? decision.selectedProductId,
      impressions: 0,
      applied: 0,
      revenue: 0,
    };
    offer.impressions += types.has("IMPRESSION") ? 1 : 0;
    offer.applied += types.has("APPLIED") ? 1 : 0;
    offer.revenue += revenue;
    byProduct.set(decision.selectedProductId, offer);
  }

  totals.revenue = money(totals.revenue);
  totals.conversion = ratio(totals.applied, totals.impressions);
  totals.acceptRate = ratio(totals.accepted, totals.impressions);
  totals.revenuePerImpression = nullableMoney(ratio(totals.revenue, totals.impressions));

  const topOffers = [...byProduct.values()]
    .map((offer) => ({
      ...offer,
      revenue: money(offer.revenue),
      conversion: ratio(offer.applied, offer.impressions),
      revenuePerImpression: nullableMoney(ratio(offer.revenue, offer.impressions)),
      lowSample: offer.impressions < LOW_SAMPLE_IMPRESSIONS,
    }))
    .sort(
      (a, b) =>
        (b.revenuePerImpression ?? -1) - (a.revenuePerImpression ?? -1) ||
        b.impressions - a.impressions ||
        a.title.localeCompare(b.title),
    );

  return { totals, topOffers };
}

function nullableMoney(value) {
  return value == null ? null : money(value);
}
