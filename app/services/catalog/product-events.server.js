import { fetchProduct } from "./shopify-catalog.server";
import { retireProducts, upsertProductSnapshot } from "./product-sync.server";
import { startQueue } from "./enrichment-queue.server";

/**
 * Keeps product intelligence current from Shopify Product Events, so a
 * manual sync is only needed for the first load or recovery.
 *
 * The subscriptions in shopify.app.toml only fire on content changes (title,
 * description, type, tags, options, verified facts, status), never on price
 * or inventory. On top of that, the content hash decides whether the AI needs
 * to run at all.
 */

// Shopify delivers at least once, so the same delivery can arrive twice.
// Remembering successfully handled delivery IDs makes duplicates a no-op.
// Only successes are remembered, so a failed delivery is processed again
// when Shopify retries it. (In memory is enough for one instance;
// production would store these.)
const handledDeliveryIds = new Set();
const MAX_REMEMBERED_DELIVERIES = 1000;

export function wasAlreadyHandled(deliveryId) {
  return Boolean(deliveryId) && handledDeliveryIds.has(deliveryId);
}

export function rememberHandled(deliveryId) {
  if (!deliveryId) return;

  handledDeliveryIds.add(deliveryId);
  if (handledDeliveryIds.size > MAX_REMEMBERED_DELIVERIES) {
    handledDeliveryIds.delete(handledDeliveryIds.values().next().value);
  }
}

/**
 * Handles one Product event. `action` is "create", "update" or "delete".
 * Returns what happened, for logging: "created", "changed", "unchanged",
 * "retired" or "ignored".
 */
export async function handleProductEvent({ shop, admin, action, productId }) {
  if (!productId) return "ignored";

  const retire = async () => {
    const count = await retireProducts({ shop, where: { productId } });
    return count > 0 ? "retired" : "ignored";
  };

  if (action === "delete") return retire();

  // Read the current product instead of trusting the event payload: events
  // can arrive late or out of order, but Shopify's current state can't.
  const product = await fetchProduct(admin, productId);
  if (!product || product.status !== "ACTIVE") return retire();

  const result = await upsertProductSnapshot({ shop, product });
  if (result !== "unchanged") startQueue(shop);
  return result;
}
