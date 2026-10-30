import { authenticate, unauthenticated } from "../shopify.server";
import { getPostPurchaseContext } from "../services/post-purchase-auth.server";
import { getOffer } from "../services/offer.server";

// The checkout sends a CORS preflight (OPTIONS) before the POST.
// authenticate.public.checkout answers it for us; any other GET is rejected.
export const loader = async ({ request }) => {
  const { cors } = await authenticate.public.checkout(request);
  return cors(new Response(null, { status: 405 }));
};

// Called by the extension's ShouldRender step. Always answers with
// { offer } so the extension can treat `null` as "no post-purchase page".
export const action = async ({ request }) => {
  const { sessionToken, cors } = await authenticate.public.checkout(request);
  const { shop, purchasedVariantIds } = getPostPurchaseContext(sessionToken);
  if (!shop) {
    console.warn("[api.offer] no shop found in token; showing no offer");
    return cors(Response.json({ offer: null }));
  }

  try {
    const { admin } = await unauthenticated.admin(shop);
    const offer = await getOffer({ admin, purchasedVariantIds });
    return cors(Response.json({ offer }));
  } catch (error) {
    // Never block checkout: if anything fails, the buyer just skips the offer.
    console.error("[api.offer] could not build offer:", error.message);
    return cors(Response.json({ offer: null }));
  }
};
