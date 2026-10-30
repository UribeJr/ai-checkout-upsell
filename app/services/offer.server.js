/**
 * Phase 1 offer: one hardcoded variant, configured with env vars.
 *
 * Phase 3 replaces getOffer() with the AI-ranked recommendation but keeps the
 * same return shape, so the routes and the extension don't need to change.
 *
 * Shopify stays the source of truth: we read the variant from the Admin API,
 * and the extension asks Shopify (calculateChangeset) for every price shown.
 * The discount is our business policy and is only ever set here, on the server.
 */

const OFFER_ID = "phase1-hardcoded";

const OFFER_VARIANT_QUERY = `#graphql
  query OfferVariant($id: ID!) {
    productVariant(id: $id) {
      id
      title
      availableForSale
      image {
        url
      }
      product {
        title
        status
        featuredMedia {
          preview {
            image {
              url
            }
          }
        }
      }
    }
  }`;

function getOfferConfig() {
  return {
    variantId: process.env.OFFER_VARIANT_ID,
    discountPercent: Number(process.env.OFFER_DISCOUNT_PERCENT ?? 15),
  };
}

/**
 * Returns the offer to show after checkout, or null when there is nothing
 * safe to offer (not configured, already purchased, variant missing,
 * inactive or unavailable).
 */
export async function getOffer({ admin, purchasedVariantIds = [] }) {
  const { variantId, discountPercent } = getOfferConfig();

  if (!variantId) {
    console.warn("[offer] OFFER_VARIANT_ID is not set; showing no offer");
    return null;
  }

  if (purchasedVariantIds.includes(Number(variantId))) {
    console.log(`[offer] buyer already purchased variant ${variantId}; showing no offer`);
    return null;
  }

  const response = await admin.graphql(OFFER_VARIANT_QUERY, {
    variables: { id: `gid://shopify/ProductVariant/${variantId}` },
  });
  const { data } = await response.json();
  const variant = data?.productVariant;

  if (
    !variant ||
    !variant.availableForSale ||
    variant.product.status !== "ACTIVE"
  ) {
    console.warn(`[offer] variant ${variantId} is not available; showing no offer`);
    return null;
  }

  return {
    id: OFFER_ID,
    productTitle: variant.product.title,
    imageUrl:
      variant.image?.url ??
      variant.product.featuredMedia?.preview?.image?.url ??
      null,
    discountPercent,
    changes: buildChanges(variantId, discountPercent),
  };
}

// Field names follow the installed @shopify/post-purchase-ui-extensions types
// (`variantId`). The tutorial's sample code spells it `variantID`.
function buildChanges(variantId, discountPercent) {
  const change = {
    type: "add_variant",
    variantId: Number(variantId),
    quantity: 1,
  };

  if (discountPercent > 0) {
    change.discount = {
      value: discountPercent,
      valueType: "percentage",
      title: `${discountPercent}% off`,
    };
  }

  return [change];
}
