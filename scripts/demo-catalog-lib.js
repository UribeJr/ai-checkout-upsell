/**
 * Pure helpers for seed-demo-catalog.js: what to create and the Shopify input
 * for each product. No network here (tested in test/demo-catalog.test.js).
 */

export const DEMO_TAG = "case-study-demo";

export const FACTS_DEFINITION = {
  name: "Verified facts",
  namespace: "custom",
  key: "verified_facts",
  type: "list.single_line_text_field",
  ownerType: "PRODUCT",
  description: "Merchant-approved product facts. The only facts AI offer copy may use.",
};

/**
 * The productSet input for one catalog product: active, one option, untracked
 * inventory that can't oversell, and the verified facts metafield.
 */
export function toProductSetInput(product) {
  return {
    handle: product.handle,
    title: product.title,
    descriptionHtml: product.descriptionHtml,
    productType: product.productType,
    vendor: product.vendor,
    tags: product.tags,
    status: "ACTIVE",
    productOptions: [
      {
        name: product.option.name,
        values: product.option.values.map((name) => ({ name })),
      },
    ],
    variants: product.variants.map((variant) => ({
      optionValues: [{ optionName: product.option.name, name: variant.option }],
      price: variant.price,
      inventoryPolicy: "DENY",
      inventoryItem: { tracked: false },
    })),
    metafields: [
      {
        namespace: FACTS_DEFINITION.namespace,
        key: FACTS_DEFINITION.key,
        type: FACTS_DEFINITION.type,
        value: JSON.stringify(product.verifiedFacts),
      },
    ],
  };
}

/**
 * Decides what a run would do. Existing products (same handle) are skipped,
 * never changed, so running the script twice is safe.
 * Returns { createDefinition, create: product[], skip: product[] }.
 */
export function planSeed({ catalog, existingHandles, hasDefinition }) {
  const existing = new Set(existingHandles);
  return {
    createDefinition: !hasDefinition,
    create: catalog.products.filter((product) => !existing.has(product.handle)),
    skip: catalog.products.filter((product) => existing.has(product.handle)),
  };
}

// An existing custom.verified_facts definition must have our type, or every
// product would fail to save its facts. Returns an error message or null.
export function checkDefinition(definition) {
  if (!definition || definition.type?.name === FACTS_DEFINITION.type) return null;
  return (
    `custom.verified_facts already exists with type ${definition.type?.name ?? "unknown"}; ` +
    `the demo needs ${FACTS_DEFINITION.type}. Use a fresh development store, or change that definition first.`
  );
}

// Only development stores may be seeded, so a production store is never touched.
export function checkStore(shop) {
  if (!shop?.plan?.partnerDevelopment) {
    return `${shop?.myshopifyDomain ?? "This store"} is not a development store; refusing to seed it.`;
  }
  return null;
}
