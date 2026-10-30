import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";

/**
 * Signs a post-purchase changeset so Shopify knows the changes came from our
 * app. The extension passes the returned token to `applyChangeset`.
 *
 * Payload format from Shopify's "Build a post-purchase product offer" tutorial.
 * The app secret never leaves the server.
 */
export function signChangeset({ referenceId, changes }) {
  const payload = {
    iss: process.env.SHOPIFY_API_KEY,
    jti: randomUUID(),
    iat: Date.now(),
    sub: referenceId,
    changes,
  };

  return jwt.sign(payload, process.env.SHOPIFY_API_SECRET);
}
