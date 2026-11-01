# AI Post-Purchase Upsell (Shopify case study)

A Shopify app that shows one relevant cross-sell offer after checkout, on the post-purchase page. AI works out ahead of time which products go together and writes the offer copy. At checkout the app picks the offer with plain rules and live Shopify data, so checkout makes no AI call.

This is a job-interview case study built on a Shopify development store with fictional demo products. It is not an official Grüns storefront or a production deployment.

> **Living document.** This README is updated as the project moves forward. Still open: how a reviewer recreates the demo catalog.

## Status

| Phase | What | Status |
|---|---|---|
| 1 | Post-purchase extension, signed changeset, hardcoded offer | Done, verified with Bogus Gateway orders (`docs/phase-1-test-checklist.md`) |
| 2 | Catalog sync, AI enrichment and relationships with offer copy, Events, Settings, offer engine, checkout wiring | Done, verified with real test orders #1012-#1016 (`docs/phase-2-test-checklist.md`) |
| 3 | AI selection at checkout | Replaced by the Phase 2 design: copy is written offline and checkout is deterministic (see "Key decisions") |
| 4 | Offer events (shown, accepted, declined, applied) and an Analytics page | Done, verified with real test orders #1017-#1019 (`docs/phase-4-test-checklist.md`) |

## How it works

```
OFFLINE (background, the only place AI runs)
 Shopify product (title, description, type, tags, options, custom.verified_facts)
   -> sync: snapshot + content hash (price and stock are not part of the hash)
   -> AI enrichment: category, format, use cases          (validated, versioned)
   -> AI relationships: up to 5 related products each, with a score, a type
      (COMPLEMENTARY | ACCESSORY | REFILL | UPGRADE) and offer copy that may
      only use the target's verified facts                (validated, versioned)
 Kept current by Shopify Events on content fields only, or run manually from Settings.

CHECKOUT (no AI call)
 ShouldRender -> POST /api/offer with the post-purchase token (verified)
   -> basket from the token: purchased products, variants, subtotal
   -> stored relationships of those products
   -> rules: drop upgrades, items already bought, scores below 0.6;
      merge duplicates (+0.05 per extra cart item pointing at a product)
   -> one live Shopify query for the top 8: active, in stock, price <= subtotal
   -> copy: stored AI copy if every fact it cites is still a verified fact,
      otherwise plain template copy
   -> saved as one OfferDecision per checkout
 Render -> Shopify calculateChangeset (all prices, discount, shipping, tax)
   -> IMPRESSION event
 Pay now -> POST /api/sign-changeset -> live recheck of the saved pick
   -> server-built changes signed with the app secret (ACCEPTED event)
   -> applyChangeset -> APPLIED event with the added amount, or APPLY_FAILED
 Decline -> DECLINED event -> thank-you page
```

The principle is that **AI recommends offline, the backend validates, and Shopify calculates and applies.** The model never decides prices, discounts, stock or what gets charged.

## Key decisions

- **No AI call at checkout.** Shopify requires post-purchase network calls to complete in two seconds or less ([UX for post-purchase product offers](https://shopify.dev/docs/apps/build/checkout/product-offers/ux-for-post-purchase-product-offers)). Offline AI calls took 2.4-5.4 s each (measured), so a live AI call would usually miss that. Writing the copy ahead of time makes the checkout decision fast (209-317 ms measured on real test orders) and free in AI cost.
- **Copy grounded in merchant facts.** The AI may cite only the product's `custom.verified_facts` metafield, which the merchant owns and the app only reads. At checkout, if a fact the copy cites has since been removed, the app uses template copy instead (the stale-fact guard).
- **One stored decision per checkout.** Shopify can call ShouldRender more than once. The first call decides and saves an `OfferDecision`; later calls reuse that pick after a live check, so the buyer always sees the same offer. Checkouts with no offer are saved too.
- **Only the stored pick is signed.** The browser only says which offer was accepted. The server rebuilds the changes from the saved decision and checks stock again, so a buyer can't change the product or discount, and an offer that sold out while the buyer was on the page is refused (409).
- **Prices only from Shopify.** The extension shows only amounts returned by `calculateChangeset`. The discount (15% by default) is a server-side policy.
- **Least privilege.** The app asks only for `read_products`.
- **Content-only triggers.** Events subscribe to title, description, type, tags, status, options and `custom.verified_facts`. Price and inventory edits never start AI work; they are read live at checkout.
- **Manual AI mode.** Settings can turn automatic AI updates off. Changes still queue up, and the merchant runs them when they choose, which also controls cost.

## Setup

### Prerequisites

- Node.js `>= 22.12`
- [Shopify CLI](https://shopify.dev/docs/api/shopify-cli) (built with 4.9.4)
- A Shopify Partner account and a development store
- An OpenAI API key (only for the offline AI steps)

### Install

```sh
npm install
npm run setup        # prisma generate + migrate (SQLite)
```

### Environment variables

Set these in a gitignored `.env` file. Never commit it.

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Offline enrichment and relationships |
| `OPENAI_MODEL` | Model name for those calls |
| `OFFER_DISCOUNT_PERCENT` | Discount on the offer, default `15` |
| `OFFER_MAX_ORDER_RATIO` | Price cap: offer price <= ratio x order subtotal, default `1` |

`SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` are provided by `shopify app dev`.

### Store setup

1. Create a product metafield definition `custom.verified_facts` with type list of single-line text. Fill it with the facts the offer copy may use.
2. **Demo catalog:** how a reviewer recreates the 10 demo products will be documented after Phase 4. The dev store's products were created directly on the store and are not seeded by the app.

### Run

```sh
shopify app dev
```

The tunnel URL changes on every run. Copy it into `APP_URL` in `extensions/intelligent-offer/src/config.js`, because the extension runs in the buyer's browser and calls the backend through it.

In the app, open **Product intelligence** and run **Sync catalog**. The AI steps then run automatically, or from **Settings** in manual mode.

## Running a test checkout

1. Open `<tunnel URL>/extensions/dev-<extension uid>/purchase.post.render`. The uid is in `extensions/intelligent-offer/shopify.extension.toml`.
2. It redirects to a cart link with dev parameters (`script_url`, `post_purchase_dev_api_key`, ...). To test another basket, change only the `/cart/<variant id>:<qty>,...` part.
3. Pay with the Bogus Gateway card number `1`.
4. The post-purchase page shows the offer. **Pay now** adds it to the order, and **Decline this offer** goes to the thank-you page.

A normal storefront checkout skips the post-purchase page while `shopify app dev` is running, because the store then serves the dev preview.

## Admin pages

- **Product intelligence:** sync status, AI profiles and relationships for each product, plus the queue controls.
- **Offer preview:** build a basket and see the offer checkout would choose, every candidate and why each one wasn't chosen. It runs the same decision code as checkout and makes no writes.
- **Settings:** automatic vs. manual AI updates, waiting and failed counts, and a manual **Run AI update** button.
- **Analytics:** offers shown, conversion, attributed revenue, revenue per offer shown, top offers (with a low-sample warning) and recent checkouts with their events.

## Analytics definitions

| Metric | Definition |
|---|---|
| Offer shown | The offer page appeared with Shopify-calculated prices (not the ShouldRender preload) |
| Accepted | The buyer pressed Pay now and the server signed the change |
| Applied | Shopify applied the change to the order. Only this counts as revenue |
| Conversion | Applied offers / offers shown |
| Attributed revenue | Added items after discount, before shipping and tax, in shop currency |
| Top offers | Ranked by revenue per offer shown; "low sample" below 30 offers shown (our threshold) |

Events are idempotent (one per type per checkout) and tied to the checkout's stored decision through the verified token. The applied amount comes from Shopify's calculation in the buyer's browser, so the server accepts it only if it is between 0 and the offer's list price.

## Testing

```sh
npm test     # node --test, 49 unit tests, no network or database
npm run lint
```

The unit tests cover:
- the content hash
- the AI output validators
- the ranking and picking rules
- token parsing
- changeset building
- the stored-pick recheck
- the offer event rules and analytics math

Manual and end-to-end results, with evidence, are in `docs/phase-1-test-checklist.md`, `docs/phase-2-test-checklist.md` and `docs/phase-4-test-checklist.md`. That includes real test orders #1012-#1016: accept, decline, a multi-item cart, out-of-stock fallback, and an offer refused after it sold out.

## Cost and scaling

The full running model is in [`cost.md`](cost.md). The numbers there are labeled as measured or estimated.

- **Checkout:** $0 in AI. Each new decision makes three indexed database reads, one Admin API query and one database write; each offer event adds one small database write.
- **Background:** all AI cost comes from enrichment and the relationship rebuild. A full rebuild sends the whole catalog with each product, so cost grows with the square of catalog size: about $0.004 per run at 10 products and about $10 at 1,000 (estimates).
- **Controls in place:** content-only triggers, the content hash, edit-then-undo detection, and manual mode.
- **Next levers (not built):** incremental rebuilds and a candidate shortlist. Together they would take a 1,000-product edit from about $10 to about $0.003 (estimate). Prompt caching and the Batch API would cut the cost further.

## Limitations and future work

- **Revenue is attributed, not proven incremental.** Proving lift needs a holdout group that is never shown an offer. Refunds and cancellations are not subtracted; production would adjust revenue from order webhooks (needs `read_orders`). Analytics reads up to the last 500 decisions with no date filter.
- **Learning from outcomes is not built.** Logged outcomes don't change rankings yet. The plan is to blend relationship scores with observed accept rates and revenue per impression, with sample-size guards, then try experiments.
- **Ranking follow-ups:**
  - The multi-item bonus has no ceiling, which matters in large carts. A cap of about +0.15 is planned.
  - A cart item can be offered something a bundle in the same cart already contains. Test order #1014 is an example.
  - Only the top 8 candidates are checked live. If all 8 fail, no offer is shown.
- **Dev setup:** the tunnel URL must be copied into the extension config on every dev run. The deployed app config still has the scaffold's placeholder `application_url`, so a hosted backend is needed before a demo outside `shopify app dev`.
- **Shopify platform limits:** post-purchase extensions are in beta and need extra access for production. There is no post-purchase page for some payment methods and order types. Third-party pixels see only the initial purchase.
- **Queue:** the background job queue is in-process, with one runner per shop and retries. Production would use a real job queue and a hosted database.

## Repo map

```
app/routes/          admin pages (app.*), checkout endpoints (api.offer, api.sign-changeset), webhooks
app/services/ai/     provider adapter, OpenAI client, JSON schemas, validators
app/services/catalog/ sync, content hash, enrichment, relationships, queue, Events handling
app/services/offers/ ranking rules, offer engine, checkout decisions, changeset payload
app/services/analytics/ offer events and metrics
extensions/intelligent-offer/  post-purchase checkout extension (React)
prisma/              schema and migrations (SQLite)
test/                unit tests (node --test)
docs/                phase plans and test checklists with evidence
cost.md              running cost model
master_context.md    working log: status, decisions, session history
```
