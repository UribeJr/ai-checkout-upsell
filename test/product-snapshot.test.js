import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSnapshot,
  buildSourceHash,
  parseVerifiedFacts,
} from "../app/services/catalog/product-snapshot.js";

// Shaped like a node from the CatalogProducts query.
const product = {
  id: "gid://shopify/Product/1",
  title: "Daily Greens Gummies, 28-Day Pouch",
  status: "ACTIVE",
  description: "A 28-day supply of chewable greens gummies.",
  productType: "Gummies",
  tags: ["greens", "upsell", "gummies"],
  options: [{ name: "Flavor", values: ["Original", "Berry"] }],
  variants: {
    nodes: [
      { id: "gid://shopify/ProductVariant/10", title: "Original" },
      { id: "gid://shopify/ProductVariant/11", title: "Berry" },
    ],
  },
  verifiedFacts: { value: JSON.stringify(["56 gummies per pouch", "Resealable pouch"]) },
};

const hashOf = (p) => buildSourceHash(p.title, buildSnapshot(p));

test("snapshot keeps the verified facts and sorts tags", () => {
  const snapshot = buildSnapshot(product);
  assert.deepEqual(snapshot.verifiedFacts, ["56 gummies per pouch", "Resealable pouch"]);
  assert.deepEqual(snapshot.tags, ["greens", "gummies", "upsell"]);
});

test("same content gives the same hash, regardless of tag order", () => {
  const reordered = { ...product, tags: ["upsell", "gummies", "greens"] };
  assert.equal(hashOf(reordered), hashOf(product));
});

test("status and variant IDs don't change the hash (no AI call needed)", () => {
  const archived = { ...product, status: "ARCHIVED" };
  const recreatedVariants = {
    ...product,
    variants: {
      nodes: [
        { id: "gid://shopify/ProductVariant/99", title: "Original" },
        { id: "gid://shopify/ProductVariant/98", title: "Berry" },
      ],
    },
  };
  assert.equal(hashOf(archived), hashOf(product));
  assert.equal(hashOf(recreatedVariants), hashOf(product));
});

test("description, facts and variant titles do change the hash", () => {
  assert.notEqual(hashOf({ ...product, description: "New copy" }), hashOf(product));
  assert.notEqual(
    hashOf({ ...product, verifiedFacts: { value: JSON.stringify(["56 gummies per pouch"]) } }),
    hashOf(product),
  );
  assert.notEqual(
    hashOf({
      ...product,
      variants: { nodes: [{ id: "gid://shopify/ProductVariant/10", title: "Mint" }] },
    }),
    hashOf(product),
  );
});

test("invalid or missing facts metafield gives an empty list", () => {
  assert.deepEqual(parseVerifiedFacts(null), []);
  assert.deepEqual(parseVerifiedFacts("not json"), []);
  assert.deepEqual(parseVerifiedFacts(JSON.stringify({ not: "a list" })), []);
  assert.deepEqual(parseVerifiedFacts(JSON.stringify(["ok", 3])), ["ok"]);
});
