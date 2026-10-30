import { authenticate, unauthenticated } from "../shopify.server";
import { getPostPurchaseContext } from "../services/post-purchase-auth.server";
import { getOffer } from "../services/offer.server";
import { signChangeset } from "../services/changeset.server";

// The checkout sends a CORS preflight (OPTIONS) before the POST.
// authenticate.public.checkout answers it for us; any other GET is rejected.
export const loader = async ({ request }) => {
  const { cors } = await authenticate.public.checkout(request);
  return cors(new Response(null, { status: 405 }));
};

/**
 * Called when the buyer accepts the offer. Returns a changeset token signed
 * with our app secret; the extension passes it to Shopify's applyChangeset.
 *
 * The browser only tells us *which* offer was accepted. The changes we sign
 * are rebuilt here from a fresh offer lookup, so the buyer can't change the
 * product, quantity or discount, and nothing is signed for an offer that is
 * no longer available.
 */
export const action = async ({ request }) => {
  const { sessionToken, cors } = await authenticate.public.checkout(request);
  const { shop, referenceId } = getPostPurchaseContext(sessionToken);
  const body = await request.json().catch(() => ({}));

  // The purchase reference must match the one inside Shopify's signed token.
  if (!shop || !referenceId || body.referenceId !== referenceId) {
    return cors(
      Response.json({ error: "Invalid purchase reference" }, { status: 400 }),
    );
  }

  try {
    const { admin } = await unauthenticated.admin(shop);
    const offer = await getOffer({ admin });

    if (!offer || offer.id !== body.offerId) {
      return cors(
        Response.json({ error: "Offer is no longer available" }, { status: 409 }),
      );
    }

    const token = signChangeset({ referenceId, changes: offer.changes });
    return cors(Response.json({ token }));
  } catch (error) {
    console.error("[api.sign-changeset] could not sign changeset:", error.message);
    return cors(Response.json({ error: "Could not sign changeset" }, { status: 500 }));
  }
};
