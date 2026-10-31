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
| 2.6 | Archive a product + sync | Row retired, edges removed | ✅ | Verified through Events instead (4.3) |

Observation for Slice 4: the template's price-change Events subscription still delivers on a price edit (`handle: product-price-change`). Slice 4 replaces it with content-only triggers.

## Slice 3: AI enrichment + relationships

| # | Scenario | Expected | Status | Evidence |
|---|---|---|---|---|
| 3.1 | `gpt-6-luna` accepts strict JSON-schema output | All products ENRICHED, no errors | ✅ | Run 1 (`enrichment-v1`): 10/10 ENRICHED, `modelName = gpt-6-luna`, 0 errors |
| 3.2 | Fact references are real | Every factRef is an exact verified fact | ✅ | All stored factRefs match `custom.verified_facts` |
| 3.3 | Relationships match the designed complements | Powder <-> Shaker, Pouch -> Jar/Travel packs, Jar/Tin -> Pouch | ✅ | 19 edges; e.g. Powder -> Shaker 0.91, Shaker -> Powder 0.96, Jar -> Pouch 0.95 |
| 3.4 | Redundancy: bundle doesn't offer what it contains | Starter Bundle -> not Pouch, not Jar | ✅ | Bundle -> Travel Packs, Tin, Evening Gummies |
| 3.5 | Low-relevance product gets no forced offer | Canvas Tote -> 0 edges | ✅ | 0 outgoing edges |
| 3.6 | Same-line upsizing is typed UPGRADE | Travel Packs -> Pouch = UPGRADE | ✅ | UPGRADE 0.36 (excluded by ranking policy in Slice 5) |
| 3.7 | Bad `format` values rejected | No "JSON"/"object" formats | ✅ (after fix) | Run 1 stored `"object"` (Starter Bundle) and `"JSON"` (Shaker). Fix: field renamed `productFormat`, validator rejects data-type words, prompt `enrichment-v2`. Run 2: all 10 formats are physical descriptions |
| 3.8 | Prompt version bump re-enriches everything | Process queue re-enriches all 10 with `enrichment-v2` | ✅ | `[queue] {"enriched":10,"failed":0,"relationshipsUpdated":10}`; 0 warnings, 0 dropped edges |
| 3.9 | Latency recorded | ms per call from `[enrich]` / `[relationships]` logs | ✅ | Enrichment 2459-3888 ms, relationships 2413-5428 ms (gpt-6-luna, sequential, ~70 s per full run) |
| 3.10 | Validator unit tests | Pass | ✅ | `npm test` 13/13 |
| 3.11 | Failure keeps the previous profile | FAILED row keeps profile and edges | 📝 | Code path in `enrichment-queue.server.js`; not triggered live yet |

**Findings from run 2 (to address):**
- **Checkout latency risk:** offline calls take ~2.5-5.4 s; the planned checkout AI selection budget is 2.5 s. Measure the (smaller) selection call in Slice 6; if it's too slow, pre-generate offer copy offline and keep checkout deterministic + cached.
- **Run-to-run variability / conservative edges:** run 2 produced 17 edges (run 1: 19), mostly 1-2 per product. Travel Packs kept only an UPGRADE edge (excluded by policy) and lost Travel Tin; Canvas Tote gained a weak Tin edge (0.56). Fix: `relationships-v2` prompt asks for every reasonable fit (up to 5), plus a minimum score in the Slice 5 ranking.

## Revision: offer copy generated offline (`relationships-v3`)

| # | Scenario | Expected | Status | Evidence |
|---|---|---|---|---|
| 3.12 | Relationship rebuild with copy | All edges rebuilt, no errors | ✅ | 25 edges, all `relationships-v3`, 0 product errors |
| 3.13 | Copy validation | Grounded copy passes | ✅ | 25/25 copy accepted (0 template fallbacks); all `factRefs` are target-product facts |
| 3.14 | More complete edge lists | 2-5 per product where sensible | ✅ | 1-4 per product (v2: mostly 1-2) |
| 3.15 | Travel Packs has an eligible offer | Non-UPGRADE edge exists | ✅ | Travel Packs -> Pocket Travel Tin 0.57 (plus Pouch UPGRADE 0.88, excluded by policy) |
| 3.16 | Copy unit tests | Pass | ✅ | `npm test` 16/16 (prices, discounts, claims, length, foreign facts, bad copy keeps the edge) |

Notes: descriptions are factual rather than salesy (grounding tradeoff). Some relationship types are debatable (Bundle -> Travel Packs = REFILL); ranking uses scores and only excludes UPGRADE. Canvas Tote -> Tin 0.72 / Travel Packs 0.58: a 0.6 minimum score in Slice 5 keeps only the Tin.

## Slice 4: Product Events

Test product: Pocket Travel Tin (`gid://shopify/Product/15478588932319`), 2026-10-31.

| # | Scenario | Expected | Status | Evidence |
|---|---|---|---|---|
| 4.1 | New subscriptions applied by dev | No trigger-path errors | ✅ | Deliveries arrive at `/webhooks/catalog/products`; no config errors reported |
| 4.2 | Content edit delivers and re-enriches with no manual sync | `-> changed`, then enrich + relationships | ✅ | `Product update ... -> changed`, `[enrich] Pocket Travel Tin: ok ... 2933ms`, relationships rebuilt for all 10 |
| 4.3 | Archive | `-> retired`, outgoing + incoming edges removed | ✅ | `Product update ... -> retired` |
| 4.4 | Reactivate | `-> changed`, re-enriched, edges back | ✅ | `-> changed`, `[queue] {"enriched":1,"failed":0,"relationshipsUpdated":10}`; SQLite: Tin has 3 outgoing and 5 incoming edges again |
| 4.5 | Description reverted | Stored snapshot = original text | ✅ | SQLite snapshot: "A small metal tin with a hinged lid that holds a few days of gummies on the go." |
| 4.6 | Price edit | No `[events]` line, no AI call | ✅ | Developer-verified 2026-10-31: price edited, no event logged (inventory edit not tested separately; not in the triggers either) |
| 4.7 | Edit while a run is in progress | Second run picks up the new edit | ⏳ | Fix coded after the run (see findings); not tested live |

**Findings:**
- **Missed edits during a run (fixed, 📝):** a run reads its work list once, and a second `startQueue` during the run was skipped. A product edited mid-run stayed PENDING until something else started a run. Worse, if the edit landed during that product's own AI call, the old profile was saved as ENRICHED and the new content was never enriched. Fix in `enrichment-queue.server.js`: a skipped start now schedules one more run, and the profile is saved only if `sourceHash` still matches the content that was enriched (else `requeued`).
- **Cost per edit:** one content change = 1 enrichment + 10 relationship calls (~85-100 s, sequential), because every product's edges are rebuilt. Fine for 10 products; at catalog scale rebuild only the changed product's outgoing edges plus the products whose edges point at it.
- **Relationship latency went up with copy:** 4.6-15.1 s per call (v2 without copy: 2.4-5.4 s). Offline only, so no checkout impact.
- **Run-to-run variability:** with no relevant changes, edge counts moved (Pouch 4 -> 5, Travel Packs 3 -> 4, Bundle 3 -> 5). The Slice 5 minimum score makes offers depend less on this churn.
- Copy: 31 edges, 29 with AI copy; 2 rejected by the validator (those edges use template copy at checkout).

## Slice 4b: Settings page, manual AI mode

| # | Scenario | Expected | Status | Evidence |
|---|---|---|---|---|
| 4b.1 | Settings page loads (after dev restart) | Automatic AI updates: On; 0 waiting | ✅ | Developer-verified 2026-10-31 |
| 4b.2 | Turn off, edit a product description | `[events] ... -> changed` + `automatic AI updates are off ... waits for a manual run`; no `[enrich]`; page shows 1 waiting | ✅ | Developer-verified 2026-10-31 |
| 4b.3 | Archive a product while off | `-> retired` immediately (retirement doesn't wait) | ✅ | Developer-verified 2026-10-31 |
| 4b.4 | Run AI update | One run enriches all waiting products + one rebuild; count back to 0 | ✅ | Developer-verified 2026-10-31 |
| 4b.5 | Turn back on with changes waiting | Catch-up run starts | ✅ | Developer-verified 2026-10-31 |
| 4b.6 | Lint + unit tests | Clean | ✅ | `npx eslint app/` clean; `npm test` 16/16 |
| 4b.7 | Edit then undo before a run (auto off) | Undo -> `-> unchanged`, waiting count back to 0, next run has nothing to enrich | ✅ | Developer-verified live 2026-10-31. DB-level check also passed (throwaway shop, rows deleted): create -> PENDING, edit -> PENDING, re-save edit -> PENDING, undo -> ENRICHED, reactivate -> PENDING |

## Slice 5: candidate engine, ranking, offer preview

No AI at checkout. Rules: `app/services/offers/candidate-ranking.js`; data loading + live check: `candidate-engine.server.js`; page: Offer preview.

| # | Scenario | Expected | Status | Evidence |
|---|---|---|---|---|
| 5.1 | Ranking + picking unit tests | Pass | ✅ | `npm test` 29/29 (13 new: UPGRADE/purchased/below-min skips, multi-item dedupe + boost, stable ties, out of stock / inactive / deleted fall-through, purchased variant, price cap, stale-fact -> TEMPLATE, null headline -> TEMPLATE, empty, headline length) |
| 5.2 | Live Admin query (`nodes(ids:)` + `shop.currencyCode`) | Works with `read_products` | ✅ | Run read-only via `shopify store execute` on gruns-dev-store 2026-10-31. Demo products have no images (`featuredMedia: null`) |
| 5.3 | Pouch | Jar or Travel Packs, AI copy | ✅ | Engine check (CLI-backed admin, real DB): Glass Storage Jar 0.92, AI copy. Travel Packs edge is 0.50 this run -> below min |
| 5.4 | Powder | Shaker | ✅ | Stainless Shaker Bottle 0.92, AI copy |
| 5.5 | Pouch + Powder | One deduped list | ✅ | 4 candidates, Shaker offered (tie with Jar at 0.92 broken by product ID). No shared target in this data, so no boost shown; Pouch + Starter Bundle share the Tin |
| 5.6 | Starter Bundle | Not Pouch or Jar | ✅ | Travel Packs 0.88 offered; Pouch/Jar not candidates |
| 5.7 | Travel Packs | UPGRADE Pouch skipped, Tin offered | ✅ | Pouch UPGRADE 0.88 skipped, Tin 0.67 offered |
| 5.8 | Canvas Tote | Only ≥ 0.6, or none | ✅ | Travel Packs 0.66 offered; 3 weaker skipped |
| 5.9 | Preview page in Admin | Same results, decision time shown | ✅ | Developer confirmed the Offer preview page works and approved Slice 5, 2026-10-31 |
| 5.10 | Stale-fact guard live | Remove a cited fact -> Template copy; restore -> AI copy | ⏳ | Unit-tested (5.1); live result not reported separately |
| 5.11 | Out of stock live | Top candidate unavailable -> next one offered | ⏳ | Unit-tested (5.1); live result not reported separately |
| 5.12 | Decision latency | Recorded from the preview | ⏳ | Not recorded yet; will be measured from Slice 6 timing logs if not read from the preview |

Rows 5.3-5.8 used a temporary script that ran `findOffer` with an admin client backed by `shopify store execute` (deleted after use). The preview page runs the same function through the app.
