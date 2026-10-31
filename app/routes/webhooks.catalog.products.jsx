import { authenticate } from "../shopify.server";
import {
  handleProductEvent,
  rememberHandled,
  wasAlreadyHandled,
} from "../services/catalog/product-events.server";

// Receives the Product Events subscriptions from shopify.app.toml.
// authenticate.webhook verifies the HMAC signature before we read anything.
export const action = async ({ request }) => {
  const { shop, admin, payload } = await authenticate.webhook(request);
  const deliveryId = request.headers.get("shopify-webhook-id");

  if (wasAlreadyHandled(deliveryId)) {
    console.log(`[events] ${shop}: duplicate delivery ${deliveryId}, skipped`);
    return new Response(null, { status: 200 });
  }

  const productId = payload.query_variables?.productId ?? payload.data?.product?.id;

  try {
    const result = await handleProductEvent({
      shop,
      admin,
      action: payload.action,
      productId,
    });
    rememberHandled(deliveryId);
    console.log(`[events] ${shop}: Product ${payload.action} ${productId} -> ${result}`);
    return new Response(null, { status: 200 });
  } catch (error) {
    // A 5xx makes Shopify retry the delivery later.
    console.error(`[events] ${shop}: Product ${payload.action} ${productId} failed: ${error.message}`);
    return new Response(null, { status: 500 });
  }
};
