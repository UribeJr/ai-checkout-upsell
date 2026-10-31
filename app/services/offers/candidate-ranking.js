/**
 * Pure offer decision rules: which related product to offer after checkout,
 * and with what copy. No database, network or AI here, so every rule is
 * unit-tested (test/candidate-ranking.test.js); candidate-engine.server.js
 * loads the data and calls these.
 *
 * Scores come from the offline AI relationship step. They rank relevance;
 * they are not conversion probabilities.
 */

// Relationships below this score are never offered.
export const MIN_SCORE = 0.6;

// Bonus per extra purchased product that points at the same target, so an
// item that fits the whole basket ranks above one that fits a single item.
export const MULTI_SOURCE_BONUS = 0.05;

const HEADLINE_MAX = 60;

/**
 * Turns the relationships of the purchased products into one ranked entry per
 * target product.
 *
 * `relationships`: { id, sourceProductId, targetProductId, type, score,
 * headline, description, factRefs: string[] | null }.
 * Returns { ranked, skipped }. `skipped` lists relationships that were left
 * out and why ("upgrade", "purchased", "below_min_score"), only for targets
 * that didn't make the ranking another way.
 */
export function rankCandidates({ purchasedProductIds, relationships, minScore = MIN_SCORE }) {
  const purchased = new Set(purchasedProductIds);
  const edgesByTarget = new Map();
  const skipped = [];

  for (const edge of relationships) {
    if (!purchased.has(edge.sourceProductId)) continue;

    const reason = skipReason(edge, purchased, minScore);
    if (reason) {
      skipped.push({ productId: edge.targetProductId, relationship: edge, reason });
      continue;
    }

    const edges = edgesByTarget.get(edge.targetProductId) ?? [];
    edges.push(edge);
    edgesByTarget.set(edge.targetProductId, edges);
  }

  const ranked = [...edgesByTarget].map(([productId, edges]) => {
    const best = edges.reduce((a, b) => (b.score > a.score ? b : a));
    return {
      productId,
      rankScore: round(best.score + MULTI_SOURCE_BONUS * (edges.length - 1)),
      // The strongest relationship supplies the type and the copy.
      relationship: best,
      relationshipIds: edges.map((edge) => edge.id),
      sourceProductIds: edges.map((edge) => edge.sourceProductId),
    };
  });

  // Highest score first; ties broken by product ID so the result is stable.
  ranked.sort((a, b) => b.rankScore - a.rankScore || a.productId.localeCompare(b.productId));

  return {
    ranked,
    skipped: skipped.filter((entry) => !edgesByTarget.has(entry.productId)),
  };
}

function skipReason(edge, purchased, minScore) {
  // Upsizing the same product isn't the cross-sell this offer is for.
  if (edge.type === "UPGRADE") return "upgrade";
  if (purchased.has(edge.targetProductId)) return "purchased";
  if (edge.score < minScore) return "below_min_score";
  return null;
}

/**
 * Walks the ranked list and returns the first candidate that can be sold
 * right now, using product data just read from Shopify.
 *
 * `liveProducts`: Map of productId -> { title, status, imageUrl,
 * verifiedFacts: string[], variants: [{ id, title, availableForSale,
 * price: number, imageUrl }] }. A missing entry means Shopify no longer has
 * the product.
 * Returns { offer, skipped }; `offer` is null when nothing qualifies.
 */
export function pickOffer({ ranked, liveProducts, purchasedVariantIds = [], subtotal, maxOrderRatio }) {
  const purchasedVariants = new Set(purchasedVariantIds);
  const maxPrice = subtotal * maxOrderRatio;
  const skipped = [];

  for (const candidate of ranked) {
    const product = liveProducts.get(candidate.productId);
    const skip = (reason) => skipped.push({ productId: candidate.productId, reason });

    if (!product || product.status !== "ACTIVE") {
      skip("inactive");
      continue;
    }

    const sellable = product.variants.filter(
      (variant) => variant.availableForSale && !purchasedVariants.has(variant.id),
    );
    if (sellable.length === 0) {
      skip("out_of_stock");
      continue;
    }

    const variant = sellable.find((option) => option.price <= maxPrice);
    if (!variant) {
      skip("over_price_cap");
      continue;
    }

    return {
      offer: {
        productId: candidate.productId,
        productTitle: product.title,
        variantId: variant.id,
        variantTitle: variant.title,
        price: variant.price,
        imageUrl: variant.imageUrl ?? product.imageUrl ?? null,
        rankScore: candidate.rankScore,
        relationshipType: candidate.relationship.type,
        relationshipIds: candidate.relationshipIds,
        sourceProductIds: candidate.sourceProductIds,
        ...chooseCopy(candidate.relationship, product),
      },
      skipped,
    };
  }

  return { offer: null, skipped };
}

/**
 * Uses the AI copy only while every fact it cites is still one of the
 * product's live verified facts (the merchant may have removed one since the
 * copy was written). Otherwise falls back to template copy.
 */
export function chooseCopy(relationship, product) {
  const liveFacts = new Set(product.verifiedFacts);
  const cited = relationship.factRefs ?? [];
  const stillGrounded =
    Boolean(relationship.headline) &&
    cited.length > 0 &&
    cited.every((fact) => liveFacts.has(fact));

  if (stillGrounded) {
    return {
      copySource: "AI_COPY",
      headline: relationship.headline,
      description: relationship.description,
      factRefs: cited,
    };
  }

  return { copySource: "TEMPLATE", ...buildTemplateCopy(product.title, product.verifiedFacts) };
}

// Plain copy built only from the title and the first verified fact.
export function buildTemplateCopy(title, facts = []) {
  const headline = `Add ${title} to your order`;
  return {
    headline: headline.length <= HEADLINE_MAX ? headline : title.slice(0, HEADLINE_MAX),
    description: facts[0] ?? null,
    factRefs: facts.slice(0, 1),
  };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
