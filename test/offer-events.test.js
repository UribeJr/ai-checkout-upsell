import { test } from "node:test";
import assert from "node:assert/strict";
import { validateClientEvent } from "../app/services/analytics/offer-events.js";

const DECISION = { selectedVariantId: "gid://shopify/ProductVariant/50", offerPrice: 19.99 };

test("the extension may send impressions, declines, applied and failed", () => {
  for (const type of ["IMPRESSION", "DECLINED", "APPLY_FAILED"]) {
    assert.equal(validateClientEvent({ type }, DECISION).event.type, type);
  }
  assert.equal(validateClientEvent({ type: "APPLIED", value: "17.00" }, DECISION).event.value, 17);
});

test("ACCEPTED and unknown types are rejected from the extension", () => {
  assert.equal(validateClientEvent({ type: "ACCEPTED" }, DECISION).error, "unknown_type");
  assert.equal(validateClientEvent({ type: "PURCHASE" }, DECISION).error, "unknown_type");
});

test("no events for a decision without an offer", () => {
  assert.equal(validateClientEvent({ type: "IMPRESSION" }, { selectedVariantId: null }).error, "no_offer");
});

test("an APPLIED value is trusted only between 0 and the offer's list price", () => {
  const check = (value, decision = DECISION) => validateClientEvent({ type: "APPLIED", value }, decision).event;

  assert.deepEqual(check("19.99"), { type: "APPLIED", value: 19.99, reason: null });
  assert.deepEqual(check("25.00"), { type: "APPLIED", value: null, reason: "value_rejected" });
  assert.deepEqual(check("0"), { type: "APPLIED", value: null, reason: "value_rejected" });
  assert.deepEqual(check("abc"), { type: "APPLIED", value: null, reason: "value_rejected" });
  // Decisions saved before offerPrice existed can't be checked, so no value.
  assert.equal(check("17.00", { ...DECISION, offerPrice: null }).value, null);
});

test("failure reasons are kept short and plain", () => {
  const reason = (value) => validateClientEvent({ type: "APPLY_FAILED", reason: value }, DECISION).event.reason;
  assert.equal(reason("payment_required"), "payment_required");
  assert.equal(reason("<script>x</script>"), "scriptxscript");
  assert.equal(reason(undefined), "unknown");
  assert.equal(reason("x".repeat(100)).length, 60);
});
