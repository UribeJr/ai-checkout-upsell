import prisma from "../db.server";

/**
 * Per-shop settings, edited on the Settings page.
 *
 * autoEnrich: when true, a product change from Shopify starts AI enrichment
 * right away. When false, the change is recorded (product marked PENDING) and
 * waits for a manual run, so AI cost only happens when the merchant runs it.
 *
 * upsellTag: when set, only products with this tag are in the upsell catalog
 * (synced, enriched, offered). null means every active product.
 *
 * discountPercent, maxOrderRatio: the offer policy. null means the env
 * default (see offers/offer-policy.js).
 */
const DEFAULTS = { autoEnrich: true, upsellTag: null, discountPercent: null, maxOrderRatio: null };

export async function getSettings(shop) {
  const row = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!row) return { ...DEFAULTS };
  return {
    autoEnrich: row.autoEnrich,
    upsellTag: row.upsellTag,
    discountPercent: row.discountPercent,
    maxOrderRatio: row.maxOrderRatio,
  };
}

export async function updateSettings(shop, changes) {
  await prisma.shopSettings.upsert({
    where: { shop },
    create: { shop, ...changes },
    update: changes,
  });
}
