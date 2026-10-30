import { generateStructured } from "../ai/provider.server";
import { RELATIONSHIPS_SCHEMA } from "../ai/schemas";
import { validateRelationships } from "../ai/validators";

/**
 * Step 2 of product intelligence: for one source product, which other
 * catalog products are worth offering right after it is bought, and what
 * should the offer say?
 *
 * This is where the AI does its real work. Everything is generated offline
 * and stored, so checkout itself never waits for an AI call.
 *
 * The model sees the source profile plus a compact list of the rest of the
 * catalog. With ~10 products the whole catalog fits in one request; a large
 * catalog would first narrow this list (by category or embeddings).
 */

// Bump when the prompt or schema changes.
// v2: asks for every reasonable fit, not only the best one or two.
// v3: also writes the buyer-facing offer copy for each pairing.
export const RELATIONSHIP_PROMPT_VERSION = "relationships-v3";

const TIMEOUT_MS = 30_000;

const INSTRUCTIONS = `You decide which other products in a small catalog are worth offering
right after a customer buys the source product, as a one-click post-purchase add-on.

Rules:
- Only use productId values from the catalog list. Never invent products.
- Include every product that is a reasonable fit, up to 5, ordered by score.
  Return fewer (or none) only when fewer products genuinely fit. Our system
  filters and ranks your list later, so completeness matters more than brevity.
- Accessories that hold, carry or store the source product, or that let the
  customer use it somewhere else, are good fits.
- type:
  COMPLEMENTARY = used alongside the source product
  ACCESSORY = holds, mixes or carries the source product
  REFILL = replenishes the source product
  UPGRADE = a larger or bundled version of the same thing, or a bundle that already includes it
- score (0 to 1): how useful this offer is right after this purchase. Score low
  anything that duplicates what was just bought.
- reasoning: one short internal sentence on why the pairing makes sense.

Offer copy (shown to a buyer who has JUST bought the source product):
- headline: at most 60 characters, speaks to this pairing, e.g.
  "Take your gummies on the go".
- description: at most 160 characters, built only from the target product's
  verifiedFacts. No other claims.
- factRefs: the target product's verifiedFacts you used, copied exactly.
- Never mention prices, discounts, savings or "free".
- Never make health, medical, nutritional-benefit, efficacy or safety claims.`;

// The compact view of a product the model reasons about.
export function toCatalogEntry(row) {
  const snapshot = JSON.parse(row.snapshot);
  return {
    productId: row.productId,
    title: row.title,
    category: row.category,
    format: row.format,
    useCases: JSON.parse(row.useCases ?? "[]"),
    crossSellAngles: JSON.parse(row.crossSellAngles ?? "[]"),
    verifiedFacts: snapshot.verifiedFacts,
  };
}

/**
 * Returns validated relationships for `source` against the other products.
 * Returns { edges, dropped, rejectedCopy, modelName, durationMs }; throws AiError.
 */
export async function generateRelationships({ source, others }) {
  const { data, modelName, durationMs } = await generateStructured({
    task: "product_relationships",
    instructions: INSTRUCTIONS,
    input: {
      sourceProduct: toCatalogEntry(source),
      catalog: others.map(toCatalogEntry),
    },
    schema: RELATIONSHIPS_SCHEMA,
    timeoutMs: TIMEOUT_MS,
    maxRetries: 1,
  });

  const { edges, dropped, rejectedCopy } = validateRelationships(data, {
    sourceProductId: source.productId,
    catalogProductIds: others.map((row) => row.productId),
    factsByProductId: Object.fromEntries(
      others.map((row) => [row.productId, JSON.parse(row.snapshot).verifiedFacts]),
    ),
  });

  return { edges, dropped, rejectedCopy, modelName, durationMs };
}
