import { test } from "node:test";
import assert from "node:assert/strict";
import {
  containsHealthClaim,
  validateEnrichment,
  validateOfferCopy,
  validateRelationships,
} from "../app/services/ai/validators.js";

const verifiedFacts = ["56 gummies per pouch", "Resealable pouch"];

const goodProfile = {
  category: "Greens gummies",
  productFormat: "Resealable pouch",
  attributes: [{ name: "Count", value: "56 gummies" }],
  useCases: ["daily routine", "at home"],
  crossSellAngles: ["portable version for travel"],
  factRefs: ["56 gummies per pouch"],
};

test("a well-formed profile passes unchanged", () => {
  const result = validateEnrichment(goodProfile, { verifiedFacts });
  assert.equal(result.ok, true);
  assert.deepEqual(result.profile.factRefs, ["56 gummies per pouch"]);
  assert.deepEqual(result.warnings, []);
});

test("made-up fact references are dropped", () => {
  const result = validateEnrichment(
    { ...goodProfile, factRefs: ["56 gummies per pouch", "Made with organic spinach"] },
    { verifiedFacts },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.profile.factRefs, ["56 gummies per pouch"]);
  assert.equal(result.warnings.length, 1);
});

test("health-claim wording is removed from profile lists", () => {
  const result = validateEnrichment(
    { ...goodProfile, useCases: ["daily routine", "boosts immunity"], crossSellAngles: ["supports gut health"] },
    { verifiedFacts },
  );
  assert.deepEqual(result.profile.useCases, ["daily routine"]);
  assert.deepEqual(result.profile.crossSellAngles, []);
});

test("a profile without category or format fails", () => {
  const result = validateEnrichment({ ...goodProfile, category: " ", productFormat: "" }, { verifiedFacts });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 2);
});

test("a data-type answer for productFormat fails (seen live: \"JSON\", \"object\")", () => {
  for (const productFormat of ["JSON", "object"]) {
    const result = validateEnrichment({ ...goodProfile, productFormat }, { verifiedFacts });
    assert.equal(result.ok, false, productFormat);
  }
});

test("relationships: unknown, self, invalid-type and duplicate edges are dropped", () => {
  const { edges, dropped } = validateRelationships(
    {
      relationships: [
        { targetProductId: "p2", type: "ACCESSORY", score: 0.9, reasoning: "Holds the pouch" },
        { targetProductId: "p1", type: "COMPLEMENTARY", score: 0.8, reasoning: "self" },
        { targetProductId: "p404", type: "COMPLEMENTARY", score: 0.8, reasoning: "made up" },
        { targetProductId: "p3", type: "BEST_FRIEND", score: 0.8, reasoning: "bad type" },
        { targetProductId: "p2", type: "REFILL", score: 0.5, reasoning: "duplicate" },
      ],
    },
    { sourceProductId: "p1", catalogProductIds: ["p2", "p3"] },
  );

  assert.deepEqual(edges.map((e) => e.targetProductId), ["p2"]);
  assert.deepEqual(
    dropped.map((d) => d.why),
    ["self-link", "unknown product", "invalid type", "duplicate target"],
  );
});

test("relationships: scores are clamped and the top 5 kept by score", () => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  const { edges } = validateRelationships(
    {
      relationships: ids.map((id, i) => ({
        targetProductId: id,
        type: "COMPLEMENTARY",
        score: i === 0 ? 7 : i / 10,
        reasoning: "pairs well",
      })),
    },
    { sourceProductId: "src", catalogProductIds: ids },
  );

  assert.equal(edges.length, 5);
  assert.equal(edges[0].targetProductId, "a");
  assert.equal(edges[0].score, 1);
  assert.ok(!edges.some((e) => e.targetProductId === "b")); // lowest score dropped
});

test("health-claim detector catches common wording, not ordinary copy", () => {
  assert.equal(containsHealthClaim("Boosts your immune system"), true);
  assert.equal(containsHealthClaim("Clinically proven"), true);
  assert.equal(containsHealthClaim("Take your routine anywhere"), false);
  assert.equal(containsHealthClaim("7 single-serve packets"), false);
});

const tinFacts = ["Holds up to 6 gummies", "Hinged metal lid"];
const goodCopy = {
  headline: "Take your gummies on the go",
  description: "A hinged metal tin that holds up to 6 gummies.",
  factRefs: ["Holds up to 6 gummies"],
};

test("offer copy grounded in the target's facts passes", () => {
  assert.equal(validateOfferCopy(goodCopy, tinFacts).ok, true);
});

test("offer copy is rejected for prices, discounts, claims, length or foreign facts", () => {
  const cases = {
    price: { ...goodCopy, description: "Only $9.99 today." },
    discount: { ...goodCopy, headline: "Save 15% on the tin" },
    claim: { ...goodCopy, description: "Boosts your energy on the go." },
    length: { ...goodCopy, headline: "x".repeat(61) },
    noFacts: { ...goodCopy, factRefs: [] },
    foreignFact: { ...goodCopy, factRefs: ["56 gummies per pouch"] },
  };
  for (const [name, copy] of Object.entries(cases)) {
    assert.equal(validateOfferCopy(copy, tinFacts).ok, false, name);
  }
});

test("bad copy keeps the relationship but empties its copy", () => {
  const { edges, rejectedCopy } = validateRelationships(
    {
      relationships: [
        { targetProductId: "tin", type: "ACCESSORY", score: 0.8, reasoning: "Carries gummies", ...goodCopy, headline: "Save now" },
      ],
    },
    { sourceProductId: "pouch", catalogProductIds: ["tin"], factsByProductId: { tin: tinFacts } },
  );
  assert.equal(edges.length, 1);
  assert.equal(edges[0].headline, null);
  assert.equal(rejectedCopy.length, 1);
});
