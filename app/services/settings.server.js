import prisma from "../db.server";

/**
 * Per-shop settings, edited on the Settings page.
 *
 * autoEnrich: when true, a product change from Shopify starts AI enrichment
 * right away. When false, the change is recorded (product marked PENDING) and
 * waits for a manual run, so AI cost only happens when the merchant runs it.
 */
const DEFAULTS = { autoEnrich: true };

export async function getSettings(shop) {
  const row = await prisma.shopSettings.findUnique({ where: { shop } });
  return row ? { autoEnrich: row.autoEnrich } : { ...DEFAULTS };
}

export async function updateSettings(shop, changes) {
  await prisma.shopSettings.upsert({
    where: { shop },
    create: { shop, ...changes },
    update: changes,
  });
}
