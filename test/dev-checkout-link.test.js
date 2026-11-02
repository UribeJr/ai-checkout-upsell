import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDevCheckoutLink,
  parseConfiguredAppUrl,
  parseExtensionToml,
  sameOrigin,
} from "../app/services/offers/dev-checkout-link.js";

const inputs = {
  shop: "my-dev-store.myshopify.com",
  appUrl: "https://example-tunnel.trycloudflare.com",
  apiKey: "abc123",
  extensionUid: "7308f61c-c20f",
  extensionName: "intelligent-offer",
};

test("one-item basket gives the dev cart link with the extension parameters", () => {
  const link = buildDevCheckoutLink({ ...inputs, variantIds: ["gid://shopify/ProductVariant/68350166466783"] });
  assert.equal(
    link,
    "https://my-dev-store.myshopify.com/cart/68350166466783:1" +
      "?script_url=https%3A%2F%2Fexample-tunnel.trycloudflare.com%2Fextensions%2Fdev-7308f61c-c20f%2Fassets%2Fintelligent-offer.js" +
      "&post_purchase_dev_api_key=abc123" +
      "&uuid=dev-7308f61c-c20f" +
      "&socket_url=wss%3A%2F%2Fexample-tunnel.trycloudflare.com%2Fextensions",
  );
});

test("several items are joined with commas, numeric IDs work too", () => {
  const link = buildDevCheckoutLink({ ...inputs, variantIds: ["gid://shopify/ProductVariant/1", "2"] });
  assert.ok(link.startsWith("https://my-dev-store.myshopify.com/cart/1:1,2:1?"));
});

test("a trailing slash or path on the tunnel URL doesn't change the link", () => {
  const variantIds = ["1"];
  assert.equal(
    buildDevCheckoutLink({ ...inputs, appUrl: "https://example-tunnel.trycloudflare.com/", variantIds }),
    buildDevCheckoutLink({ ...inputs, variantIds }),
  );
});

test("missing inputs or an invalid tunnel URL give no link", () => {
  assert.equal(buildDevCheckoutLink({ ...inputs, variantIds: [] }), null);
  assert.equal(buildDevCheckoutLink({ ...inputs, appUrl: "", variantIds: ["1"] }), null);
  assert.equal(buildDevCheckoutLink({ ...inputs, apiKey: undefined, variantIds: ["1"] }), null);
  assert.equal(buildDevCheckoutLink({ ...inputs, appUrl: "not a url", variantIds: ["1"] }), null);
});

test("uid and name are read from the extension toml", () => {
  const toml = 'name = "intelligent-offer"\ntype = "checkout_post_purchase"\nuid = "7308f61c-c20f"\n';
  assert.deepEqual(parseExtensionToml(toml), { uid: "7308f61c-c20f", name: "intelligent-offer" });
  assert.deepEqual(parseExtensionToml("type = \"x\""), { uid: null, name: null });
});

test("APP_URL is read from config.js, and a mismatched tunnel is detected", () => {
  const config = 'export const APP_URL = "https://old-tunnel.trycloudflare.com";';
  assert.equal(parseConfiguredAppUrl(config), "https://old-tunnel.trycloudflare.com");
  assert.equal(sameOrigin("https://old-tunnel.trycloudflare.com", inputs.appUrl), false);
  assert.equal(sameOrigin("https://example-tunnel.trycloudflare.com/", inputs.appUrl), true);
  assert.equal(sameOrigin(null, inputs.appUrl), false);
});
