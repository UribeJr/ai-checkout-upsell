import prisma from "../../db.server";
import { enrichProduct, ENRICHMENT_PROMPT_VERSION } from "./enrichment.server";
import { generateRelationships, RELATIONSHIP_PROMPT_VERSION } from "./relationships.server";

/**
 * The enrichment queue. Each ProductIntelligence row is its own job:
 * a unique row per product means a product can't be queued twice, and the
 * row's status, attempts and nextAttemptAt are the job state.
 *
 * Good enough for one app instance in a case study. In production this
 * becomes a real queue (SQS, BullMQ, ...) with the same steps per job.
 */

const MAX_ATTEMPTS = 3;

// Shops with a run in progress (in-process lock: one runner per shop).
const runningShops = new Set();

export function isQueueRunning(shop) {
  return runningShops.has(shop);
}

// Starts a run in the background; callers (webhooks, admin buttons) don't wait.
export function startQueue(shop) {
  processQueue({ shop }).catch((error) =>
    console.error(`[queue] ${shop}: run crashed: ${error.message}`),
  );
}

// Queues every active product again, e.g. after a prompt change.
export async function reEnrichAll(shop) {
  await prisma.productIntelligence.updateMany({
    where: { shop, deletedAt: null },
    data: { enrichmentStatus: "PENDING", attempts: 0, nextAttemptAt: null, lastError: null },
  });
  startQueue(shop);
}

/**
 * One run: enrich every due product, then rebuild relationships if any
 * profile changed (a new or changed product can affect every other
 * product's best offers).
 */
export async function processQueue({ shop }) {
  if (runningShops.has(shop)) return { skipped: true };
  runningShops.add(shop);

  try {
    const summary = { enriched: 0, failed: 0, relationshipsUpdated: 0 };

    for (const row of await findDueProducts(shop)) {
      const ok = await enrichOne(row);
      summary[ok ? "enriched" : "failed"]++;
    }

    if (summary.enriched > 0) {
      summary.relationshipsUpdated = await rebuildRelationships(shop);
    }

    console.log(`[queue] ${shop}: ${JSON.stringify(summary)}`);
    return summary;
  } finally {
    runningShops.delete(shop);
  }
}

// PENDING rows, FAILED rows whose retry time has come, and rows enriched
// with an older prompt version.
function findDueProducts(shop) {
  return prisma.productIntelligence.findMany({
    where: {
      shop,
      deletedAt: null,
      OR: [
        { enrichmentStatus: "PENDING" },
        { enrichmentStatus: "FAILED", attempts: { lt: MAX_ATTEMPTS }, nextAttemptAt: { lte: new Date() } },
        { enrichmentStatus: "ENRICHED", enrichmentVersion: { not: ENRICHMENT_PROMPT_VERSION } },
      ],
    },
  });
}

// Returns true on success. On failure the previous profile is kept as is.
async function enrichOne(row) {
  await prisma.productIntelligence.update({
    where: { id: row.id },
    data: { enrichmentStatus: "PROCESSING" },
  });

  try {
    const { profile, modelName, durationMs, warnings } = await enrichProduct(row);

    await prisma.productIntelligence.update({
      where: { id: row.id },
      data: {
        category: profile.category,
        format: profile.format,
        attributes: JSON.stringify(profile.attributes),
        useCases: JSON.stringify(profile.useCases),
        crossSellAngles: JSON.stringify(profile.crossSellAngles),
        factRefs: JSON.stringify(profile.factRefs),
        enrichedHash: row.sourceHash,
        enrichmentVersion: ENRICHMENT_PROMPT_VERSION,
        modelName,
        enrichedAt: new Date(),
        enrichmentStatus: "ENRICHED",
        attempts: 0,
        nextAttemptAt: null,
        lastError: null,
      },
    });

    console.log(
      `[enrich] ${row.title}: ok model=${modelName} version=${ENRICHMENT_PROMPT_VERSION} ${durationMs}ms warnings=${warnings.length}`,
    );
    return true;
  } catch (error) {
    const attempts = row.attempts + 1;
    // Retry after 1, 2, 4 ... minutes; stop after MAX_ATTEMPTS.
    const nextAttemptAt =
      attempts < MAX_ATTEMPTS ? new Date(Date.now() + 2 ** (attempts - 1) * 60_000) : null;

    await prisma.productIntelligence.update({
      where: { id: row.id },
      data: {
        enrichmentStatus: "FAILED",
        attempts,
        nextAttemptAt,
        lastError: `${error.code ?? "error"}: ${error.message}`.slice(0, 500),
      },
    });

    console.error(`[enrich] ${row.title}: failed (attempt ${attempts}): ${error.message}`);
    return false;
  }
}

/**
 * Regenerates relationships for every product that has a profile.
 * Each product's edges are replaced in one transaction; if the AI call fails,
 * that product keeps its previous edges. Returns how many were updated.
 */
async function rebuildRelationships(shop) {
  const profiled = await prisma.productIntelligence.findMany({
    where: { shop, deletedAt: null, enrichedHash: { not: null } },
  });

  let updated = 0;
  for (const source of profiled) {
    const others = profiled.filter((row) => row.productId !== source.productId);

    try {
      const { edges, dropped, modelName, durationMs } = await generateRelationships({ source, others });

      await prisma.$transaction([
        prisma.productRelationship.deleteMany({
          where: { shop, sourceProductId: source.productId },
        }),
        prisma.productRelationship.createMany({
          data: edges.map((edge) => ({
            shop,
            sourceProductId: source.productId,
            ...edge,
            version: RELATIONSHIP_PROMPT_VERSION,
          })),
        }),
      ]);

      updated++;
      console.log(
        `[relationships] ${source.title}: ${edges.length} kept, ${dropped.length} dropped, model=${modelName} ${durationMs}ms`,
      );
    } catch (error) {
      await prisma.productIntelligence.update({
        where: { id: source.id },
        data: { lastError: `relationships: ${error.message}`.slice(0, 500) },
      });
      console.error(`[relationships] ${source.title}: failed, kept previous edges: ${error.message}`);
    }
  }

  return updated;
}
