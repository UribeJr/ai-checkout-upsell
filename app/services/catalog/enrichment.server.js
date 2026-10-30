import { AiError } from "../ai/errors";
import { generateStructured } from "../ai/provider.server";
import { ENRICHMENT_SCHEMA } from "../ai/schemas";
import { validateEnrichment } from "../ai/validators";

/**
 * Step 1 of product intelligence: one product -> a structured profile
 * (category, format, attributes, use cases, cross-sell angles).
 *
 * Runs offline (never during checkout), so it can afford a longer timeout.
 * The profile is the AI's interpretation, a hypothesis stored in our
 * database. It never becomes a merchant-approved fact.
 */

// Bump when the prompt or schema changes; products are then re-enriched.
export const ENRICHMENT_PROMPT_VERSION = "enrichment-v2";

const TIMEOUT_MS = 30_000;

const INSTRUCTIONS = `You profile one product for a post-purchase recommendation system.

Describe the product's category, its physical form (productFormat, e.g. "single-serve
packets"), a few attributes (name/value),
its use cases (when or where it is used) and cross-sell angles (what kinds of
products it pairs with, and why).

Rules:
- Use only the product data in the input. Do not add facts.
- Never make health, medical, nutritional-benefit, efficacy or safety claims.
- Do not mention prices or discounts.
- factRefs: copy, word for word, the verifiedFacts entries that support your profile.
- Keep every list short (at most 5 items) and every item to a few words.`;

/**
 * Builds a validated profile for one ProductIntelligence row.
 * Returns { profile, modelName, durationMs, warnings }; throws AiError.
 */
export async function enrichProduct(row) {
  const snapshot = JSON.parse(row.snapshot);

  const { data, modelName, durationMs } = await generateStructured({
    task: "product_enrichment",
    instructions: INSTRUCTIONS,
    input: {
      title: row.title,
      description: snapshot.description,
      productType: snapshot.productType,
      tags: snapshot.tags,
      options: snapshot.options,
      verifiedFacts: snapshot.verifiedFacts,
    },
    schema: ENRICHMENT_SCHEMA,
    timeoutMs: TIMEOUT_MS,
    maxRetries: 1,
  });

  const result = validateEnrichment(data, { verifiedFacts: snapshot.verifiedFacts });
  if (!result.ok) {
    throw new AiError("invalid_output", `enrichment: ${result.errors.join("; ")}`);
  }

  return { profile: result.profile, modelName, durationMs, warnings: result.warnings };
}
