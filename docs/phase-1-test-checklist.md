# Phase 1 Manual Test Checklist

Manual tests for the post-purchase vertical slice on the dev store (`gruns-dev-store`), paying with the **Bogus Gateway** (card number `1`, any future expiry, any CVV). Wallets (Shop Pay, Apple Pay, Google Pay) never show a post-purchase page, so always pay by card.

**Status key:** ✅ Verified (observed) · ❌ Failed · ⏳ Not tested yet · 📝 Code-reviewed only

## Setup

1. Dev store: Bogus Gateway active (Settings > Payments). App selected for the post-purchase page (Settings > Checkout).
2. `.env`: `OFFER_VARIANT_ID=68349213540575` (Selling Plans Ski Wax), `OFFER_DISCOUNT_PERCENT=15`.
3. `npm run dev`, then put the tunnel URL into `extensions/intelligent-offer/src/config.js`.
4. Dev checkout link: `<tunnel>/extensions/dev-<extension uid>/purchase.post.render`. This redirects to a cart with the dev parameters that load the local extension. To test a different cart, keep the query string and change the `/cart/<variantId>:1` part.

## Happy path

| # | Scenario | Steps | Expected | Status | Evidence |
|---|---|---|---|---|---|
| 1 | Extension renders | Deploy the template extension, normal storefront checkout | Post-purchase page appears after payment | ✅ | Confirmation #7PPEYKQC0 |
| 2 | Offer shown | Dev link (snowboard), pay | Ski Wax, $24.95 struck through, $21.21, totals from Shopify | ✅ | Confirmation #HPJ4ACQ7C |
| 3 | Decline | Press "Decline this offer" | Normal thank-you page, order unchanged | ✅ | Developer-verified |
| 4 | Accept | Press "Pay now · $21.21" | Wax added to the same order at 15% off, second charge | ✅ | #8KLQEI8PP: total $971.16, charges $949.95 + $21.21 |
| 5 | Regression after Slice 4 | Repeat #2 after the hardening changes | Offer still shown | ✅ | Developer-verified 2026-10-30 |

## Failure paths (the buyer must never be blocked)

| # | Scenario | How to trigger | Expected | Status | Evidence |
|---|---|---|---|---|---|
| 6 | Offer already purchased | Dev link with the cart changed to `/cart/68349213540575:1` (buy the wax itself) | No post-purchase page; dev log `[offer] buyer already purchased variant ...` | ✅ | Log: `[offer] buyer already purchased variant 68349213540575; showing no offer`. Also confirms the token includes `initialPurchase.lineItems[].product.variant.id`. |
| 7 | Offer product unavailable | In Admin, make Ski Wax unavailable (inventory 0 with "Continue selling when out of stock" off), then use the dev link. Restore afterwards. | No post-purchase page; dev log `[offer] variant ... is not available` | ✅ | Wax set to 0 on hand (`availableForSale: false` confirmed via CLI). Log: `[offer] variant 68349213540575 is not available; showing no offer` |
| 8 | Backend unreachable | Point `APP_URL` at an address that doesn't respond, then use the dev link. Restore afterwards. | No post-purchase page; checkout completes normally | ✅ | `APP_URL` pointed at a nonexistent tunnel host (fails fast). Went straight to the thank-you page. |
| 8b | Backend hangs | Backend accepts the connection but never answers | 4s timeout in the extension, then no post-purchase page | 📝 | `withTimeout` in `index.jsx`; not run (#8 only covers a fast failure) |
| 9 | Offer not configured | Remove `OFFER_VARIANT_ID` from `.env` and restart dev | No post-purchase page; dev log `[offer] OFFER_VARIANT_ID is not set` | 📝 | Same `null` path as #7; not run because it needs a dev restart |
| 10 | Unauthenticated request | `POST /api/offer` and `/api/sign-changeset` without a valid token (browser user agent) | `401` | ✅ | curl smoke test |
| 11 | Tampered purchase reference | Sign request whose `referenceId` doesn't match the token | `400`, nothing signed | 📝 | Needs a real token to test |
| 12 | Double accept | Press Pay now twice quickly | One charge only (button locks; Shopify rejects `changeset_already_applied`) | 📝 | Not tested |
| 13 | Empty storage (e.g. Shop Pay) | Render runs without the ShouldRender data | Continues to the thank-you page | 📝 | Wallet checkouts don't show the page on this store |

## Known platform limits (not bugs)

- No post-purchase page for wallets, gift cards, installment payments or duties/multi-currency orders.
- Only one app can own the post-purchase page per store (Settings > Checkout).
- While `shopify app dev` runs, use the dev link. A normal storefront checkout only loads the **deployed** extension version.
