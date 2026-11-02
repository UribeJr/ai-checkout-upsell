import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkoutSkipReason,
  profileState,
  toProductDetail,
} from "../app/services/catalog/product-detail.js";

const TIN = "gid://shopify/Product/3";
const POUCH = "gid://shopify/Product/1";
const JAR = "gid://shopify/Product/2";

const row = (extra = {}) => ({
  productId: TIN,
  title: "Pocket Travel Tin",
  status: "ACTIVE",
  deletedAt: null,
  enrichmentStatus: "ENRICHED",
  sourceHash: "h1",
  enrichedHash: "h1",
  snapshot: JSON.stringify({
    description: "A small metal tin.",
    productType: "Accessory",
    tags: ["accessory", "upsell"],
    options: [{ name: "Finish", values: ["Silver"] }],
    variants: [{ id: "gid://shopify/ProductVariant/30", title: "Silver" }],
    verifiedFacts: ["Holds up to 6 gummies", "Hinged metal lid"],
  }),
  category: "Gummy storage",
  format: "Metal tin",
  attributes: JSON.stringify([{ name: "Lid", value: "Hinged metal lid" }]),
  useCases: JSON.stringify(["Travel"]),
  crossSellAngles: JSON.stringify(["Gummies to store in the tin"]),
  factRefs: JSON.stringify(["Hinged metal lid"]),
  modelName: "test-model",
  enrichmentVersion: "enrichment-v2",
  enrichedAt: new Date("2026-11-01T16:33:00Z"),
  ...extra,
});

const edge = (extra = {}) => ({
  id: "e1",
  sourceProductId: TIN,
  targetProductId: POUCH,
  type: "COMPLEMENTARY",
  score: 0.7,
  reasoning: "Refill for the tin",
  headline: "Fill your tin",
  description: "56 gummies per pouch.",
  factRefs: JSON.stringify(["56 gummies per pouch"]),
  version: "relationships-v3",
  ...extra,
});

test("profile state: current, out of date after a content change, or never enriched", () => {
  assert.equal(profileState(row()), "CURRENT");
  assert.equal(profileState(row({ sourceHash: "h2" })), "OUT_OF_DATE");
  assert.equal(profileState(row({ enrichedHash: null })), "NOT_ENRICHED");
});

test("upgrades and low scores are flagged as never offered at checkout", () => {
  assert.equal(checkoutSkipReason(edge({ type: "UPGRADE", score: 0.9 })), "upgrade");
  assert.equal(checkoutSkipReason(edge({ score: 0.59 })), "below_min_score");
  assert.equal(checkoutSkipReason(edge({ score: 0.6 })), null);
});

test("the detail shows what the AI read and what it concluded", () => {
  const detail = toProductDetail(row());
  assert.equal(detail.numericId, "3");
  assert.equal(detail.retired, false);
  assert.deepEqual(detail.read.verifiedFacts, ["Holds up to 6 gummies", "Hinged metal lid"]);
  assert.deepEqual(detail.read.variants, ["Silver"]);
  assert.equal(detail.profile.category, "Gummy storage");
  assert.deepEqual(detail.profile.attributes, [{ name: "Lid", value: "Hinged metal lid" }]);
  assert.deepEqual(detail.profile.factRefs, ["Hinged metal lid"]);
  assert.equal(detail.profile.enrichedAt, "2026-11-01T16:33:00.000Z");
});

test("a never-enriched or retired product still renders, with empty AI fields", () => {
  const detail = toProductDetail(
    row({ enrichedHash: null, category: null, attributes: null, useCases: null, factRefs: null,
      enrichedAt: null, deletedAt: new Date() }),
  );
  assert.equal(detail.retired, true);
  assert.equal(detail.profileState, "NOT_ENRICHED");
  assert.deepEqual(detail.profile.useCases, []);
  assert.equal(detail.profile.enrichedAt, null);
});

test("relationships are sorted by score with titles, cited facts and checkout flags", () => {
  const detail = toProductDetail(row(), {
    outgoing: [edge(), edge({ id: "e2", targetProductId: JAR, type: "UPGRADE", score: 0.9 })],
    incoming: [edge({ id: "e3", sourceProductId: POUCH, targetProductId: TIN, score: 0.68 })],
    titles: { [POUCH]: "28-Day Pouch", [JAR]: "Glass Storage Jar" },
  });

  assert.deepEqual(detail.outgoing.map((o) => o.title), ["Glass Storage Jar", "28-Day Pouch"]);
  assert.equal(detail.outgoing[0].skipReason, "upgrade");
  assert.deepEqual(detail.outgoing[1].factRefs, ["56 gummies per pouch"]);
  assert.equal(detail.incoming[0].title, "28-Day Pouch");
  assert.equal(detail.incoming[0].numericId, "1");
});

test("an unreadable JSON field doesn't break the page", () => {
  const detail = toProductDetail(row({ useCases: "{not json", snapshot: "oops" }));
  assert.deepEqual(detail.profile.useCases, []);
  assert.deepEqual(detail.read.tags, []);
});
