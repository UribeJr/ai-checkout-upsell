import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildDevCheckoutLink,
  parseConfiguredAppUrl,
  parseExtensionToml,
  sameOrigin,
} from "./dev-checkout-link.js";

const EXTENSION_DIR = "extensions/intelligent-offer";

/**
 * Dev-only test checkout link for the Offer preview. Returns null in
 * production, or if the files or env values it needs aren't there.
 *
 * Returns { url, configMatches, configuredAppUrl, appUrl }. `configMatches`
 * is false when APP_URL in the extension's config.js isn't this dev server's
 * tunnel: then the checkout loads the extension, but it can't reach us.
 */
export function getDevCheckoutLink({ shop, variantIds }) {
  if (process.env.NODE_ENV === "production") return null;

  try {
    const read = (file) => readFileSync(path.join(process.cwd(), EXTENSION_DIR, file), "utf8");
    const { uid, name } = parseExtensionToml(read("shopify.extension.toml"));
    const configuredAppUrl = parseConfiguredAppUrl(read("src/config.js"));
    const appUrl = process.env.SHOPIFY_APP_URL;

    const url = buildDevCheckoutLink({
      shop,
      appUrl,
      apiKey: process.env.SHOPIFY_API_KEY,
      extensionUid: uid,
      extensionName: name,
      variantIds,
    });
    if (!url) return null;

    return { url, configMatches: sameOrigin(configuredAppUrl, appUrl), configuredAppUrl, appUrl };
  } catch (error) {
    console.warn("[offer preview] no dev checkout link:", error.message);
    return null;
  }
}
