import { test } from "node:test";
import assert from "node:assert/strict";
import { LOW_SAMPLE_IMPRESSIONS, summarize } from "../app/services/analytics/metrics.js";

const JAR = "gid://shopify/Product/5";
const SHAKER = "gid://shopify/Product/4";
const TITLES = { [JAR]: "Glass Storage Jar", [SHAKER]: "Stainless Shaker Bottle" };

const decision = (selectedProductId, ...events) => ({
  selectedProductId,
  events: events.map(([type, value = null]) => ({ type, value })),
});

test("conversion, revenue and revenue per offer shown", () => {
  const { totals } = summarize(
    [
      decision(JAR, ["IMPRESSION"], ["ACCEPTED"], ["APPLIED", 17]),
      decision(SHAKER, ["IMPRESSION"], ["DECLINED"]),
      decision(JAR, ["IMPRESSION"], ["ACCEPTED"], ["APPLY_FAILED"]),
    ],
    TITLES,
  );
  assert.equal(totals.impressions, 3);
  assert.equal(totals.accepted, 2);
  assert.equal(totals.applied, 1);
  assert.equal(totals.applyFailed, 1);
  assert.equal(totals.declined, 1);
  assert.equal(totals.revenue, 17);
  assert.equal(totals.conversion, 1 / 3);
  assert.equal(totals.acceptRate, 2 / 3);
  assert.equal(totals.revenuePerImpression, 5.67);
});

test("checkouts without an offer or without an impression don't count as shown", () => {
  const { totals } = summarize([decision(null), decision(JAR), decision(JAR, ["IMPRESSION"])]);
  assert.equal(totals.checkouts, 3);
  assert.equal(totals.offersDecided, 2);
  assert.equal(totals.impressions, 1);
});

test("no impressions gives empty rates, not division by zero", () => {
  const { totals, topOffers } = summarize([decision(JAR)], TITLES);
  assert.equal(totals.conversion, null);
  assert.equal(totals.revenuePerImpression, null);
  assert.equal(topOffers[0].conversion, null);
});

test("an APPLIED event without a trusted value adds no revenue", () => {
  const { totals } = summarize([decision(JAR, ["IMPRESSION"], ["APPLIED", null])]);
  assert.equal(totals.applied, 1);
  assert.equal(totals.revenue, 0);
});

test("top offers are ranked by revenue per offer shown and flag small samples", () => {
  const { topOffers } = summarize(
    [
      decision(SHAKER, ["IMPRESSION"], ["DECLINED"]),
      decision(JAR, ["IMPRESSION"], ["APPLIED", 17]),
      decision(JAR, ["IMPRESSION"], ["DECLINED"]),
    ],
    TITLES,
  );
  assert.deepEqual(topOffers.map((offer) => offer.title), ["Glass Storage Jar", "Stainless Shaker Bottle"]);
  assert.equal(topOffers[0].revenuePerImpression, 8.5);
  assert.equal(topOffers[0].conversion, 0.5);
  assert.equal(topOffers[0].lowSample, true);
});

test("an offer with enough impressions is not flagged", () => {
  const many = Array.from({ length: LOW_SAMPLE_IMPRESSIONS }, () => decision(JAR, ["IMPRESSION"]));
  assert.equal(summarize(many, TITLES).topOffers[0].lowSample, false);
});
