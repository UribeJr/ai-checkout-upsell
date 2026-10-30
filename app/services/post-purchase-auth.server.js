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
 */
export function getPostPurchaseContext(sessionToken) {
  const inputData = sessionToken.input_data ?? {};

  return {
    shop: inputData.shop?.domain ?? null,
    referenceId: inputData.initialPurchase?.referenceId ?? null,
  };
}
