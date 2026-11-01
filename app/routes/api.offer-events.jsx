import { authenticate } from "../shopify.server";
import { getPostPurchaseContext } from "../services/post-purchase-auth.server";
import { findDecision } from "../services/offers/offer-decision.server";
import { validateClientEvent } from "../services/analytics/offer-events";
import { recordEvent } from "../services/analytics/offer-events.server";

// The checkout sends a CORS preflight (OPTIONS) before the POST.
// authenticate.public.checkout answers it for us; any other GET is rejected.
export const loader = async ({ request }) => {
  const { cors } = await authenticate.public.checkout(request);
  return cors(new Response(null, { status: 405 }));
};

/**
 * Records what happened to the offer on the post-purchase page:
 * IMPRESSION, DECLINED, APPLIED or APPLY_FAILED (ACCEPTED is recorded by
 * /api/sign-changeset). Body: { referenceId, offerId, type, value?, reason? }.
 *
 * The event is tied to the decision stored for this checkout, found through
 * the verified token, so a request can only report on its own checkout.
 */
export const action = async ({ request }) => {
  const { sessionToken, cors } = await authenticate.public.checkout(request);
  const context = getPostPurchaseContext(sessionToken);
  const body = await request.json().catch(() => ({}));

  // The purchase reference must match the one inside Shopify's signed token.
  if (!context.shop || !context.referenceId || body.referenceId !== context.referenceId) {
    return cors(Response.json({ error: "Invalid purchase reference" }, { status: 400 }));
  }

  try {
    const decision = await findDecision(context.shop, context.referenceId);
    if (!decision || decision.id !== body.offerId) {
      return cors(Response.json({ error: "Unknown offer" }, { status: 404 }));
    }

    const { event, error } = validateClientEvent(body, decision);
    if (error) {
      return cors(Response.json({ error }, { status: 400 }));
    }

    const result = await recordEvent({ decision, ...event });
    return cors(Response.json({ result }));
  } catch (error) {
    console.error("[api.offer-events] could not record event:", error.message);
    return cors(Response.json({ error: "Could not record event" }, { status: 500 }));
  }
};
