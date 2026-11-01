# Phase 4 Test Checklist: offer events + analytics

**Status key:** ✅ Verified (observed) · ❌ Failed · ⏳ Not tested yet · 📝 Code-reviewed only

Events: `IMPRESSION` (offer page shown with Shopify totals), `DECLINED`, `ACCEPTED` (server, on signing), `APPLIED` (Shopify applied the changeset; value = added line after discount, shop currency), `APPLY_FAILED` (signing refused or Shopify error). One row per event type per decision (`OfferEvent @@unique([decisionId, type])`). Page: Analytics.

| # | Scenario | Expected | Status | Evidence |
|---|---|---|---|---|
| 4.1 | Unit tests (event rules, metrics) | Pass | ✅ | `npm test` 49/49 (11 new: allowed types, ACCEPTED rejected from the client, APPLIED value bounds incl. missing `offerPrice`, reason cleaning; conversion/revenue math, no-impression decisions, zero division, untrusted value, top-offer order, low-sample flag), lint clean |
| 4.2 | Migration `offer_events` | Applies, existing decisions kept | ✅ | Applied 2026-10-31; 5 decisions kept (`offerPrice` null for them) |
| 4.3 | Event service + analytics on real DB | Duplicate ignored, bad write doesn't throw, totals right | ✅ | Temporary script 2026-10-31: IMPRESSION recorded, repeat = `duplicate`, ACCEPTED + APPLIED 17 recorded, unknown decision = `failed` (logged, no crash); analytics 1 shown / 1 added / $17 / 100%. Test rows deleted |
| 4.4 | Checkout: Pouch, Accept | IMPRESSION, ACCEPTED, APPLIED 17.00; value matches the order | ✅ | 2026-10-31: IMPRESSION 23:54:46 -> ACCEPTED 23:54:58 -> APPLIED 17.00 23:55:00 UTC; order #1017 has Glass Storage Jar at $17.00 |
| 4.5 | Checkout: Powder, Decline | IMPRESSION, DECLINED; no revenue | ✅ | IMPRESSION -> DECLINED; order #1018 = Powder only |
| 4.6 | Checkout: Pouch, Jar made unavailable before Pay now | IMPRESSION, APPLY_FAILED (`out_of_stock`) | ✅ | Jar made unavailable via CLI while the offer page was open; IMPRESSION -> APPLY_FAILED (`out_of_stock`); order #1019 = Pouch only. Jar tracking turned back off; no AI work triggered |
| 4.7 | Offer page reloaded / re-rendered | Still one IMPRESSION | ✅ | Developer reloaded the Powder offer page once before declining; one IMPRESSION row |
| 4.8 | Analytics page | Totals and top offers match the event rows; low-sample badge; older decisions counted as checkouts, not as shown | ✅ | Developer screenshot: 3 shown, 33.3% conversion, $17.00 revenue, $5.67 per offer shown, 1 accepted, 1 declined, 8 checkouts; Jar 2 shown / 1 added / 50%. Fixed after review: plural wording ("1 offers were") and a long column header |
