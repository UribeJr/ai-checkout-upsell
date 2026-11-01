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
 */
const DEFAULTS = { autoEnrich: true, upsellTag: null };

export async function getSettings(shop) {
  const row = await prisma.shopSettings.findUnique({ where: { shop } });
  return row ? { autoEnrich: row.autoEnrich, upsellTag: row.upsellTag } : { ...DEFAULTS };
}

export async function updateSettings(shop, changes) {
  await prisma.shopSettings.upsert({
    where: { shop },
    create: { shop, ...changes },
    update: changes,
  });
}
