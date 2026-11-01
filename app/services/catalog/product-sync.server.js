import prisma from "../../db.server";
import { fetchActiveProducts } from "./shopify-catalog.server";
import { buildSnapshot, buildSourceHash } from "./product-snapshot";
import { isInUpsellCatalog } from "./catalog-scope";
import { getSettings } from "../settings.server";

/**
 * Keeps ProductIntelligence in step with the Shopify catalog.
 *
 * A product whose AI-relevant content changed (or that is new) is marked
 * PENDING, which queues it for enrichment. Unchanged products are left alone,
 * so a re-sync costs no AI calls.
 */

// Full sync: upsert every product in the upsell catalog (ACTIVE, plus the
// upsell tag when one is set) and retire the ones that are gone or untagged.
export async function syncCatalog({ shop, admin }) {
  const { upsellTag } = await getSettings(shop);
  // Shopify's search index can lag behind a tag edit, so check the tag again.
  const products = (await fetchActiveProducts(admin, { tag: upsellTag })).filter((product) =>
    isInUpsellCatalog(product, upsellTag),
  );
  const now = new Date();
  const counts = { created: 0, changed: 0, unchanged: 0, removed: 0 };

  for (const product of products) {
    const result = await upsertProductSnapshot({ shop, product, now });
    counts[result]++;
  }

  const activeIds = products.map((product) => product.id);
  counts.removed = await retireProducts({
    shop,
    where: { productId: { notIn: activeIds } },
    now,
  });

  const scope = upsellTag ? `tag "${upsellTag}"` : "all active products";
  console.log(`[sync] ${shop} (${scope}): ${JSON.stringify(counts)}`);
  return counts;
}

/**
 * Saves the latest snapshot of one product.
 * Returns "created", "changed" (needs enrichment) or "unchanged" (nothing
 * for the AI to do).
 */
export async function upsertProductSnapshot({ shop, product, now = new Date() }) {
  const snapshot = buildSnapshot(product);
  const sourceHash = buildSourceHash(product.title, snapshot);

  const fields = {
    title: product.title,
    handle: product.handle,
    status: product.status,
    snapshot: JSON.stringify(snapshot),
    sourceHash,
    syncedAt: now,
    deletedAt: null,
  };

  const existing = await prisma.productIntelligence.findUnique({
    where: { shop_productId: { shop, productId: product.id } },
  });

  if (!existing) {
    await prisma.productIntelligence.create({
      data: { ...fields, shop, productId: product.id, enrichmentStatus: "PENDING" },
    });
    return "created";
  }

  // A product coming back after being retired lost its relationships, so it
  // needs enrichment again even if its content is the same.
  const wasRetired = existing.deletedAt !== null;

  if (existing.sourceHash === sourceHash && !wasRetired) {
    await prisma.productIntelligence.update({ where: { id: existing.id }, data: fields });
    return "unchanged";
  }

  // Compare with what the AI last enriched, not only the last stored version:
  // an edit that is undone before the next run puts the product back to
  // ENRICHED, so the run has nothing to redo. (An in-flight AI call for the
  // undone edit is discarded by the queue's sourceHash check.)
  if (existing.enrichedHash === sourceHash && !wasRetired) {
    await prisma.productIntelligence.update({
      where: { id: existing.id },
      data: { ...fields, enrichmentStatus: "ENRICHED", attempts: 0, nextAttemptAt: null, lastError: null },
    });
    return "unchanged";
  }

  await prisma.productIntelligence.update({
    where: { id: existing.id },
    data: { ...fields, enrichmentStatus: "PENDING", attempts: 0, nextAttemptAt: null, lastError: null },
  });
  return "changed";
}

/**
 * Marks products as no longer sellable (archived, draft or deleted in
 * Shopify) and removes every relationship pointing from or to them, so they
 * can't be offered. Returns how many products were retired.
 */
export async function retireProducts({ shop, where, now = new Date() }) {
  const retiring = await prisma.productIntelligence.findMany({
    where: { shop, deletedAt: null, ...where },
    select: { productId: true },
  });
  if (retiring.length === 0) return 0;

  const productIds = retiring.map((row) => row.productId);

  await prisma.$transaction([
    prisma.productIntelligence.updateMany({
      where: { shop, productId: { in: productIds } },
      data: { deletedAt: now },
    }),
    prisma.productRelationship.deleteMany({
      where: {
        shop,
        OR: [
          { sourceProductId: { in: productIds } },
          { targetProductId: { in: productIds } },
        ],
      },
    }),
  ]);

  return productIds.length;
}
