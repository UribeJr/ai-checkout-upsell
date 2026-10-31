import prisma from "../../db.server";
import { parseVerifiedFacts } from "../catalog/product-snapshot";
import { MIN_SCORE, pickOffer, rankCandidates } from "./candidate-ranking";

/**
 * The checkout offer decision, without AI: stored relationships of the
 * purchased products -> rule filters and ranking -> one live Shopify check
 * of the shortlist -> the first sellable candidate, with stored AI copy or
 * template copy.
 *
 * Cost per decision: two indexed database reads and one Admin API query.
 * The rules themselves live in candidate-ranking.js.
 */

// How many ranked candidates are checked live (one Admin query).
const LIVE_CHECK_LIMIT = 8;

const LIVE_PRODUCTS_QUERY = `#graphql
  query OfferCandidates($ids: [ID!]!) {
    shop {
      currencyCode
    }
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        status
        featuredMedia {
          preview {
            image {
              url
            }
          }
        }
        verifiedFacts: metafield(namespace: "custom", key: "verified_facts") {
          value
        }
        variants(first: 10) {
          nodes {
            id
            title
            availableForSale
            price
            image {
              url
            }
          }
        }
      }
    }
  }`;

// Merchant policy from env vars. The discount is never decided by AI.
export function getOfferPolicy() {
  const ratio = Number(process.env.OFFER_MAX_ORDER_RATIO);
  const discount = Number(process.env.OFFER_DISCOUNT_PERCENT ?? 15);
  return {
    minScore: MIN_SCORE,
    // Offer price may be at most this multiple of the order subtotal.
    maxOrderRatio: ratio > 0 ? ratio : 1,
    discountPercent: Number.isFinite(discount) ? discount : 15,
  };
}

/**
 * Reads products from Shopify right now (status, stock, price, facts).
 * Returns { products: Map<productId, product>, currencyCode }.
 */
export async function fetchLiveProducts(admin, productIds) {
  if (productIds.length === 0) return { products: new Map(), currencyCode: null };

  const response = await admin.graphql(LIVE_PRODUCTS_QUERY, { variables: { ids: productIds } });
  const { data } = await response.json();

  const products = new Map();
  for (const node of data.nodes) {
    // Deleted products come back as null.
    if (!node?.id) continue;
    products.set(node.id, {
      title: node.title,
      status: node.status,
      imageUrl: node.featuredMedia?.preview?.image?.url ?? null,
      verifiedFacts: parseVerifiedFacts(node.verifiedFacts?.value),
      variants: node.variants.nodes.map((variant) => ({
        id: variant.id,
        title: variant.title,
        availableForSale: variant.availableForSale,
        price: Number(variant.price),
        imageUrl: variant.image?.url ?? null,
      })),
    });
  }

  return { products, currencyCode: data.shop.currencyCode };
}

/**
 * Decides the offer for one purchase.
 * `purchase`: { productIds, variantIds } as Shopify GIDs, and `subtotal` in
 * the shop currency.
 * Returns { offer, ranked, skipped, policy, durationMs }; `offer` is null
 * when nothing safe qualifies.
 */
export async function findOffer({ shop, admin, purchase }) {
  const startedAt = Date.now();
  const policy = getOfferPolicy();

  const rows = await prisma.productRelationship.findMany({
    where: { shop, sourceProductId: { in: purchase.productIds } },
  });

  // Retiring a product deletes its relationships; this also guards against
  // any that point at a product retired in the meantime.
  const activeTargets = await prisma.productIntelligence.findMany({
    where: {
      shop,
      deletedAt: null,
      productId: { in: [...new Set(rows.map((row) => row.targetProductId))] },
    },
    select: { productId: true },
  });
  const activeIds = new Set(activeTargets.map((row) => row.productId));

  const { ranked, skipped: rankSkipped } = rankCandidates({
    purchasedProductIds: purchase.productIds,
    relationships: rows
      .filter((row) => activeIds.has(row.targetProductId))
      .map((row) => ({ ...row, factRefs: row.factRefs ? JSON.parse(row.factRefs) : null })),
    minScore: policy.minScore,
  });

  const shortlist = ranked.slice(0, LIVE_CHECK_LIMIT);
  const { products } = await fetchLiveProducts(
    admin,
    shortlist.map((candidate) => candidate.productId),
  );

  const { offer, skipped: pickSkipped } = pickOffer({
    ranked: shortlist,
    liveProducts: products,
    purchasedVariantIds: purchase.variantIds,
    subtotal: purchase.subtotal,
    maxOrderRatio: policy.maxOrderRatio,
  });

  return {
    offer: offer && { ...offer, discountPercent: policy.discountPercent },
    ranked,
    skipped: [...rankSkipped, ...pickSkipped],
    policy,
    durationMs: Date.now() - startedAt,
  };
}
