import { createHash } from "node:crypto";

/**
 * Pure helpers that turn a Shopify product into the snapshot we store and the
 * hash we use to decide whether the AI needs to look at it again.
 *
 * Only content the AI reasons about goes into the hash: title, description,
 * type, tags, options, variant titles and the merchant's verified facts.
 * Price, inventory and status are deliberately left out, so operational
 * changes never trigger a new (paid) AI call. Those are read live from
 * Shopify at checkout instead.
 */

// Builds the stored snapshot from a product returned by the catalog query.
export function buildSnapshot(product) {
  return {
    description: product.description ?? "",
    productType: product.productType ?? "",
    tags: [...(product.tags ?? [])].sort(),
    options: (product.options ?? []).map(({ name, values }) => ({ name, values })),
    variants: (product.variants?.nodes ?? []).map(({ id, title }) => ({ id, title })),
    verifiedFacts: parseVerifiedFacts(product.verifiedFacts?.value),
  };
}

// The `custom.verified_facts` metafield is a JSON list of strings.
export function parseVerifiedFacts(value) {
  if (!value) return [];

  try {
    const facts = JSON.parse(value);
    return Array.isArray(facts) ? facts.filter((fact) => typeof fact === "string") : [];
  } catch {
    return [];
  }
}

// Same AI-relevant content -> same hash. Variant IDs are excluded, so
// re-creating identical variants doesn't count as a content change.
export function buildSourceHash(title, snapshot) {
  const relevant = {
    title,
    description: snapshot.description,
    productType: snapshot.productType,
    tags: snapshot.tags,
    options: snapshot.options,
    variantTitles: snapshot.variants.map((variant) => variant.title),
    verifiedFacts: snapshot.verifiedFacts,
  };

  return createHash("sha256").update(JSON.stringify(relevant)).digest("hex");
}
