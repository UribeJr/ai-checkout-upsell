import prisma from "../../db.server";
import { fetchLiveProducts, findOffer, getOfferPolicy } from "./candidate-engine.server";
import { basketKey, buildChanges, checkStoredPick, toExtensionOffer } from "./offer-payload";

/**
 * The checkout side of the offer engine: one stored OfferDecision per
 * checkout (shop + referenceId).
 *
 * - ShouldRender (/api/offer): decide once with findOffer and save the
 *   decision. If ShouldRender runs again for the same checkout, the stored
 *   pick is reused after a live check, so the buyer sees the same offer.
 * - Accept (/api/sign-changeset): only the stored pick can be signed, and
 *   only if it can still be sold.
 *
 * No AI call here: the copy was written offline with the relationships.
 */

const toVariantGid = (id) => `gid://shopify/ProductVariant/${id}`;

/**
 * Returns the offer payload for the extension, or null for no offer.
 * `context` comes from getPostPurchaseContext (the verified token).
 */
export async function getCheckoutOffer({ shop, admin, context }) {
  const startedAt = Date.now();

  const existing = await findDecision(shop, context.referenceId);
  if (existing) return reuseDecision({ admin, context, decision: existing, startedAt });

  const variantIds = context.purchasedVariantIds.map(toVariantGid);
  const result = await findOffer({
    shop,
    admin,
    purchase: {
      productIds: context.purchasedProductIds,
      variantIds,
      subtotal: context.subtotal,
    },
  });

  const decision = await saveDecision({ shop, context, variantIds, result });
  // Another ShouldRender for this checkout saved first: use its decision.
  if (!decision) {
    const winner = await findDecision(shop, context.referenceId);
    return winner ? reuseDecision({ admin, context, decision: winner, startedAt }) : null;
  }

  const { offer } = result;
  console.log(
    `[offer] ${context.referenceId}: new decision, source=${decision.source}` +
      (offer ? `, offering ${offer.productTitle} (${offer.rankScore})` : `, ${decision.fallbackReason}`) +
      `, ${result.ranked.length} candidates, engine ${result.durationMs} ms, total ${Date.now() - startedAt} ms`,
  );

  if (!offer) return null;
  return toExtensionOffer(decision, { productTitle: offer.productTitle, imageUrl: offer.imageUrl });
}

/**
 * Returns { decision, changes } for the stored pick when it matches `offerId`
 * and can still be sold, otherwise { decision, reason } (decision is null
 * when nothing matches).
 */
export async function getOfferToSign({ shop, admin, context, offerId }) {
  const decision = await findDecision(shop, context.referenceId);
  if (!decision || decision.id !== offerId || !decision.selectedVariantId) {
    return { decision: null, reason: "no_matching_offer" };
  }

  const { reason } = await recheckPick({ admin, context, decision });
  if (reason) return { decision, reason };

  return { decision, changes: buildChanges(decision.selectedVariantId, decision.discountPercent) };
}

export function findDecision(shop, referenceId) {
  return prisma.offerDecision.findUnique({
    where: { shop_referenceId: { shop, referenceId } },
  });
}

async function reuseDecision({ admin, context, decision, startedAt }) {
  if (!decision.selectedVariantId) {
    console.log(`[offer] ${context.referenceId}: stored decision has no offer`);
    return null;
  }

  const { reason, liveProduct } = await recheckPick({ admin, context, decision });
  console.log(
    `[offer] ${context.referenceId}: reused decision, ` +
      (reason ? `no longer offered (${reason})` : `offering ${liveProduct.title}`) +
      `, total ${Date.now() - startedAt} ms`,
  );
  if (reason) return null;

  const variant = liveProduct.variants.find((option) => option.id === decision.selectedVariantId);
  return toExtensionOffer(decision, {
    productTitle: liveProduct.title,
    imageUrl: variant?.imageUrl ?? liveProduct.imageUrl,
  });
}

// One Admin query for the stored pick. Returns { reason, liveProduct }.
async function recheckPick({ admin, context, decision }) {
  const { products } = await fetchLiveProducts(admin, [decision.selectedProductId]);
  const liveProduct = products.get(decision.selectedProductId);
  const { subtotal } = JSON.parse(decision.orderContext);

  const reason = checkStoredPick(liveProduct, decision.selectedVariantId, {
    purchasedVariantIds: context.purchasedVariantIds.map(toVariantGid),
    maxPrice: subtotal * (await getOfferPolicy(decision.shop)).maxOrderRatio,
  });
  return { reason, liveProduct };
}

// Returns the saved row, or null if this checkout already has one.
async function saveDecision({ shop, context, variantIds, result }) {
  const { offer, ranked, policy } = result;
  const chosen = offer && ranked.find((candidate) => candidate.productId === offer.productId);

  try {
    return await prisma.offerDecision.create({
      data: {
        shop,
        referenceId: context.referenceId,
        basketKey: basketKey({ variantIds, policy }),
        orderContext: JSON.stringify({
          lineItems: context.lineItems,
          subtotal: context.subtotal,
          currencyCode: context.currencyCode,
        }),
        candidates: JSON.stringify(
          ranked.slice(0, 8).map((candidate) => ({
            productId: candidate.productId,
            rankScore: candidate.rankScore,
            relationshipIds: candidate.relationshipIds,
          })),
        ),
        selectedProductId: offer?.productId ?? null,
        selectedVariantId: offer?.variantId ?? null,
        headline: offer?.headline ?? null,
        description: offer?.description ?? null,
        reasoning: chosen?.relationship.reasoning ?? null,
        source: offer ? offer.copySource : "NONE",
        fallbackReason: offer ? null : ranked.length ? "none_sellable" : "no_candidates",
        promptVersion: chosen?.relationship.version ?? null,
        durationMs: result.durationMs,
        discountPercent: policy.discountPercent,
        offerPrice: offer?.price ?? null,
      },
    });
  } catch (error) {
    // Unique (shop, referenceId): a parallel request saved first.
    if (error.code === "P2002") return null;
    throw error;
  }
}
