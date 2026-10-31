import { test } from "node:test";
import assert from "node:assert/strict";
import { getPostPurchaseContext } from "../app/services/post-purchase-auth.server.js";

function money(amount, currencyCode = "USD") {
  return { shopMoney: { amount, currencyCode }, presentmentMoney: { amount, currencyCode } };
}

function lineItem(productId, variantId, amount, extra = {}) {
  return {
    product: { id: productId, title: `Product ${productId}`, variant: { id: variantId, title: "Original" } },
    quantity: 1,
    totalPriceSet: money(amount),
    ...extra,
  };
}

test("reads the basket from the verified token", () => {
  const context = getPostPurchaseContext({
    input_data: {
      shop: { domain: "example.myshopify.com" },
      initialPurchase: {
        referenceId: "ref-1",
        lineItems: [lineItem(1, 11, "49.99"), lineItem(2, 21, "30.00", { quantity: 2 })],
      },
    },
  });

  assert.equal(context.shop, "example.myshopify.com");
  assert.equal(context.referenceId, "ref-1");
  assert.deepEqual(context.purchasedVariantIds, [11, 21]);
  assert.deepEqual(context.purchasedProductIds, ["gid://shopify/Product/1", "gid://shopify/Product/2"]);
  assert.equal(context.subtotal, 79.99);
  assert.equal(context.currencyCode, "USD");
  assert.deepEqual(context.lineItems[1], { productId: "gid://shopify/Product/2", title: "Product 2", quantity: 2 });
});

test("two variants of one product give one product ID", () => {
  const context = getPostPurchaseContext({
    input_data: { initialPurchase: { lineItems: [lineItem(1, 11, "10"), lineItem(1, 12, "10")] } },
  });
  assert.deepEqual(context.purchasedProductIds, ["gid://shopify/Product/1"]);
  assert.deepEqual(context.purchasedVariantIds, [11, 12]);
});

test("a token without purchase data gives safe empty values", () => {
  const context = getPostPurchaseContext({});
  assert.equal(context.shop, null);
  assert.equal(context.referenceId, null);
  assert.deepEqual(context.purchasedProductIds, []);
  assert.equal(context.subtotal, 0);
  assert.equal(context.currencyCode, null);
});
