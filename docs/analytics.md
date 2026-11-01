# Analytics

What the **Analytics** page measures and how each number is defined. Every number comes from the app's own offer records (`OfferDecision` and `OfferEvent`), not from Shopify reports.

## Events

Each checkout with an offer can record these events, at most once each:

| Event | Recorded by | When |
|---|---|---|
| `IMPRESSION` | Extension → `/api/offer-events` | The offer page is shown with Shopify-calculated prices |
| `DECLINED` | Extension | The buyer presses **Decline this offer** |
| `ACCEPTED` | Backend (`/api/sign-changeset`) | The server signs the change for the stored pick |
| `APPLIED` | Extension | Shopify applied the change; carries the added amount |
| `APPLY_FAILED` | Backend or extension | Signing was refused (for example `out_of_stock`) or Shopify didn't apply the change |

## Definitions

| Metric | Definition |
|---|---|
| Offer shown | The offer page appeared with Shopify-calculated prices (not the ShouldRender preload) |
| Accepted | The buyer pressed Pay now and the server signed the change |
| Applied | Shopify applied the change to the order. Only this counts as revenue |
| Conversion | Applied offers / offers shown |
| Attributed revenue | Added items after discount, before shipping and tax, in shop currency |
| Top offers | Ranked by revenue per offer shown; "low sample" below 30 offers shown (our threshold) |

Events are idempotent (one per type per checkout) and tied to the checkout's stored decision through the verified token. The applied amount comes from Shopify's calculation in the buyer's browser, so the server accepts it only if it is between 0 and the offer's list price.

## Limits

- Revenue is **attributed**, not proven incremental. Proving lift needs a holdout group that never sees an offer.
- Refunds and cancellations are not subtracted. That would need order webhooks and the `read_orders` scope.
- The page reads up to the last 500 decisions and has no date filter.

Test evidence, from real test orders #1017-#1019, is in [phase-4-test-checklist.md](phase-4-test-checklist.md).
