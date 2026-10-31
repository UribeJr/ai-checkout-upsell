# Running Cost Model

What it costs to run and scale this app. **Update this file whenever a price, a cost driver, or a measured number changes.** Every figure is marked as one of:

- **Price:** published by the vendor (source and date given)
- **Measured:** observed in this project (logs, database, vendor dashboard)
- **Estimate:** calculated by us from measured sizes plus stated assumptions

Last updated: 2026-10-31.

## 1. Summary

- **Checkout costs $0 in AI.** There's no AI call at checkout: offers come from relationships and copy generated ahead of time.
- **All AI cost is background work:** product enrichment and relationship generation.
- **The cost driver is the relationship rebuild.** Each run rebuilds every product's relationships, and each of those calls includes the whole catalog. Cost therefore grows with the **square** of catalog size: about $0.004 per run at 10 products, about $10 at 1,000 (estimate, section 5).
- **Controls in place:**
  - content-only Events triggers
  - a content hash, so price and stock changes cost nothing
  - a manual mode, so the merchant decides when a run happens (section 7)
- **The biggest levers not built yet:** incremental rebuilds and a candidate shortlist. Together they take a 1,000-product edit from ~$10 to ~$0.003 (estimate, section 8).

## 2. Prices

| Item | Price | Source | Checked |
|---|---|---|---|
| gpt-6-luna, standard, ≤272K input tokens | $0.10 input / $0.01 cached input / $0.50 output per 1M tokens | https://developers.openai.com/api/docs/pricing | 2026-10-31 |
| gpt-6-luna, standard, >272K input tokens | $0.20 / $0.02 / $0.75 per 1M | same | 2026-10-31 |
| gpt-6-luna, Batch or Flex, ≤272K | $0.05 / $0.005 / $0.25 per 1M | same | 2026-10-31 |
| gpt-6-luna, Fast (was "Priority"), ≤272K | $0.20 / $0.02 / $1.00 per 1M | same | 2026-10-31 |
| gpt-6-luna cache writes | "30m write" $0.125, "12h write" $0.25 per 1M (standard, ≤272K) | same; the page doesn't explain these columns | 2026-10-31 |
| Regional processing (data residency) | +10% (models released on/after 2026-03-05) | same | 2026-10-31 |
| Shopify Admin API (catalog reads, Events) | Not priced per call; rate-limited | to verify against current Shopify terms | — |
| App hosting (server + background worker) | TBD | not chosen yet | — |
| Database (SQLite now; Postgres in production) | TBD | not chosen yet | — |
| Shopify app distribution / revenue share | TBD; only relevant if listed publicly | to verify | — |

## 3. Where cost comes from

| Component | AI calls | Other cost | Grows with |
|---|---|---|---|
| Checkout offer (`/api/offer`, Slice 6) | none | hosting, 1 indexed DB read, 1 Admin API read | orders |
| Catalog sync (manual button) | none | Admin API reads (2 pages per 100 products) | catalog size |
| Product Events | none directly | 1 Admin API read per delivery | edit volume |
| Enrichment | 1 per changed product | — | products changed |
| Relationship rebuild | 1 per product, each including the whole catalog | — | catalog size² |
| Admin pages | none | hosting | admin use |

## 4. Tokens per call (estimates)

Method: measured the character counts of our prompts, schemas and stored AI outputs, then divided by ~4 characters per token. This is a rule of thumb, not a tokenizer count.

| Call | Input tokens | Output tokens | Measured basis |
|---|---|---|---|
| Enrichment | ~600 | ~150 | instructions 790 chars, schema 920, product ~400; stored profile ~510 chars |
| Relationships | ~840 + ~100 per other product | ~350 | instructions 2,100 chars, schema 850, catalog entry avg 396 chars; stored edges ~1,230 chars per product (avg 3.1 edges) |

**Unknown: reasoning tokens.** The pricing page doesn't say whether gpt-6-luna uses hidden reasoning tokens (normally billed as output). If it does, small catalogs cost more than shown here. At 1,000 products output is ~2% of a relationship call's cost, so even 10x the output adds only ~17%.

**To replace these estimates:** log `response.usage` on every AI call (not built yet), and compare with the OpenAI usage dashboard.

## 5. Cost by catalog size, current design (estimates, standard pricing)

| Products | First enrichment (all) | One full run (relationship rebuild) | Input tokens per rebuild | Rebuild time (sequential) |
|---|---|---|---|---|
| 10 | $0.001 | $0.003 | 17K | ~1.5 min (measured) |
| 100 | $0.01 | $0.12 | 1.1M | ~15-40 min |
| 500 | $0.07 | $2.62 | 25M | hours |
| 1,000 | $0.14 | $10.25 | 101M | ~3-7 h |

- Each run = enrichment of the changed products + one full relationship rebuild. One edit at 1,000 products ≈ $10.25.
- Beyond ~2,700 products a single relationship call exceeds 272K input tokens, which means long-context pricing and very likely a design change anyway.

## 6. Monthly scenarios (estimates; assumes 20 content edits per day)

| Products | Automatic, worst case (1 run per edit) | Manual, 1 run per day | Manual, 1 run per week |
|---|---|---|---|
| 10 | ~$2 | ~$0.10 | ~$0.02 |
| 100 | ~$75 | ~$4 | ~$0.50 |
| 1,000 | ~$6,150 | ~$308 | ~$44 |

"Automatic, worst case" is an upper bound: edits that arrive during a run are folded into one follow-up run.

## 7. Cost controls in place

| Control | Effect | Status |
|---|---|---|
| No AI at checkout | Order volume adds no AI cost | Built (architecture) |
| Content-only Events triggers | Price and inventory edits send nothing | Verified (Slice 4, checklist 4.6) |
| Content hash | Re-saves and no-op edits cost no AI calls | Verified (Slice 2) |
| Manual mode (Settings > Automatic AI updates off) | Changes wait for **Run AI update**; one run covers all waiting changes | Verified (checklist 4b) |
| Edit-then-undo detection (compare with `enrichedHash`) | An edit undone before the run costs nothing | Verified (checklist 4b.7) |
| Queue folds bursts into one run | A bulk edit = one enrichment pass + one rebuild | Built (Slice 3/4) |
| Bounded retries (3 attempts) | Failures can't loop | Built (Slice 3) |

## 8. Levers not built yet

| Lever | Effect (estimate) | Effort |
|---|---|---|
| Incremental rebuild: only the changed product + products whose edges point at it; nightly full rebuild | 1,000-product edit: $10.25 -> ~$0.06 | Small |
| Candidate shortlist (~20 per product, by category / use-case overlap or stored embeddings) before the AI call | Edit cost ~$0.003 at any size; full rebuild at 1,000: $10.25 -> ~$0.46; better pairing quality | Medium |
| Prompt caching (shared catalog prefix first, source product last) | Up to ~90% off rebuild input; cache-write pricing to verify | Small |
| Batch API / Flex for nightly rebuilds | -50% | Small |
| Debounce events (~60 s quiet window) | Fewer runs during bursts | Small |
| Usage logging (`response.usage`) | Real token counts instead of estimates | Tiny |

## 9. Measured spend

| Date | What ran | AI calls | Tokens | Cost | Source |
|---|---|---|---|---|---|
| 2026-10-30 to 31 | Dev runs: 3 full enrichments, ~5 relationship rebuilds, Slice 4 tests (10 products) | ~100 (estimate) | not logged | well under $1 (estimate) | to confirm in the OpenAI usage dashboard |

## 10. Open questions

- Does gpt-6-luna emit billed reasoning tokens with our settings (no reasoning parameter set)?
- What exactly do the "30m write" / "12h write" cache prices mean for our calls?
- Hosting and database choice and price (needed for a complete monthly figure).
- Phase 4 analytics: event-write volume per order (DB cost only, no AI).
