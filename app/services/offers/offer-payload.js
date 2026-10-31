import { createHash } from "node:crypto";

/**
 * Pure helpers between a stored OfferDecision and the checkout: the
 * changeset we sign, the payload the extension shows, and the live recheck
 * of a stored pick. No database or network here (tested in
 * test/offer-payload.test.js); offer-decision.server.js calls these.
 */

const numericId = (gid) => Number(String(gid).split("/").pop());

/**
 * The changes Shopify applies when the buyer accepts: one unit of the offered
 * variant, with our discount policy. Built only on the server.
 *
 * Field names follow the installed @shopify/post-purchase-ui-extensions types
 * (`variantId`). The tutorial's sample code spells it `variantID`.
 */
export function buildChanges(variantId, discountPercent) {
  const change = {
    type: "add_variant",
    variantId: numericId(variantId),
    quantity: 1,
  };

  if (discountPercent > 0) {
    change.discount = {
      value: discountPercent,
      valueType: "percentage",
      title: `${discountPercent}% off`,
    };
  }

  return [change];
}

/**
 * Identifies "the same basket under the same policy", so decisions can later
 * be grouped or cached. Variant order doesn't matter.
 */
export function basketKey({ variantIds, policy }) {
  const parts = [
    ...variantIds.map(String).sort(),
    `min:${policy.minScore}`,
    `ratio:${policy.maxOrderRatio}`,
    `discount:${policy.discountPercent}`,
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

/**
 * Checks that a stored pick can still be sold right now, with the same rules
 * as pickOffer in candidate-ranking.js. Returns null when it can, otherwise
 * the reason ("inactive", "out_of_stock", "over_price_cap").
 */
export function checkStoredPick(liveProduct, variantId, { purchasedVariantIds = [], maxPrice }) {
  if (!liveProduct || liveProduct.status !== "ACTIVE") return "inactive";

  const variant = liveProduct.variants.find((option) => option.id === variantId);
  if (!variant || !variant.availableForSale || purchasedVariantIds.includes(variantId)) {
    return "out_of_stock";
  }

  if (variant.price > maxPrice) return "over_price_cap";
  return null;
}

/**
 * What the extension receives. Prices are left out on purpose: the extension
 * asks Shopify (calculateChangeset) for every amount it shows.
 */
export function toExtensionOffer(decision, { productTitle, imageUrl }) {
  return {
    id: decision.id,
    productTitle,
    imageUrl: imageUrl ?? null,
    headline: decision.headline,
    description: decision.description,
    discountPercent: decision.discountPercent,
    changes: buildChanges(decision.selectedVariantId, decision.discountPercent),
  };
}
