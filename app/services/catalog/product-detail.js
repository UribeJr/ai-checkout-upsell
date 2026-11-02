import { MIN_SCORE } from "../offers/candidate-ranking.js";

/**
 * Pure helpers for the product detail page: turn a stored ProductIntelligence
 * row and its relationships into what the page shows. No database or AI here
 * (tested in test/product-detail.test.js).
 */

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * Whether the AI profile matches the product's current content:
 * NOT_ENRICHED (never enriched), CURRENT, or OUT_OF_DATE (content changed
 * since the last AI run).
 */
export function profileState(row) {
  if (!row.enrichedHash) return "NOT_ENRICHED";
  return row.enrichedHash === row.sourceHash ? "CURRENT" : "OUT_OF_DATE";
}

/**
 * Why checkout would never offer this relationship ("upgrade" or
 * "below_min_score"), or null if it can be offered. Same rules as
 * candidate-ranking.js, before the live stock and price checks.
 */
export function checkoutSkipReason(edge, minScore = MIN_SCORE) {
  if (edge.type === "UPGRADE") return "upgrade";
  if (edge.score < minScore) return "below_min_score";
  return null;
}

const byScore = (a, b) => b.score - a.score;

/**
 * `outgoing`: relationships from this product (offers after buying it).
 * `incoming`: relationships to it (products it's offered after).
 * `titles`: productId -> title, for the other side of each relationship.
 */
export function toProductDetail(row, { outgoing = [], incoming = [], titles = {} } = {}) {
  const snapshot = parseJson(row.snapshot, {});
  const title = (productId) => titles[productId] ?? productId;

  return {
    productId: row.productId,
    numericId: row.productId.split("/").pop(),
    title: row.title,
    status: row.status,
    retired: row.deletedAt !== null && row.deletedAt !== undefined,
    enrichmentStatus: row.enrichmentStatus,
    profileState: profileState(row),
    attempts: row.attempts ?? 0,
    lastError: row.lastError ?? null,
    // What the AI read.
    read: {
      description: snapshot.description ?? "",
      productType: snapshot.productType ?? "",
      tags: snapshot.tags ?? [],
      options: snapshot.options ?? [],
      variants: (snapshot.variants ?? []).map((variant) => variant.title),
      verifiedFacts: snapshot.verifiedFacts ?? [],
    },
    // What the AI concluded.
    profile: {
      category: row.category ?? null,
      format: row.format ?? null,
      attributes: parseJson(row.attributes, []),
      useCases: parseJson(row.useCases, []),
      crossSellAngles: parseJson(row.crossSellAngles, []),
      factRefs: parseJson(row.factRefs, []),
      modelName: row.modelName ?? null,
      enrichmentVersion: row.enrichmentVersion ?? null,
      enrichedAt: row.enrichedAt ? new Date(row.enrichedAt).toISOString() : null,
    },
    outgoing: [...outgoing].sort(byScore).map((edge) => ({
      id: edge.id,
      productId: edge.targetProductId,
      numericId: edge.targetProductId.split("/").pop(),
      title: title(edge.targetProductId),
      type: edge.type,
      score: edge.score,
      headline: edge.headline ?? null,
      description: edge.description ?? null,
      factRefs: parseJson(edge.factRefs, []),
      reasoning: edge.reasoning,
      version: edge.version,
      skipReason: checkoutSkipReason(edge),
    })),
    incoming: [...incoming].sort(byScore).map((edge) => ({
      id: edge.id,
      productId: edge.sourceProductId,
      numericId: edge.sourceProductId.split("/").pop(),
      title: title(edge.sourceProductId),
      type: edge.type,
      score: edge.score,
      skipReason: checkoutSkipReason(edge),
    })),
  };
}
