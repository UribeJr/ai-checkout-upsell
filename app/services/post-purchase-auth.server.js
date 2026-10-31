/**
 * Reads the values we need from the post-purchase extension's token.
 *
 * The extension sends `inputData.token` as a Bearer token. It is a JWT signed
 * with our app secret, and `authenticate.public.checkout` verifies it before
 * we get here. Because the claims are signed, they are safer to trust than
 * anything in the request body.
 *
 * Observed claims (dev store, Oct 2026): `iss`, `sub`, `iat` and `input_data`,
 * where `input_data` mirrors the extension's `inputData`
 * (`shop`, `initialPurchase`, `locale`, ...). There is no `dest` claim.
 *
 * Line item fields follow the installed @shopify/post-purchase-ui-extensions
 * types: `product.id` and `product.variant.id` are numeric, and
 * `totalPriceSet` is the line total after line discounts.
 */
export function getPostPurchaseContext(sessionToken) {
  const inputData = sessionToken.input_data ?? {};
  const lineItems = inputData.initialPurchase?.lineItems ?? [];

  const productIds = lineItems
    .map((lineItem) => lineItem.product?.id)
    .filter(Boolean)
    .map((id) => `gid://shopify/Product/${id}`);

  const subtotal = lineItems.reduce(
    (sum, lineItem) => sum + Number(lineItem.totalPriceSet?.shopMoney?.amount ?? 0),
    0,
  );

  return {
    shop: inputData.shop?.domain ?? null,
    referenceId: inputData.initialPurchase?.referenceId ?? null,
    // Numeric variant IDs the buyer just bought, so we don't offer them again.
    purchasedVariantIds: lineItems
      .map((lineItem) => lineItem.product?.variant?.id)
      .filter(Boolean),
    // Product GIDs, the keys of our stored relationships.
    purchasedProductIds: [...new Set(productIds)],
    // Shop currency, the same currency as the Admin variant prices.
    subtotal: Math.round(subtotal * 100) / 100,
    currencyCode: lineItems[0]?.totalPriceSet?.shopMoney?.currencyCode ?? null,
    // Kept with the decision for reporting. No customer data.
    lineItems: lineItems.map((lineItem) => ({
      productId: lineItem.product?.id ? `gid://shopify/Product/${lineItem.product.id}` : null,
      title: lineItem.product?.title ?? null,
      quantity: lineItem.quantity ?? 0,
    })),
  };
}
