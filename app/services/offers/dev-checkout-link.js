/**
 * Dev-only: the cart link that opens a test checkout for a basket with the
 * local post-purchase extension loaded. Same format as the redirect from
 * `<tunnel>/extensions/dev-<uid>/purchase.post.render`; the query parameters
 * are what load the local extension. Pure (tested in
 * test/dev-checkout-link.test.js); dev-checkout-link.server.js reads the files.
 */

const numericId = (id) => String(id).split("/").pop();

/**
 * Returns the cart link, or null if anything it needs is missing.
 * `variantIds`: variant GIDs or numeric IDs, one unit of each.
 */
export function buildDevCheckoutLink({ shop, appUrl, apiKey, extensionUid, extensionName, variantIds }) {
  if (!shop || !appUrl || !apiKey || !extensionUid || !extensionName || !variantIds?.length) return null;

  let tunnel;
  try {
    tunnel = new URL(appUrl);
  } catch {
    return null;
  }

  const lines = variantIds.map((id) => `${numericId(id)}:1`).join(",");
  const params = new URLSearchParams({
    script_url: `${tunnel.origin}/extensions/dev-${extensionUid}/assets/${extensionName}.js`,
    post_purchase_dev_api_key: apiKey,
    uuid: `dev-${extensionUid}`,
    socket_url: `wss://${tunnel.host}/extensions`,
  });

  return `https://${shop}/cart/${lines}?${params}`;
}

/** Reads `uid` and `name` from the extension's shopify.extension.toml. */
export function parseExtensionToml(text) {
  const value = (key) => text.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m"))?.[1] ?? null;
  return { uid: value("uid"), name: value("name") };
}

/** Reads APP_URL from the extension's src/config.js. */
export function parseConfiguredAppUrl(text) {
  return text.match(/APP_URL\s*=\s*"([^"]+)"/)?.[1] ?? null;
}

/** True when both URLs point at the same host (ignores paths and a trailing slash). */
export function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}
