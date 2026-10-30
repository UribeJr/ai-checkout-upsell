# Phase 2 Test Checklist

Product Intelligence + AI offer selection on `gruns-dev-store`. Plan: `docs/phase-2-plan.md`.

**Status key:** ✅ Verified (observed) · ❌ Failed · ⏳ Not tested yet · 📝 Code-reviewed only

## Slice 1: least privilege

| # | Scenario | Expected | Status | Evidence |
|---|---|---|---|---|
| 1.1 | App loads after the scope reduction | New upsell home page, no errors | ✅ | Developer-verified 2026-10-30 |
| 1.2 | Shopify's actual grant | Only `read_products` | ✅ | Intelligence page (`currentAppInstallation.accessScopes`) shows `read_products`; CLI log `Access scopes auto-granted: read_products` |
| 1.3 | Lint + app config | Clean | ✅ | `npm run lint`; `shopify app config validate` = valid |

## Slice 2: schema + sync (no AI)

| # | Scenario | Expected | Status | Evidence |
|---|---|---|---|---|
| 2.1 | First sync | 10 rows, PENDING, facts present | ✅ | `[sync] {"created":10,"changed":0,"unchanged":0,"removed":0}`; table shows 2-4 facts per product |
| 2.2 | Description edit (Canvas Tote) + sync | Only that product changes | ✅ | `[sync] {"created":0,"changed":1,"unchanged":9,"removed":0}`; stored snapshot has the new text |
| 2.3 | Price-only edit (Canvas Tote $24.99 -> $30.99) + sync | No change | ✅ | `[sync] {"created":0,"changed":0,"unchanged":10,"removed":0}` |
| 2.4 | No price stored in snapshots | 0 snapshots contain a price | ✅ | SQLite check |
| 2.5 | Hash unit tests | Pass | ✅ | `npm test`: 5/5 (`test/product-snapshot.test.js`) |
| 2.6 | Archive a product + sync | Row retired, edges removed | ⏳ | Covered again in Slice 4 (Events) |

Observation for Slice 4: the template's price-change Events subscription still delivers on a price edit (`handle: product-price-change`). Slice 4 replaces it with content-only triggers.
