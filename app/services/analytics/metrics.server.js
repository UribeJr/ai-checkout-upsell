import prisma from "../../db.server";
import { summarize } from "./metrics";

// Enough for a demo store; production would aggregate in SQL by date range.
const DECISION_LIMIT = 500;

/**
 * Loads the shop's recent decisions with their events and summarizes them.
 * Returns { totals, topOffers, recent, currencyCode }.
 */
export async function getOfferAnalytics(shop) {
  const [decisions, products] = await Promise.all([
    prisma.offerDecision.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: DECISION_LIMIT,
      include: {
        events: { select: { type: true, value: true, reason: true }, orderBy: { createdAt: "asc" } },
      },
    }),
    prisma.productIntelligence.findMany({
      where: { shop },
      select: { productId: true, title: true },
    }),
  ]);
  const titles = Object.fromEntries(products.map((p) => [p.productId, p.title]));

  const recent = decisions.slice(0, 20).map((decision) => {
    const order = JSON.parse(decision.orderContext);
    return {
      id: decision.id,
      createdAt: decision.createdAt,
      basket: order.lineItems.map((line) => line.title).join(", "),
      offer: decision.selectedProductId ? titles[decision.selectedProductId] ?? decision.selectedProductId : null,
      source: decision.source,
      events: decision.events.map((event) => (event.reason ? `${event.type} (${event.reason})` : event.type)),
      revenue: decision.events.find((event) => event.type === "APPLIED")?.value ?? null,
    };
  });

  const currencyCode = decisions.length ? JSON.parse(decisions[0].orderContext).currencyCode : null;

  return { ...summarize(decisions, titles), recent, currencyCode };
}
