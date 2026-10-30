import { generateStructured } from "../ai/provider.server";
import { RELATIONSHIPS_SCHEMA } from "../ai/schemas";
import { validateRelationships } from "../ai/validators";

/**
 * Step 2 of product intelligence: for one source product, which other
 * catalog products are worth offering right after it is bought?
 *
 * The model sees the source profile plus a compact list of the rest of the
 * catalog. With ~10 products the whole catalog fits in one request; a large
 * catalog would first narrow this list (by category or embeddings).
 */

// Bump when the prompt or schema changes.
export const RELATIONSHIP_PROMPT_VERSION = "relationships-v1";

const TIMEOUT_MS = 30_000;

const INSTRUCTIONS = `You decide which other products in a small catalog are worth offering
right after a customer buys the source product, as a one-click post-purchase add-on.

Rules:
- Only use productId values from the catalog list. Never invent products.
- Return at most 5. Fewer, or none, is fine if nothing fits well.
- type:
  COMPLEMENTARY = used alongside the source product
  ACCESSORY = holds, mixes or carries the source product
  REFILL = replenishes the source product
  UPGRADE = a larger or bundled version of the same thing, or a bundle that already includes it
- score (0 to 1): how useful this offer is right after this purchase. Score low
  anything that duplicates what was just bought.
- reasoning: one short sentence, grounded in the product data. No health or
  efficacy claims, no prices.`;

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
 * Returns { edges, dropped, modelName, durationMs }; throws AiError.
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

  const { edges, dropped } = validateRelationships(data, {
    sourceProductId: source.productId,
    catalogProductIds: others.map((row) => row.productId),
  });

  return { edges, dropped, modelName, durationMs };
}
