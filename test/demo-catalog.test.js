import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEMO_TAG,
  checkDefinition,
  checkStore,
  planSeed,
  toProductSetInput,
} from "../scripts/demo-catalog-lib.js";

const catalog = JSON.parse(readFileSync(new URL("../scripts/demo-catalog.json", import.meta.url), "utf8"));

// ---- the catalog file

test("the catalog has 10 demo products with unique handles", () => {
  assert.equal(catalog.products.length, 10);
  const handles = catalog.products.map((product) => product.handle);
  assert.equal(new Set(handles).size, handles.length);
  for (const product of catalog.products) assert.ok(product.tags.includes(DEMO_TAG), product.title);
});

test("every variant matches its option, has a price and every product has facts", () => {
  for (const product of catalog.products) {
    assert.ok(product.variants.length > 0, product.title);
    for (const variant of product.variants) {
      assert.ok(product.option.values.includes(variant.option), `${product.title}: ${variant.option}`);
      assert.ok(Number(variant.price) > 0, `${product.title}: price`);
    }
    assert.ok(product.verifiedFacts.length > 0, `${product.title}: facts`);
  }
});

// ---- toProductSetInput

test("productSet input: active, untracked, can't oversell, facts as JSON", () => {
  const pouch = catalog.products.find((product) => product.handle === "demo-daily-greens-gummies-28-day");
  const input = toProductSetInput(pouch);

  assert.equal(input.status, "ACTIVE");
  assert.deepEqual(input.productOptions, [{ name: "Flavor", values: [{ name: "Original" }, { name: "Berry" }] }]);
  assert.deepEqual(input.variants[1], {
    optionValues: [{ optionName: "Flavor", name: "Berry" }],
    price: "49.99",
    inventoryPolicy: "DENY",
    inventoryItem: { tracked: false },
  });
  assert.deepEqual(input.metafields[0], {
    namespace: "custom",
    key: "verified_facts",
    type: "list.single_line_text_field",
    value: JSON.stringify(pouch.verifiedFacts),
  });
});

// ---- planSeed

test("existing products are skipped, never changed", () => {
  const plan = planSeed({
    catalog,
    existingHandles: ["demo-canvas-tote", "demo-glass-storage-jar"],
    hasDefinition: true,
  });
  assert.equal(plan.createDefinition, false);
  assert.equal(plan.create.length, 8);
  assert.deepEqual(plan.skip.map((product) => product.handle).sort(), ["demo-canvas-tote", "demo-glass-storage-jar"]);
});

test("a fresh store gets the definition and all products", () => {
  const plan = planSeed({ catalog, existingHandles: [], hasDefinition: false });
  assert.equal(plan.createDefinition, true);
  assert.equal(plan.create.length, 10);
});

// ---- checkStore

test("only development stores can be seeded", () => {
  assert.equal(checkStore({ myshopifyDomain: "dev.myshopify.com", plan: { partnerDevelopment: true } }), null);
  assert.match(
    checkStore({ myshopifyDomain: "live.myshopify.com", plan: { partnerDevelopment: false } }),
    /not a development store/,
  );
  assert.match(checkStore(undefined), /not a development store/);
});

// ---- checkDefinition

test("an existing facts definition must have the demo's type", () => {
  assert.equal(checkDefinition(null), null);
  assert.equal(checkDefinition({ type: { name: "list.single_line_text_field" } }), null);
  assert.match(checkDefinition({ type: { name: "multi_line_text_field" } }), /already exists with type multi_line_text_field/);
});
