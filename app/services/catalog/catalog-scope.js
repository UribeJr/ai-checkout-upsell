/**
 * Which products are in the upsell catalog. No database or network here
 * (tested in test/catalog-scope.test.js).
 *
 * Rule: a product is in the catalog when it is ACTIVE and, if the merchant
 * set an upsell tag on the Settings page, it has that tag. No tag means every
 * active product, which is the default.
 */

const TAG_MAX = 255;

/**
 * Cleans the tag typed on the Settings page.
 * Returns { tag } (null when empty) or { error }.
 */
export function normalizeTag(value) {
  const tag = String(value ?? "").trim();
  if (!tag) return { tag: null };
  if (tag.length > TAG_MAX) return { error: `Use a tag of at most ${TAG_MAX} characters.` };
  // Quotes and backslashes would break the Shopify search query.
  if (/['"\\]/.test(tag)) return { error: "Tags can't contain quotes or backslashes." };
  return { tag };
}

// Shopify tags match case-insensitively, so we do the same.
export function isInUpsellCatalog(product, tag) {
  if (!product || product.status !== "ACTIVE") return false;
  if (!tag) return true;
  const wanted = tag.trim().toLowerCase();
  return (product.tags ?? []).some((productTag) => productTag.trim().toLowerCase() === wanted);
}

// The Admin API search string for the catalog sync.
export function catalogSearchQuery(tag) {
  return tag ? `status:active AND tag:'${tag}'` : "status:active";
}
