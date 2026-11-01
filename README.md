# AI Post-Purchase Upsell (Shopify case study)

A Shopify app that shows one relevant cross-sell offer after checkout, on the post-purchase page. AI works out ahead of time which products go together and writes the offer copy. At checkout the app picks the offer with plain rules and live Shopify data, so checkout makes no AI call.

This is a job-interview case study built on a Shopify development store with fictional demo products. It is not an official Grüns storefront or a production deployment.

> **Living document.** This README is updated as the project moves forward.

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
- **Upsell catalog by tag.** Settings can limit the app to products with one tag, for example `upsell`. Adding the tag in Admin brings a product in; removing it takes the product out right away, at no AI cost. With no tag, every active product is used. The tag also caps AI cost, which depends on catalog size.
- **Manual AI mode.** Settings can turn automatic AI updates off. Changes still queue up, and the merchant runs them when they choose, which also controls cost.

## Setup

These steps work on any Shopify **development store**: empty, with Shopify's sample data, or with products of your own. Step 9 limits the app to the demo products, whatever else is in the store.

### Prerequisites

- Node.js `>= 22.12`
- [Shopify CLI](https://shopify.dev/docs/api/shopify-cli) 4.x (built with 4.9.4)
- A Shopify Partner account and a development store
- An OpenAI API key, used only for the background AI steps

### 1. Install

```sh
git clone <this repo>
cd ai-checkout-upsell
npm install
```

### 2. Connect it to your own Shopify app

`shopify.app.toml` points at the author's app (`client_id`). Link the project to an app in your own Partner organization:

```sh
npm run config:link     # = shopify app config link; choose to create a new app
```

The CLI writes a new `shopify.app.<name>.toml` and makes it the default. Open it and check that it has the same `[access_scopes]` (`scopes = "read_products"`), `[webhooks]` and `[events]` sections as `shopify.app.toml`. Copy them over if they're missing. Shopify's docs don't say whether these are carried over, and the app needs the `[events]` subscriptions to keep product data current.

### 3. Environment variables

```sh
cp .env.example .env
```

Fill in `.env`, and never commit it:

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Background enrichment and relationships |
| `OPENAI_MODEL` | Model for those calls (this project used `gpt-6-luna`; see `cost.md`) |
| `OFFER_DISCOUNT_PERCENT` | Discount on the offer, default `15` |
| `OFFER_MAX_ORDER_RATIO` | Price cap: offer price <= ratio x order subtotal, default `1` |

`SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` are provided by `shopify app dev`.

### 4. Database

```sh
npm run setup        # prisma generate + migrate (SQLite file prisma/dev.sqlite)
```

### 5. Store settings for test orders

- **Test payments:** in Shopify Admin, go to **Settings > Payments** and turn on a test gateway. Development stores offer Shopify's test gateway (Bogus Gateway); the checkout then shows "Testing instruction: use 1 to simulate an approved transaction". See Shopify's [payments test mode guide](https://help.shopify.com/en/manual/checkout-settings/test-orders/payments-test-mode).
- **Storefront password:** development stores are password-protected. The password is under **Online Store > Preferences**. You'll enter it the first time a cart link opens.

### 6. Demo catalog

The demo uses 10 fictional products from "Demo Greens Co.", tagged `case-study-demo`. Each carries merchant-approved facts in the product metafield `custom.verified_facts` (list of single-line text), and those are the only facts the AI offer copy may use. The full data is in [`scripts/demo-catalog.json`](scripts/demo-catalog.json).

**Option A: seed script (recommended).** This is standalone reviewer tooling, not part of the app, and it uses your own Shopify CLI login:

```sh
shopify store auth --store <your-store>.myshopify.com --scopes write_products,read_publications,write_publications
node scripts/seed-demo-catalog.js --store <your-store>.myshopify.com         # dry run: shows the plan, changes nothing
node scripts/seed-demo-catalog.js --store <your-store>.myshopify.com --yes   # creates the products
```

What the script does:
- Refuses to run on a store that isn't a development store.
- Stops if `custom.verified_facts` already exists with a different type.
- Creates that definition if it's missing.
- Creates each demo product that doesn't exist yet (matched by handle) and publishes it to the Online Store.
- Never edits or deletes anything, including your own products, so it's safe to run twice.
- Ends by printing a **test cart path** for each product, such as `/cart/<variant id>:1`. Keep that list for step 10.

**Option B: by hand in Shopify Admin.**
1. Create the product metafield definition `custom.verified_facts` (list of single-line text).
2. Create the products below as Active, with untracked inventory. Copy each product's description, tags (including `case-study-demo`) and facts from `scripts/demo-catalog.json`.

| Product | Variants (price) | What it tests |
|---|---|---|
| Daily Greens Gummies, 28-Day Pouch | Original, Berry ($49.99) | Main product; expected offers are the Travel Packs or the Glass Jar |
| Daily Greens Gummies, 7-Day Travel Packs | Original ($14.99) | Portable complement; offers the Pocket Travel Tin |
| Daily Greens Powder, 30 Servings | Unflavored, Mint ($44.99) | Offers the Shaker Bottle or the Electrolyte Mix |
| Stainless Shaker Bottle, 20 oz | Black, Sage ($16.99) | Mixing accessory for the powder |
| Daily Greens Starter Bundle | Original ($59.99) | Already includes the Pouch and Jar (redundancy case) |
| Glass Storage Jar | Clear ($19.99) | Accessory for the Pouch |
| Pocket Travel Tin | Silver ($11.99) | Accessory for the Travel Packs |
| Evening Routine Gummies, 28-Day Pouch | Original ($39.99) | A second gummy line |
| Electrolyte Drink Mix, 10 Sticks | Citrus ($19.99) | Travel and powder complement |
| Canvas Tote | Natural ($24.99) | Low relevance; may get a weak offer or none |

### 7. Run the app

```sh
shopify app dev
```

Choose your development store when asked, then open the app (press `p` in the terminal) and approve the install. The app asks only for `read_products`.

### 8. Point the extension at your tunnel

The extension runs in the buyer's browser and calls the backend through the tunnel URL that `shopify app dev` prints (`https://<words>.trycloudflare.com`). That URL changes **every time** dev starts. Copy it into `APP_URL` in `extensions/intelligent-offer/src/config.js` and save; the dev server rebuilds the extension.

### 9. Limit the app to the demo products and build the AI data

In the app, open **Settings**, set **Upsell tag** to `case-study-demo` and press **Save and sync**.

- Do this whatever else is in the store. Only active products with that tag enter the app, so sample data or your own products stay out and add no AI cost.
- The sync adds the 10 demo products, and the AI then builds profiles and relationships. That takes about 1.5 minutes for 10 products.
- Open **Product intelligence** and wait until all 10 show as enriched with relationships listed.
- If they show as failed, check `OPENAI_API_KEY` and `OPENAI_MODEL`, then press **Run AI update** in Settings.

To check before a real checkout, open **Offer preview**, add the 28-Day Pouch, and confirm that an offer appears.

## Running a test checkout

A normal storefront checkout skips the post-purchase page while `shopify app dev` is running. Use the dev link:

1. Open `<tunnel URL>/extensions/dev-<extension uid>/purchase.post.render`. The uid is in `extensions/intelligent-offer/shopify.extension.toml`.
2. It redirects to `https://<your-store>.myshopify.com/cart/<variant>:1?script_url=...&post_purchase_dev_api_key=...`. The query parameters are what load the local extension. To test another basket, change only the `/cart/...` part, using the paths the seed script printed, and keep everything after `?`. For several items, join them with commas: `/cart/<id>:1,<id>:1`.
3. Fill in any test contact and address, and pay with card number `1`.
4. The post-purchase page shows the offer. **Pay now** adds it to the order; **Decline this offer** goes to the thank-you page.
5. Open **Analytics** to see the offer shown, accepted or declined, and the revenue.

Baskets worth trying: the 28-Day Pouch, the Powder, the Pouch plus the Starter Bundle, and the Canvas Tote.

### Troubleshooting

| Symptom | Likely cause |
|---|---|
| Checkout goes straight to the thank-you page | Not opened through the dev link (missing query parameters); stale `APP_URL` in `config.js`; or no offer for that basket. The dev terminal logs one `[offer]` line per checkout with the reason |
| Cart link shows a password page | Enter the storefront password (step 5), then open the link again |
| No offers in Offer preview | The AI step hasn't finished or failed (step 9), or the upsell tag doesn't match the products' tag |
| Products stay pending | Automatic AI updates are off in Settings; press **Run AI update** |
| Errors after pulling new code | Run `npm run setup` again and restart `shopify app dev`; the dev server caches the database client |

The seed script's dry run has been tested against the case study's store, and its pure parts are unit-tested. A full run from an empty store is being tested now.

## Admin pages

- **Product intelligence:** sync status, AI profiles and relationships for each product, plus the queue controls.
- **Offer preview:** build a basket and see the offer checkout would choose, every candidate and why each one wasn't chosen. It runs the same decision code as checkout and makes no writes.
- **Settings:** the upsell tag (which products are in the upsell catalog), automatic vs. manual AI updates, waiting and failed counts, and a manual **Run AI update** button.
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
npm test     # node --test, 61 unit tests, no network or database
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
- the demo catalog file and the seed script's planning rules
- the upsell tag rules

Manual and end-to-end results, with evidence, are in `docs/phase-1-test-checklist.md`, `docs/phase-2-test-checklist.md` and `docs/phase-4-test-checklist.md`. That includes real test orders #1012-#1016: accept, decline, a multi-item cart, out-of-stock fallback, and an offer refused after it sold out.

## Cost and scaling

The full running model is in [`cost.md`](cost.md). The numbers there are labeled as measured or estimated.

- **Checkout:** $0 in AI. Each new decision makes three indexed database reads, one Admin API query and one database write; each offer event adds one small database write.
- **Background:** all AI cost comes from enrichment and the relationship rebuild. A full rebuild sends the whole catalog with each product, so cost grows with the square of catalog size: about $0.004 per run at 10 products and about $10 at 1,000 (estimates).
- **Controls in place:** content-only triggers, the content hash, edit-then-undo detection, manual mode, and the upsell tag (only tagged products count toward catalog size).
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
scripts/             demo catalog data and the reviewer seed script (not part of the app)
cost.md              running cost model
master_context.md    working log: status, decisions, session history
```
