import { MIN_SCORE } from "./candidate-ranking.js";

/**
 * The merchant's offer policy: the discount and the price cap. Set on the
 * Settings page, with the env values as defaults. Never decided by AI.
 * Pure (tested in test/offer-policy.test.js).
 */

export const DISCOUNT_RANGE = { min: 0, max: 50 };
export const PRICE_CAP_RANGE = { min: 0.1, max: 5 };

const BUILT_IN_DEFAULTS = { discountPercent: 15, maxOrderRatio: 1 };

const isEmpty = (value) => value === null || value === undefined || String(value).trim() === "";

/**
 * Checks the values typed on the Settings page. An empty field means "use
 * the default" (null). Returns { policy } or { errors: { field: message } }.
 */
export function normalizeOfferPolicyInput({ discountPercent, maxOrderRatio }) {
  const errors = {};
  const policy = { discountPercent: null, maxOrderRatio: null };

  if (!isEmpty(discountPercent)) {
    const value = Number(discountPercent);
    if (!Number.isInteger(value) || value < DISCOUNT_RANGE.min || value > DISCOUNT_RANGE.max) {
      errors.discountPercent = `Use a whole number from ${DISCOUNT_RANGE.min} to ${DISCOUNT_RANGE.max}.`;
    } else {
      policy.discountPercent = value;
    }
  }

  if (!isEmpty(maxOrderRatio)) {
    const value = Math.round(Number(maxOrderRatio) * 100) / 100;
    if (!Number.isFinite(value) || value < PRICE_CAP_RANGE.min || value > PRICE_CAP_RANGE.max) {
      errors.maxOrderRatio = `Use a number from ${PRICE_CAP_RANGE.min} to ${PRICE_CAP_RANGE.max}.`;
    } else {
      policy.maxOrderRatio = value;
    }
  }

  return Object.keys(errors).length ? { errors } : { policy };
}

/**
 * The policy in effect: saved settings first, then the env defaults
 * (OFFER_DISCOUNT_PERCENT, OFFER_MAX_ORDER_RATIO), then the built-in ones.
 * `sources` says where each value came from, for the Settings page.
 */
export function resolveOfferPolicy(settings = {}, env = {}) {
  const envDiscount = Number(env.OFFER_DISCOUNT_PERCENT);
  const envRatio = Number(env.OFFER_MAX_ORDER_RATIO);

  const defaults = {
    discountPercent:
      !isEmpty(env.OFFER_DISCOUNT_PERCENT) && Number.isFinite(envDiscount)
        ? envDiscount
        : BUILT_IN_DEFAULTS.discountPercent,
    maxOrderRatio: envRatio > 0 ? envRatio : BUILT_IN_DEFAULTS.maxOrderRatio,
  };

  const saved = (field) => settings[field] !== null && settings[field] !== undefined;

  return {
    minScore: MIN_SCORE,
    discountPercent: saved("discountPercent") ? settings.discountPercent : defaults.discountPercent,
    // Offer price may be at most this multiple of the order subtotal.
    maxOrderRatio: saved("maxOrderRatio") ? settings.maxOrderRatio : defaults.maxOrderRatio,
    sources: {
      discountPercent: saved("discountPercent") ? "settings" : "default",
      maxOrderRatio: saved("maxOrderRatio") ? "settings" : "default",
    },
  };
}
