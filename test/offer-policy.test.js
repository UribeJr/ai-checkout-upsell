import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeOfferPolicyInput,
  resolveOfferPolicy,
} from "../app/services/offers/offer-policy.js";

// ---- normalizeOfferPolicyInput

test("valid values are saved; empty fields mean use the default", () => {
  assert.deepEqual(normalizeOfferPolicyInput({ discountPercent: "10", maxOrderRatio: "1.5" }), {
    policy: { discountPercent: 10, maxOrderRatio: 1.5 },
  });
  assert.deepEqual(normalizeOfferPolicyInput({ discountPercent: "", maxOrderRatio: " " }), {
    policy: { discountPercent: null, maxOrderRatio: null },
  });
  assert.deepEqual(normalizeOfferPolicyInput({ discountPercent: "0", maxOrderRatio: "0.1" }).policy, {
    discountPercent: 0,
    maxOrderRatio: 0.1,
  });
});

test("discounts outside 0-50 or with decimals are rejected", () => {
  for (const discountPercent of ["-1", "51", "12.5", "abc"]) {
    assert.ok(normalizeOfferPolicyInput({ discountPercent }).errors.discountPercent, discountPercent);
  }
});

test("price caps outside 0.1-5 are rejected; others round to 2 decimals", () => {
  for (const maxOrderRatio of ["0", "6", "abc"]) {
    assert.ok(normalizeOfferPolicyInput({ maxOrderRatio }).errors.maxOrderRatio, maxOrderRatio);
  }
  assert.equal(normalizeOfferPolicyInput({ maxOrderRatio: "1.234" }).policy.maxOrderRatio, 1.23);
});

// ---- resolveOfferPolicy

test("saved settings win over env defaults", () => {
  const policy = resolveOfferPolicy(
    { discountPercent: 10, maxOrderRatio: 2 },
    { OFFER_DISCOUNT_PERCENT: "20", OFFER_MAX_ORDER_RATIO: "1" },
  );
  assert.equal(policy.discountPercent, 10);
  assert.equal(policy.maxOrderRatio, 2);
  assert.deepEqual(policy.sources, { discountPercent: "settings", maxOrderRatio: "settings" });
});

test("a saved 0% discount is kept, not treated as unset", () => {
  assert.equal(resolveOfferPolicy({ discountPercent: 0 }, { OFFER_DISCOUNT_PERCENT: "15" }).discountPercent, 0);
});

test("unsaved values fall back to env, then to built-in defaults", () => {
  const fromEnv = resolveOfferPolicy({ discountPercent: null }, { OFFER_DISCOUNT_PERCENT: "20", OFFER_MAX_ORDER_RATIO: "0.5" });
  assert.equal(fromEnv.discountPercent, 20);
  assert.equal(fromEnv.maxOrderRatio, 0.5);
  assert.deepEqual(fromEnv.sources, { discountPercent: "default", maxOrderRatio: "default" });

  const builtIn = resolveOfferPolicy({}, {});
  assert.equal(builtIn.discountPercent, 15);
  assert.equal(builtIn.maxOrderRatio, 1);
  assert.equal(builtIn.minScore, 0.6);
});
