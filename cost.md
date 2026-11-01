# Running Cost Model

What it costs to run and scale this app. **Update this file whenever a price, a cost driver, or a measured number changes.** Every figure is marked as one of:

- **Price:** published by the vendor (source and date given)
- **Measured:** observed in this project (logs, database, vendor dashboard)
- **Estimate:** calculated by us from measured sizes plus stated assumptions

Last updated: 2026-11-01.

## 1. Summary

- **Checkout costs $0 in AI.** There's no AI call at checkout: offers come from relationships and copy generated ahead of time.
- **All AI cost is background work:** product enrichment and relationship generation.
- **The cost driver is the relationship rebuild.** Each run rebuilds every product's relationships, and each of those calls includes the whole catalog. Cost therefore grows with the **square** of catalog size: about $0.004 per run at 10 products, about $10 at 1,000 (estimate, section 5).
- **Controls in place:**
  - content-only Events triggers
  - a content hash, so price and stock changes cost nothing
  - a manual mode, so the merchant decides when a run happens (section 7)
  - an optional upsell tag, so only tagged products count toward catalog size
- **In production, for one merchant** (section 9, estimates): the app's own cost is AI. It's about $1 a month at 50 products, $14 at 200 and $308 at 1,000 (manual mode), whatever the order volume. Hosting comes on top, depends on the merchant's infrastructure, and is about $45-88 a month on the Fly.io example.
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
| Fly.io Machine, shared-cpu-1x 1GB, 24/7 | $6.70 per 30 days (512MB: $3.69); no platform fee, no free tier | https://docs.fly.io/about/pricing (iad/ewr, lowest-priced regions) | 2026-11-01 |
| Fly.io outbound data (North America, Europe) | $0.02/GB; inbound free | same | 2026-11-01 |
| Fly Managed Postgres Basic (shared-2x, 1GB) / Starter (2GB) | $38.00 / $72.00 per month; storage $0.28/GB; HA, backups, pooling included | https://docs.fly.io/postgres | 2026-11-01 |
| Neon Postgres, Launch plan | Usage-based, no minimum: $0.106/CU-hour, $0.35/GB-month; Neon's own examples: $15 (intermittent) to $22 (small always-on) per month | https://neon.com/pricing | 2026-11-01 |
| Render (web service, Postgres) | Not retrieved: the pricing page loads prices with JavaScript | https://render.com/pricing | — |
| Shopify custom app (one store) | No distribution fee or revenue share found; the $19 App Store registration and revenue share apply to App Store apps only | https://shopify.dev/docs/apps/launch/distribution, .../distribution/revenue-share | 2026-11-01 |
| Shopify plan requirement | "Only Plus merchants can install custom apps which use post-purchase checkout extensions." Live stores also need access approval (review up to 7 days) | https://shopify.dev/docs/apps/build/checkout/product-offers/build-a-post-purchase-offer | 2026-11-01 |

## 3. Where cost comes from

| Component | AI calls | Other cost | Grows with |
|---|---|---|---|
| Offer events (`/api/offer-events`, Phase 4) | none | hosting, 1-2 indexed DB reads + 1 DB write per event (at most 5 events per checkout) | orders |
| Checkout offer decision (`findOffer` via `/api/offer`, Slice 6) | none | hosting, 2 indexed DB reads, 1 Admin API query (top 8 candidates), 1 DB write (`OfferDecision`); a repeat ShouldRender or Accept adds 1 Admin query for the stored pick | orders |
| Catalog sync (manual button) | none | Admin API reads (2 pages per 100 products) | catalog size |
| Product Events | none directly | 1 Admin API read per delivery | edit volume |
| Enrichment | 1 per changed product | — | products changed |
| Relationship rebuild | 1 per product, each including the whole catalog | — | catalog size² |
| Admin pages (incl. Offer preview: 1 extra Admin query for basket prices) | none | hosting | admin use |

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

## 9. Production cost, one merchant (estimates)

For a single brand running the app as a custom app on its own store. All tiers are **assumptions** for illustration, not any real store's numbers.

The cost splits in two:
- **The app's own cost** is AI, and it holds wherever the app runs. A custom app pays no Shopify fee, Admin API calls aren't charged per call, and checkout makes no AI call.
- **Hosting** is a business decision that depends on the merchant's existing infrastructure. If they already run servers and Postgres, the app could add little. The Fly.io figures below are one example, not a recommendation.

**Prerequisite to confirm with the merchant:** they must be on **Shopify Plus**. Shopify only lets Plus stores install custom apps that use post-purchase extensions. That's the merchant's subscription, not an app cost.

### The app's own cost: AI per month

| | Small (50 products) | Medium (200 products) | Large (1,000 products) |
|---|---|---|---|
| **Manual mode, one run per day** (recommended today) | **~$1** | **~$14** | **~$308** |
| After the AI cost levers | ~$1 | ~$5 | ~$18 |
| One-time first setup | ~$0.05 | ~$0.50 | ~$10 |

The number of orders doesn't change these. Full detail, including automatic mode, is in the AI table further down.

### What the app needs from any hosting

- One always-on Node.js server. Checkout must answer within Shopify's 2-second limit.
- A Postgres database. About 1.2 KB is stored per checkout (measured).
- A background job runner for AI updates. This can share the server.
- The load is up to 6 small requests per checkout, well under 1 per second on average even at 150,000 orders a month.

### Tiers (assumptions)

| | Small | Medium | Large |
|---|---|---|---|
| Products in the upsell catalog | 50 | 200 | 1,000 |
| Orders per month | 5,000 | 30,000 | 150,000 |
| Content edits per day | 5 | 20 | 50 |
| Backend requests per month (up to 6 per checkout: offer, events, sign) | ~30K | ~180K | ~900K (about 0.35 per second on average) |
| Offer data per month (1.2 KB measured per checkout, ×2-3 for indexes and overhead) | ~15 MB | ~90 MB | ~450 MB |

### Hosting example: Fly.io, monthly

| | Small | Medium | Large |
|---|---|---|---|
| App server | 1 × 1GB Machine: $6.70 | 2 × 1GB (redundancy): $13.40 | 2 × 1GB: $13.40 |
| Postgres | Basic $38.00 + 1 GB $0.28 | Basic $38.00 + 2 GB $0.56 | Starter $72.00 + 10 GB $2.80 |
| Background jobs | $0: a Postgres-backed queue (assumption) on the same Machines, no Redis | $0 | $0 |
| **Hosting total** | **~$45** | **~$52** | **~$88** |

Outbound data stays under $1 at every tier. Swapping in Neon instead of Fly Managed Postgres would bring hosting to about $22-29 (Small) and $28-35 (Medium). That uses Neon's own examples of $15-22 per month, which assume their example load, not ours.

### AI (monthly, standard pricing)

The relationship rebuild dominates. One full run costs about $0.04 at 50 products, $0.45 at 200 and $10.25 at 1,000 (section 5 method).

| Mode | Small | Medium | Large |
|---|---|---|---|
| Automatic, worst case (a full run per edit) | ~$6 | ~$270 | ~$15,400 |
| **Manual, one run per day** (current design) | **~$1** | **~$14** | **~$308** |
| After the levers: incremental rebuild with a shortlist (~$0.003 per edit) plus a nightly shortlist rebuild | ~$1 | ~$5 | ~$18 |

### Total per month, with the Fly.io example

| | Small | Medium | Large |
|---|---|---|---|
| Current design, manual daily run | **~$46** | **~$66** | **~$396** |
| After the AI cost levers | ~$46 | ~$57 | ~$106 |
| Per order, current design | ~$0.009 | ~$0.002 | ~$0.003 |
| Per order, after the levers | ~$0.009 | ~$0.002 | ~$0.0007 |

**What this shows:**
- Hosting is the floor and barely moves with order volume, because checkout makes no AI call.
- AI cost depends on catalog size and edit frequency. It's negligible up to a few hundred products. At 1,000 products, the manual mode and then the levers are what keep it in check.
- Automatic mode without the levers is the only setup that gets expensive at scale. Don't run it at 1,000 products.

**Not included:** the Shopify Plus subscription, error monitoring and logging (free tiers exist; not priced here), a custom domain, Fly support ($29/month standard, optional) and developer time.

## 10. Measured spend

| Date | What ran | AI calls | Tokens | Cost | Source |
|---|---|---|---|---|---|
| 2026-10-31 | Checkout decisions (Slice 6 tests, 4 checkouts) | 0 | 0 | $0 AI; engine 223-317 ms each (measured, `OfferDecision.durationMs`) | dev DB |
| 2026-10-30 to 31 | Dev runs: 3 full enrichments, ~5 relationship rebuilds, Slice 4 tests (10 products) | ~100 (estimate) | not logged | well under $1 (estimate) | to confirm in the OpenAI usage dashboard |

## 11. Open questions

- Does gpt-6-luna emit billed reasoning tokens with our settings (no reasoning parameter set)?
- What exactly do the "30m write" / "12h write" cache prices mean for our calls?
- Render prices for comparison (not retrievable from its pricing page).
- Peak checkout load (for example during a sale) hasn't been load-tested.
- Phase 4 analytics: event-write volume per order (DB cost only, no AI).
