import { test } from "node:test";
import assert from "node:assert/strict";
import {
  catalogSearchQuery,
  isInUpsellCatalog,
  normalizeTag,
} from "../app/services/catalog/catalog-scope.js";

const product = (extra = {}) => ({ status: "ACTIVE", tags: ["upsell", "travel"], ...extra });

test("no tag means every active product", () => {
  assert.equal(isInUpsellCatalog(product({ tags: [] }), null), true);
  assert.equal(catalogSearchQuery(null), "status:active");
});

test("with a tag, only active products that have it are in", () => {
  assert.equal(isInUpsellCatalog(product(), "travel"), true);
  assert.equal(isInUpsellCatalog(product(), "bundle"), false);
  assert.equal(isInUpsellCatalog(product({ status: "ARCHIVED" }), "travel"), false);
  assert.equal(isInUpsellCatalog(product({ status: "DRAFT" }), null), false);
  assert.equal(isInUpsellCatalog(null, null), false);
  assert.equal(catalogSearchQuery("travel"), "status:active AND tag:'travel'");
});

test("tag matching ignores case and surrounding spaces", () => {
  assert.equal(isInUpsellCatalog(product({ tags: ["Upsell "] }), "upsell"), true);
});

test("the tag from Settings is trimmed; empty means all products", () => {
  assert.deepEqual(normalizeTag("  upsell "), { tag: "upsell" });
  assert.deepEqual(normalizeTag(""), { tag: null });
  assert.deepEqual(normalizeTag(null), { tag: null });
  assert.deepEqual(normalizeTag("drink mix"), { tag: "drink mix" });
});

test("tags that would break the search query are rejected", () => {
  assert.ok(normalizeTag("it's").error);
  assert.ok(normalizeTag('say "hi"').error);
  assert.ok(normalizeTag("a\\b").error);
  assert.ok(normalizeTag("x".repeat(256)).error);
});
