import { test } from "node:test";
import assert from "node:assert/strict";
import {
  basketKey,
  buildChanges,
  checkStoredPick,
  toExtensionOffer,
} from "../app/services/offers/offer-payload.js";

const JAR_VARIANT = "gid://shopify/ProductVariant/50";
const POLICY = { minScore: 0.6, maxOrderRatio: 1, discountPercent: 15 };

function liveJar(extra = {}) {
  return {
    title: "Glass Storage Jar",
    status: "ACTIVE",
    imageUrl: null,
    verifiedFacts: [],
    variants: [{ id: JAR_VARIANT, title: "Default Title", availableForSale: true, price: 24, imageUrl: null }],
    ...extra,
  };
}

// ---- buildChanges

test("changes add one unit of the numeric variant with the discount", () => {
  assert.deepEqual(buildChanges(JAR_VARIANT, 15), [
    {
      type: "add_variant",
      variantId: 50,
      quantity: 1,
      discount: { value: 15, valueType: "percentage", title: "15% off" },
    },
  ]);
});

test("no discount when the policy is 0%", () => {
  assert.deepEqual(buildChanges(JAR_VARIANT, 0), [{ type: "add_variant", variantId: 50, quantity: 1 }]);
});

// ---- basketKey

test("basket key ignores variant order but changes with the policy", () => {
  const a = basketKey({ variantIds: ["v2", "v1"], policy: POLICY });
  const b = basketKey({ variantIds: ["v1", "v2"], policy: POLICY });
  const c = basketKey({ variantIds: ["v1", "v2"], policy: { ...POLICY, discountPercent: 10 } });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

// ---- checkStoredPick

test("a stored pick that is still sellable passes", () => {
  assert.equal(checkStoredPick(liveJar(), JAR_VARIANT, { maxPrice: 49.99 }), null);
});

test("stored pick reasons: deleted, archived, unavailable, purchased, over the cap", () => {
  const unavailable = liveJar({ variants: [{ ...liveJar().variants[0], availableForSale: false }] });
  assert.equal(checkStoredPick(undefined, JAR_VARIANT, { maxPrice: 49.99 }), "inactive");
  assert.equal(checkStoredPick(liveJar({ status: "ARCHIVED" }), JAR_VARIANT, { maxPrice: 49.99 }), "inactive");
  assert.equal(checkStoredPick(unavailable, JAR_VARIANT, { maxPrice: 49.99 }), "out_of_stock");
  assert.equal(checkStoredPick(liveJar({ variants: [] }), JAR_VARIANT, { maxPrice: 49.99 }), "out_of_stock");
  assert.equal(
    checkStoredPick(liveJar(), JAR_VARIANT, { maxPrice: 49.99, purchasedVariantIds: [JAR_VARIANT] }),
    "out_of_stock",
  );
  assert.equal(checkStoredPick(liveJar(), JAR_VARIANT, { maxPrice: 20 }), "over_price_cap");
});

// ---- toExtensionOffer

test("extension payload: decision id, stored copy, server-built changes, no prices", () => {
  const offer = toExtensionOffer(
    {
      id: "decision-1",
      selectedVariantId: JAR_VARIANT,
      headline: "Keep it fresh",
      description: "Airtight glass jar.",
      discountPercent: 15,
    },
    { productTitle: "Glass Storage Jar", imageUrl: undefined },
  );
  assert.deepEqual(Object.keys(offer).sort(), [
    "changes",
    "description",
    "discountPercent",
    "headline",
    "id",
    "imageUrl",
    "productTitle",
  ]);
  assert.equal(offer.id, "decision-1");
  assert.equal(offer.imageUrl, null);
  assert.equal(offer.changes[0].variantId, 50);
});
