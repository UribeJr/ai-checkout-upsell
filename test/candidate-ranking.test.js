import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTemplateCopy,
  pickOffer,
  rankCandidates,
} from "../app/services/offers/candidate-ranking.js";

const POUCH = "gid://shopify/Product/1";
const POWDER = "gid://shopify/Product/2";
const TRAVEL = "gid://shopify/Product/3";
const SHAKER = "gid://shopify/Product/4";
const JAR = "gid://shopify/Product/5";

function edge(id, sourceProductId, targetProductId, score, extra = {}) {
  return {
    id,
    sourceProductId,
    targetProductId,
    type: "COMPLEMENTARY",
    score,
    headline: "Take it with you",
    description: "Seven single-serve packets.",
    factRefs: ["7 single-serve packets"],
    ...extra,
  };
}

function liveProduct(extra = {}) {
  return {
    title: "Travel Packs",
    status: "ACTIVE",
    imageUrl: null,
    verifiedFacts: ["7 single-serve packets", "2 gummies per packet"],
    variants: [{ id: "gid://shopify/ProductVariant/30", title: "Original", availableForSale: true, price: 14.99, imageUrl: null }],
    ...extra,
  };
}

// ---- rankCandidates

test("only relationships from purchased products are considered", () => {
  const { ranked } = rankCandidates({
    purchasedProductIds: [POUCH],
    relationships: [edge("a", POUCH, TRAVEL, 0.9), edge("b", POWDER, SHAKER, 0.95)],
  });
  assert.deepEqual(ranked.map((c) => c.productId), [TRAVEL]);
});

test("UPGRADE, already-purchased and weak relationships are skipped with a reason", () => {
  const { ranked, skipped } = rankCandidates({
    purchasedProductIds: [TRAVEL, POWDER],
    relationships: [
      edge("up", TRAVEL, POUCH, 0.88, { type: "UPGRADE" }),
      edge("bought", TRAVEL, POWDER, 0.9),
      edge("weak", TRAVEL, JAR, 0.55),
      edge("ok", POWDER, SHAKER, 0.91),
    ],
  });
  assert.deepEqual(ranked.map((c) => c.productId), [SHAKER]);
  assert.deepEqual(
    skipped.map((s) => [s.productId, s.reason]),
    [[POUCH, "upgrade"], [POWDER, "purchased"], [JAR, "below_min_score"]],
  );
});

test("multi-item orders: one entry per target, boosted, all relationships kept", () => {
  const { ranked } = rankCandidates({
    purchasedProductIds: [POUCH, POWDER],
    relationships: [
      edge("a", POUCH, TRAVEL, 0.8),
      edge("b", POWDER, TRAVEL, 0.7),
      edge("c", POWDER, SHAKER, 0.82),
    ],
  });
  assert.deepEqual(ranked.map((c) => c.productId), [TRAVEL, SHAKER]);
  assert.equal(ranked[0].rankScore, 0.85); // 0.8 + 0.05 for the second source
  assert.deepEqual(ranked[0].relationshipIds, ["a", "b"]);
  assert.equal(ranked[0].relationship.id, "a"); // strongest relationship supplies the copy
});

test("a target skipped from one source but eligible from another is not listed as skipped", () => {
  const { ranked, skipped } = rankCandidates({
    purchasedProductIds: [POUCH, POWDER],
    relationships: [edge("weak", POUCH, SHAKER, 0.4), edge("ok", POWDER, SHAKER, 0.9)],
  });
  assert.deepEqual(ranked.map((c) => c.productId), [SHAKER]);
  assert.deepEqual(skipped, []);
});

test("ties are ordered by product ID, so the result is stable", () => {
  const { ranked } = rankCandidates({
    purchasedProductIds: [POUCH],
    relationships: [edge("a", POUCH, JAR, 0.8), edge("b", POUCH, TRAVEL, 0.8)],
  });
  assert.deepEqual(ranked.map((c) => c.productId), [TRAVEL, JAR]);
});

// ---- pickOffer

function ranked(...edges) {
  return rankCandidates({ purchasedProductIds: [POUCH], relationships: edges }).ranked;
}

test("the top sellable candidate is offered with its AI copy", () => {
  const { offer } = pickOffer({
    ranked: ranked(edge("a", POUCH, TRAVEL, 0.9)),
    liveProducts: new Map([[TRAVEL, liveProduct()]]),
    subtotal: 49.99,
    maxOrderRatio: 1,
  });
  assert.equal(offer.variantId, "gid://shopify/ProductVariant/30");
  assert.equal(offer.copySource, "AI_COPY");
  assert.equal(offer.headline, "Take it with you");
});

test("out of stock, inactive and missing products fall through to the next candidate", () => {
  const { offer, skipped } = pickOffer({
    ranked: ranked(
      edge("a", POUCH, TRAVEL, 0.95),
      edge("b", POUCH, JAR, 0.9),
      edge("c", POUCH, POWDER, 0.85),
      edge("d", POUCH, SHAKER, 0.8),
    ),
    liveProducts: new Map([
      [TRAVEL, liveProduct({ variants: [{ ...liveProduct().variants[0], availableForSale: false }] })],
      [JAR, liveProduct({ status: "ARCHIVED" })],
      // POWDER missing: deleted in Shopify
      [SHAKER, liveProduct({ title: "Shaker" })],
    ]),
    subtotal: 49.99,
    maxOrderRatio: 1,
  });
  assert.equal(offer.productId, SHAKER);
  assert.deepEqual(
    skipped.map((s) => [s.productId, s.reason]),
    [[TRAVEL, "out_of_stock"], [JAR, "inactive"], [POWDER, "inactive"]],
  );
});

test("an already-purchased variant is not offered again", () => {
  const { offer, skipped } = pickOffer({
    ranked: ranked(edge("a", POUCH, TRAVEL, 0.9)),
    liveProducts: new Map([[TRAVEL, liveProduct()]]),
    purchasedVariantIds: ["gid://shopify/ProductVariant/30"],
    subtotal: 49.99,
    maxOrderRatio: 1,
  });
  assert.equal(offer, null);
  assert.equal(skipped[0].reason, "out_of_stock");
});

test("offers above the price cap are skipped", () => {
  const { offer, skipped } = pickOffer({
    ranked: ranked(edge("a", POUCH, TRAVEL, 0.9)),
    liveProducts: new Map([[TRAVEL, liveProduct()]]),
    subtotal: 10,
    maxOrderRatio: 1,
  });
  assert.equal(offer, null);
  assert.equal(skipped[0].reason, "over_price_cap");
});

test("template copy when a cited fact was removed by the merchant", () => {
  const { offer } = pickOffer({
    ranked: ranked(edge("a", POUCH, TRAVEL, 0.9)),
    liveProducts: new Map([[TRAVEL, liveProduct({ verifiedFacts: ["2 gummies per packet"] })]]),
    subtotal: 49.99,
    maxOrderRatio: 1,
  });
  assert.equal(offer.copySource, "TEMPLATE");
  assert.equal(offer.headline, "Add Travel Packs to your order");
  assert.equal(offer.description, "2 gummies per packet");
});

test("template copy when the AI copy failed validation (no headline)", () => {
  const { offer } = pickOffer({
    ranked: ranked(edge("a", POUCH, TRAVEL, 0.9, { headline: null, description: null, factRefs: null })),
    liveProducts: new Map([[TRAVEL, liveProduct()]]),
    subtotal: 49.99,
    maxOrderRatio: 1,
  });
  assert.equal(offer.copySource, "TEMPLATE");
});

test("no candidates means no offer", () => {
  const { offer } = pickOffer({ ranked: [], liveProducts: new Map(), subtotal: 49.99, maxOrderRatio: 1 });
  assert.equal(offer, null);
});

test("template headline stays within 60 characters", () => {
  const { headline } = buildTemplateCopy("A".repeat(70), []);
  assert.ok(headline.length <= 60);
});
