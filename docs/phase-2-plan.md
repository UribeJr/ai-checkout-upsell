> Status: **approved by the developer 2026-10-30.** Progress is tracked in `master_context.md`.

# Phase 2 Plan (Track B, app work): Product Intelligence + AI Offer Selection

## Context

- **Phase 1 is done** (`b9a74b1`): the hardcoded Ski Wax offer was shown, signed and applied to real Bogus orders.
- **Phase 2 Track A (store setup) is done** (recorded in `master_context.md` section 3, uncommitted):
  - the `custom.verified_facts` metafield definition
  - 10 fictional "Demo Greens Co." products (ACTIVE, on the Online Store, untracked inventory, 2-4 facts each)
  - the 17 template products archived (undo list saved)
  - **The Phase 1 offer is offline by design.**
- **Track B (this plan)** makes the app choose the offer intelligently. Two independent pipelines:
  - **A, background:** sync the catalog -> OpenAI enrichment + relationships -> validated records in the app database.
  - **B, checkout:** order context -> database candidates -> deterministic eligibility -> OpenAI picks 1 of 3-5 and writes grounded copy -> server validation -> the existing post-purchase flow.
- **Principle:** AI recommends -> backend validates -> Shopify calculates and applies. The discount stays server policy (`OFFER_DISCOUNT_PERCENT`); prices always come from Shopify.
- **Developer constraints:**
  - the app focuses strictly on upsell features (no seeding or demo features in the app)
  - JavaScript only, readable enough to explain every function in the Loom
  - OpenAI `gpt-6-luna` behind a provider adapter
  - approved facts are written by the merchant and only read by the app; the AI profile lives in the app database, never in Shopify
  - least privilege: the app moves to `read_products`

## 1. What we reuse from Phase 1

| Asset | In Phase 2 |
|---|---|
| `extensions/intelligent-offer/src/index.jsx` | Same lifecycle (ShouldRender preload -> `calculateChangeset` -> sign -> `applyChangeset` -> `done()`), 4s `withTimeout`, fail-open. Only change: banner shows the AI `headline` / `description`. |
| `app/routes/api.offer.jsx` | Same auth/CORS/`{ offer }` contract; calls `decideOffer()` instead of `getOffer()`. |
| `app/routes/api.sign-changeset.jsx` | Same referenceId check; signs the **stored decision** (no re-selection). |
| `app/services/post-purchase-auth.server.js` | Extended: line items (product ID, variant ID, quantity, line total), subtotal, currency, from the verified token. |
| `app/services/changeset.server.js` | Unchanged. |
| `app/services/offer.server.js` | `buildChanges()` + variant lookup move into `offers/`; file removed. |
| `app/shopify.server.js` | `authenticate.admin`, `authenticate.webhook` (verifies Events HMAC too), `unauthenticated.admin`. |
| Prisma | `Session` untouched; 3 new models in one migration. |

## 2. Architecture

```
PIPELINE A: PRODUCT INTELLIGENCE (ahead of checkout)
 Admin "Sync catalog" ─┐
 Events: Product create / update (content triggers) / delete ─► webhooks.catalog.products.jsx
                       │   authenticate.webhook + dedupe on Shopify-Webhook-Id
                       ▼
   product-sync: fetch fresh product (Admin GraphQL, incl. custom.verified_facts)
     -> snapshot + sourceHash(title, description, type, tags, options, variant titles, facts)
     -> upsert ProductIntelligence; hash or prompt version changed -> PENDING
     -> not ACTIVE / deleted -> deletedAt set, outgoing + incoming edges removed
                       ▼ fire-and-forget kick (+ admin "Process queue" / "Re-enrich all")
   enrichment-queue (DB rows = jobs, one runner per shop, 3 attempts w/ backoff)
     -> enrichment.server:    OpenAI -> profile -> validate -> save
     -> relationships.server: OpenAI(profile + compact catalog) -> validate -> replace edges
   Price/inventory edits: no delivery (not in triggers) + hash unchanged -> zero AI calls

PIPELINE B: OFFER SELECTION (checkout, < 4s end to end)
 ShouldRender -> POST /api/offer -> authenticate.public.checkout
   -> context from verified token (line items, subtotal, currency, referenceId)
   -> OfferDecision exists for referenceId? return it (idempotent)
   -> candidates: edges where source ∈ purchased (indexed) -> aggregate/dedupe -> rule filters
   -> live Shopify check of the shortlist (1 Admin query: ACTIVE, availableForSale, price, image)
   -> cached AI decision for same basketKey whose pick is still eligible? reuse (CACHE)
   -> else OpenAI selection (2.5s timeout) -> validate
        failure / timeout / invalid -> deterministic FALLBACK (top-ranked + template copy from facts)
   -> persist OfferDecision -> { offer: { id: decisionId, productTitle, imageUrl, headline, description, discountPercent, changes } }
 Render -> calculateChangeset -> Pay now -> /api/sign-changeset
   -> load OfferDecision(shop, referenceId, id) -> live availability recheck -> signChangeset -> applyChangeset
```

## 3. Database schema (`prisma/schema.prisma`, one migration)

JSON is stored as `String`, so SQLite and Postgres behave the same. IDs are Shopify GIDs.

```prisma
model ProductIntelligence {
  id                String    @id @default(cuid())
  shop              String
  productId         String
  title             String
  handle            String
  status            String
  snapshot          String               // JSON: description text, type, tags, options, variants, verifiedFacts
  sourceHash        String               // AI-relevant fields only
  category          String?              // ---- AI interpretation (app-owned) ----
  format            String?
  attributes        String?              // JSON [{ name, value }]
  useCases          String?              // JSON string[]
  crossSellAngles   String?              // JSON string[]
  factRefs          String?              // JSON string[] ⊆ verifiedFacts
  enrichedHash      String?              // sourceHash the profile was built from
  enrichmentVersion String?
  modelName         String?
  enrichedAt        DateTime?
  enrichmentStatus  String   @default("PENDING")   // PENDING | PROCESSING | ENRICHED | FAILED
  attempts          Int      @default(0)
  nextAttemptAt     DateTime?
  lastError         String?
  syncedAt          DateTime
  deletedAt         DateTime?
  outgoing          ProductRelationship[] @relation("source")
  @@unique([shop, productId])
  @@index([shop, enrichmentStatus, nextAttemptAt])
}

model ProductRelationship {
  id              String   @id @default(cuid())
  shop            String
  sourceProductId String
  targetProductId String
  type            String   // COMPLEMENTARY | ACCESSORY | REFILL | UPGRADE
  score           Float    // 0-1 relevance ranking, NOT a conversion probability
  reasoning       String
  version         String
  createdAt       DateTime @default(now())
  source          ProductIntelligence @relation("source", fields: [shop, sourceProductId], references: [shop, productId], onDelete: Cascade)
  @@unique([shop, sourceProductId, targetProductId])
  @@index([shop, sourceProductId])
  @@index([shop, targetProductId])
}

model OfferDecision {
  id                String   @id @default(cuid())
  shop              String
  referenceId       String
  basketKey         String   // hash(sorted purchased variant IDs + prompt/policy versions)
  orderContext      String   // JSON: titles, quantities, subtotal, currency; no customer data
  candidates        String   // JSON [{ variantId, productId, relationshipIds, rankScore, price }]
  selectedVariantId String?  // null = no offer
  selectedProductId String?
  headline          String?
  description       String?
  reasoning         String?
  source            String   // AI | CACHE | FALLBACK | NONE
  fallbackReason    String?  // timeout | invalid_output | provider_error | not_configured
  modelName         String?
  promptVersion     String?
  durationMs        Int?
  discountPercent   Int
  createdAt         DateTime @default(now())
  @@unique([shop, referenceId])
  @@index([shop, basketKey, createdAt])
}
```

**Growth path (not built now):** Phase 4's `OfferEvent(decisionId, type, value)` joins to `candidates[].relationshipIds`, which gives conversion and revenue per impression **per relationship**. Ranking can later blend `score` with observed performance (sample-size guards, then a bandit) without a schema rewrite.

## 4. Demo catalog (already in the store; IDs in `master_context.md`)

Designed hypotheses for the AI to rediscover, used to judge enrichment quality:

| Purchased | Expected strong offers | Rule to show |
|---|---|---|
| Daily Greens Gummies, 28-Day Pouch | 7-Day Travel Packs, Glass Storage Jar | complements |
| 7-Day Travel Packs | Pocket Travel Tin, 28-Day Pouch | accessory / at-home |
| Daily Greens Powder | Stainless Shaker Bottle, Electrolyte Mix | mixing accessory |
| Shaker Bottle | Greens Powder, Electrolyte Mix | |
| Starter Bundle | Travel Packs (not the 28-Day Pouch or Jar: already included) | redundancy exclusion |
| 28-Day Pouch + Powder (multi-item) | deduped union, Shaker/Travel Packs | aggregation |
| Canvas Tote | weak or none | low relevance -> may be no offer |

## 5. Shopify integration

- **Scopes (least privilege):** `shopify.app.toml` `scopes = "read_products"`. Remove the template-only config: `write_metaobjects`, `write_metaobject_definitions`, the `app.demo_info` metafield and the `app.example` metaobject. Post-purchase changesets need no Admin scope. The app gets re-approved once on the dev store.
- **Template cleanup:** replace `app/routes/app._index.jsx` (the "Generate a product" demo, which needs `write_products`) with a short upsell home that links to the intelligence page; remove `app/routes/app.additional.jsx` and its nav link.
- **Initial sync:** admin action `products(first: 50, query: "status:active")`, paginated, including `metafield(namespace: "custom", key: "verified_facts") { value }`.
- **Events** (`[events]` api `2026-10`): replace the template's price subscription and `webhooks.products.update.jsx` with:
  - `Product` `create` and `delete`
  - `Product` `update` with content triggers only: candidate paths `product.title`, `product.descriptionHtml`, `product.productType`, `product.tags`, `product.status`, `product.options.*`, `product.metafields.*`. They're validated against the Product Events reference, and `shopify app dev` rejects invalid paths.
  - URI `/webhooks/catalog/products` -> `app/routes/webhooks.catalog.products.jsx`.
- **Checkout reads:** one `nodes(ids:)` query for the shortlist variants (`availableForSale`, `price`, `product { status title featuredMedia }`).

## 6. AI integration

- **Model:** `gpt-6-luna` (`OPENAI_MODEL`) for all three tasks. Structured output: Responses API `text.format: { type: "json_schema", name, strict: true, schema }` -> `response.output_text` -> `JSON.parse`. Strict-mode support and latency are verified in Slice 3 before relying on them.
- **Provider abstraction:**
  - `ai/provider.server.js`: `generateStructured({ task, instructions, input, schema, timeoutMs, maxRetries })` -> `{ data, modelName, durationMs }`; throws `AiError` (`not_configured | timeout | provider_error | invalid_json`); selects the adapter by `AI_PROVIDER` (default `openai`).
  - `ai/openai.server.js`: the only file importing the `openai` SDK.
- **Responsibilities, one module each:**

| Module | Task | Prompt version constant |
|---|---|---|
| `catalog/enrichment.server.js` | Product -> profile (category, format, attributes, useCases, crossSellAngles, factRefs) | `ENRICHMENT_PROMPT_VERSION` |
| `catalog/relationships.server.js` | Profile + compact catalog -> ≤ 5 edges (target, type, score, reasoning) | `RELATIONSHIP_PROMPT_VERSION` |
| `offers/offer-selection.server.js` | Order context + 3-5 candidates -> `{ selectedVariantId, headline, description, factRefs, reasoning }` | `SELECTION_PROMPT_VERSION` |
| `ai/validators.js` | Pure semantic checks for all three (below) | n/a |
| `ai/schemas.js` | Closed JSON schemas (`additionalProperties: false`, all required) | n/a |

- **Every prompt says:** use only the supplied facts; no health, medical, efficacy or safety claims; never mention prices or discounts; only choose supplied IDs. Customer data is never sent.
- **Validators:**
  - factRefs ⊆ facts
  - edge target exists, isn't itself, and has a valid type; score clamped to 0-1; bad edges are dropped and counted
  - selection: ID ∈ candidates; headline ≤ 60 chars, description ≤ 160; no `$`, `%` or "N off"; a health-claim denylist (backstop, not proof); factRefs belong to the chosen product

## 7. Recommendation algorithm (`offers/candidate-ranking.js`, pure)

1. Edges with source ∈ purchased products, joined to targets that are `ENRICHED` and not deleted.
2. Exclude purchased targets (product level), `UPGRADE` edges, self-links, and targets whose facts say they're **included** in a purchased bundle (the "Starter Bundle includes Pouch + Jar" case is handled by an `UPGRADE`/redundant edge type from the relationship step; no hardcoded rule).
3. Multi-item: one entry per target, `rankScore = max(score) + 0.05 × (extra sources)`, keeping all reasonings and relationship IDs.
4. Live check of the top ~8: ACTIVE, an `availableForSale` variant, `price ≤ OFFER_MAX_ORDER_RATIO × subtotal` (env, demo policy). Pick the first available variant.
5. Shortlist the top 5. Empty -> `NONE` (no offer).
6. Cache -> AI -> FALLBACK (`"Add {title} to your order"` + first verified fact).
7. Validate, persist `OfferDecision`, return.

## 8. Performance and reliability

- At checkout: 1 indexed DB read + ≤ 1 Admin query + ≤ 1 AI call (`AI_SELECTION_TIMEOUT_MS=2500`, `maxRetries: 0`), inside the extension's 4s limit. The fallback always answers in time.
- Idempotent: `OfferDecision @@unique([shop, referenceId])`; repeated ShouldRender calls reuse the decision; sign uses the stored decision. Events dedupe uses `Shopify-Webhook-Id` (in-memory set; production would use a store).
- Cache: reuse a recent AI decision (`OFFER_CACHE_TTL_MINUTES`) for the same `basketKey` only if its pick is still in the fresh eligible shortlist. Eligibility is never cached.
- Queue: unique row per product = no duplicate jobs; `attempts` + exponential `nextAttemptAt` (max 3); in-process lock per shop; "Re-enrich all" clears `enrichedHash`. Production would swap in a real queue (documented).
- Logging: one structured line per decision (source, candidates, durationMs, fallbackReason) and per enrichment (model, version, durationMs, dropped edges). No customer data is logged.

## 9. Files

**New**
- `prisma/migrations/<ts>_product_intelligence/`
- `app/services/ai/{provider.server.js, openai.server.js, schemas.js, validators.js}`
- `app/services/catalog/{shopify-catalog.server.js, product-sync.server.js, enrichment.server.js, relationships.server.js, enrichment-queue.server.js}`
- `app/services/offers/{candidate-ranking.js, candidate-engine.server.js, offer-selection.server.js, offer-engine.server.js}`
- `app/routes/webhooks.catalog.products.jsx`
- `app/routes/app.intelligence.jsx`: status table, Sync / Process queue / Re-enrich all, a basket preview, recent decisions. Read-only plus operations; no configuration UI.
- `test/{candidate-ranking,ai-validators,product-hash,offer-selection}.test.js`, `test/fixtures/*.json`
- `docs/phase-2-plan.md` (this plan), `docs/phase-2-test-checklist.md`

**Modified:** `prisma/schema.prisma`, `shopify.app.toml` (scopes, events, template config removed), `app/routes/{app._index.jsx, app.jsx, api.offer.jsx, api.sign-changeset.jsx}`, `app/services/post-purchase-auth.server.js`, `extensions/intelligent-offer/src/index.jsx` (copy only), `package.json` (`openai`, `"test": "node --test"`), `.eslintrc.cjs` (`test/**` in the Node override), `.env` (remove `OFFER_VARIANT_ID`; add AI vars), `master_context.md`, `CLAUDE.md` sections 2 and 8.

**Removed:** `app/services/offer.server.js`, `app/routes/app.additional.jsx`, `app/routes/webhooks.products.update.jsx`.

## 10. Slices (each gated and tested before the next; commit per slice when asked)

0. **Housekeeping:** commit `master_context.md` (Track A record) + this plan as `docs/phase-2-plan.md`. Leave `stash@{0}` for the developer to drop.
1. **Least-privilege cleanup:** scopes -> `read_products`, template config/pages removed, upsell home. *Gate:* the app re-approves and loads; `npm run lint` passes; the extension still builds.
2. **Schema + sync + intelligence page (no AI).** *Gate:* 10 rows with facts; re-sync is a no-op; an Admin description edit + re-sync -> only that product is PENDING; a price edit -> no change.
3. **AI provider + enrichment + relationships + queue + validators + unit tests.** *Gate:* the developer adds `OPENAI_API_KEY`; all 10 ENRICHED; edges broadly match section 4; a mocked bad output is dropped/FAILED with the old profile kept; `npm test` passes; strict schema + latency recorded.
4. **Events.** *Gate:* a description edit -> delivery -> re-enriched automatically; an inventory/price edit -> no delivery and no AI call; archive -> `deletedAt` set and edges gone.
5. **Candidate engine + ranking + preview.** *Gate:* ranking unit tests (multi-item dedupe, purchased/upgrade exclusion, price ratio, empty); the preview shows different shortlists for the section 4 baskets.
6. **AI selection + validation + fallback + OfferDecision + cache, wired into `/api/offer`, `/api/sign-changeset` and the extension.** *Gate:* section 11's end-to-end checkouts pass; `OFFER_VARIANT_ID` retired.
7. **Docs:** checklist, `master_context.md`, `CLAUDE.md`, README section on the architecture and its tradeoffs.

## 11. Testing

- **Unit** (`node --test`, no new dependency, no DB/network): hash stability (price/inventory don't change it); validators (unknown ID, self-link, foreign factRefs, health terms, price mentions, lengths); ranking rules; offer selection with an **injected fake provider** (valid -> AI, timeout -> FALLBACK, invalid -> FALLBACK, no candidates -> NONE, cache hit -> no provider call). Fixtures are recorded real responses.
- **Integration (dev store):** sync/hash behaviour, Events deliveries (content vs inventory edit, archive), enrichment output reviewed on the intelligence page.
- **End-to-end (Bogus, dev link with a demo cart):**
  - (a) Pouch -> Travel Packs or Jar with AI copy
  - (b) Powder -> Shaker
  - (c) Pouch + Powder, deduped
  - (d) Starter Bundle -> not the Pouch or Jar
  - (e) Tote -> weak or no offer
  - (f) unset `OPENAI_API_KEY` -> FALLBACK offer, checkout unaffected
  - (g) top candidate out of stock -> next candidate
  - (h) Accept applies the shown variant at the policy discount
  - Results go in `docs/phase-2-test-checklist.md` (✅ / 📝 format).

## 12. Tradeoffs for the interview

1. **Two AI stages:** costly reasoning happens offline; checkout ranks 3-5 vetted options.
2. **Rules before the LLM, validation after:** the model can't pick an unsellable item or invent claims or prices.
3. **Facts vs. profile:** merchant-approved facts in Shopify (read-only for the app); AI hypotheses in the app database, versioned.
4. **Least privilege:** `read_products` only. The app *can't* modify merchant data.
5. **Events triggers + content hash:** inventory churn costs zero AI calls.
6. **DB rows as the queue:** explainable for one instance; a clear path to SQS/BullMQ.
7. **No vector DB:** 10 products fit in the context window; embeddings only at catalog scale.
8. **Persisted decision:** idempotency, sign-what-was-shown, and the hook for performance learning.
9. **Fallback:** an AI outage costs copy quality, not revenue or checkout.
10. **Scores aren't probabilities;** no self-learning claims; the schema is ready for it.

## 13. Risks / verify during implementation

- Exact Product Events trigger paths (Events reference; deploy-time validation).
- `read_products` covers `custom.verified_facts` reads, and Events need only `read_products` (docs say yes).
- `gpt-6-luna` strict JSON-schema support and p95 latency vs 2.5s (tune or rely on the fallback).
- Scope reduction re-approval flow on the dev store during `shopify app dev`.
- Env names only: `OPENAI_API_KEY` (developer adds; never pasted in chat or committed), `OPENAI_MODEL`, `AI_PROVIDER`, `AI_SELECTION_TIMEOUT_MS`, `OFFER_DISCOUNT_PERCENT`, `OFFER_MAX_ORDER_RATIO`, `OFFER_CACHE_TTL_MINUTES`.
