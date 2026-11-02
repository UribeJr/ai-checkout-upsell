# Settings Test Checklist: upsell tag and offer policy

**Status key:** ✅ Verified (observed) · ❌ Failed · ⏳ Not tested yet · 📝 Code-reviewed only

Both features are on the app's **Settings** page and were added after Phase 4 (2026-11-01).

## Upsell tag

These tests ran on 2026-11-01 with the demo tag's earlier name. The demo tag is `upsell` since 2026-11-02.

Only active products with the tag are synced, enriched and offered. Empty means all active products.

| # | Scenario | Expected | Status | Evidence |
|---|---|---|---|---|
| T.1 | Unit tests (tag rules) | Pass | ✅ | `test/catalog-scope.test.js`: empty tag, case and spaces, archived products, search string, rejected tags |
| T.2 | Tag search strings on the store | Right products returned | ✅ | Read-only on gruns-dev-store: `travel` → 3, the demo tag → 10, `drink mix` → 1 |
| T.3 | Settings tests a-g: default, the demo tag, `travel`, back, Admin tag removed/added, bad tag | As planned (7 removed/added, no AI run on removal, one AI run on re-add, error on a quote) | ✅ | Developer confirmed all seven, 2026-11-01. End state: the demo tag, 10 products enriched |

## Offer policy

The discount (whole number 0-50%, 0 = none) and the price cap (0.1-5× the order subtotal) are set in Settings. Empty fields use the env defaults (15%, 1×). Each checkout keeps the discount it was decided with.

| # | Scenario | Expected | Status | Evidence |
|---|---|---|---|---|
| P.1 | Unit tests (policy rules) | Pass | ✅ | `test/offer-policy.test.js`: valid and empty input, out-of-range discount and cap, rounding, settings over env over built-in defaults, a saved 0% kept |
| P.2 | Policy on the real database | Defaults from env; saved values win | ✅ | Temporary script: 15% / 1× (default); saved 10% / 0.3× read back as "settings"; settings restored |
| P.3 | Change the discount while a buyer is on the offer page | Buyer keeps the discount the offer was decided with | ✅ | By accident, 2026-11-01: decision at 18:33:58 UTC stored 15%, setting saved as 10% at 18:34:13; the offer page showed "Save 15%" |
| P.4 | New checkout at 10% | "Save 10%"; added at Shopify's 10% price | ✅ | Decision 18:36:10 UTC stored 10%; Travel Packs shown → accepted → added at $13.50 (from $14.99) |
| P.5 | Discount 0% | No "Save" text, one price, full price added | ✅ | Developer confirmed, 2026-11-01 |
| P.6 | Price cap 0.3× on the Pouch ($49.99, cap $15.00) | Glass Jar ($19.99) skipped as over the price cap; Travel Packs ($14.99) offered | ✅ | Developer confirmed, 2026-11-01 (Offer preview) |
| P.7 | Clear both fields | Both back to "default" | ✅ | Developer confirmed, 2026-11-01. See the follow-up below |
| P.8 | Discount 60% | Error on the field, nothing saved | ✅ | Developer confirmed, 2026-11-01 |

**Follow-up (2026-11-02):** gruns-dev-store's settings row was last saved at 2026-11-01 18:34:13 UTC (the 10% save) and still holds a 10% discount with the default cap. The 0%, 0.3× and clear-both saves in P.5-P.7 aren't in this database, so re-run them here, or note which store they ran on.

**Finding:** the AI rebuild at 16:33 UTC (during the tag tests) re-scored the Pouch's relationships: Travel Packs 0.84, Glass Jar 0.77, Pocket Travel Tin 0.68 (earlier runs had the Jar at 0.92). The Pouch's offer is now the Travel Packs. Scores can shift between AI runs, so check the Offer preview before a demo.
