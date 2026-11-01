# Setup and test checkout

This guide takes you from a fresh clone to a test order with a post-purchase offer, on your own Shopify development store.

**Contents:** [Prerequisites](#prerequisites) · [Steps 1-9](#1-install) · [Run a test checkout](#run-a-test-checkout) · [Troubleshooting](#troubleshooting)

These steps work on any Shopify **development store**: empty, with Shopify's sample data, or with products of your own. Step 9 limits the app to the demo products, whatever else is in the store.

## Prerequisites

- Node.js `>= 22.12`
- [Shopify CLI](https://shopify.dev/docs/api/shopify-cli) 4.x (built with 4.9.4)
- A Shopify Partner account and a development store
- An OpenAI API key, used only for the background AI steps

## 1. Install

```sh
git clone <this repo>
cd ai-checkout-upsell
npm install
```

## 2. Connect it to your own Shopify app

`shopify.app.toml` points at the author's app (`client_id`). Link the project to an app in your own Partner organization:

```sh
npm run config:link     # = shopify app config link; choose to create a new app
```

The CLI writes a new `shopify.app.<name>.toml` and makes it the default. Open it and check that it has the same `[access_scopes]` (`scopes = "read_products"`), `[webhooks]` and `[events]` sections as `shopify.app.toml`. Copy them over if they're missing. Shopify's docs don't say whether these are carried over, and the app needs the `[events]` subscriptions to keep product data current.

## 3. Environment variables

```sh
cp .env.example .env
```

Fill in `.env`, and never commit it:

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Background enrichment and relationships |
| `OPENAI_MODEL` | Model for those calls (this project used `gpt-6-luna`; see [`cost.md`](../cost.md)) |
| `OFFER_DISCOUNT_PERCENT` | Default offer discount, `15` if unset. The **Settings** page overrides it |
| `OFFER_MAX_ORDER_RATIO` | Default price cap (offer price <= ratio x order subtotal), `1` if unset. The **Settings** page overrides it |

`SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` are provided by `shopify app dev`.

## 4. Database

```sh
npm run setup        # prisma generate + migrate (SQLite file prisma/dev.sqlite)
```

## 5. Store settings for test orders

- **Test payments:** in Shopify Admin, go to **Settings > Payments** and turn on a test gateway. Development stores offer Shopify's test gateway (Bogus Gateway); the checkout then shows "Testing instruction: use 1 to simulate an approved transaction". See Shopify's [payments test mode guide](https://help.shopify.com/en/manual/checkout-settings/test-orders/payments-test-mode).
- **Storefront password:** development stores are password-protected. The password is under **Online Store > Preferences**. You'll enter it the first time a cart link opens.

## 6. Demo catalog

The demo uses 10 fictional products from "Demo Greens Co.", tagged `case-study-demo`. Each carries merchant-approved facts in the product metafield `custom.verified_facts` (list of single-line text), and those are the only facts the AI offer copy may use. The full data is in [`scripts/demo-catalog.json`](../scripts/demo-catalog.json). For your own products, see [Writing verified facts](verified-facts.md).

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
- Ends by printing a **test cart path** for each product, such as `/cart/<variant id>:1`. Keep that list for test checkouts.

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

## 7. Run the app

```sh
shopify app dev
```

Choose your development store when asked, then open the app (press `p` in the terminal) and approve the install. The app asks only for `read_products`.

## 8. Point the extension at your tunnel

The extension runs in the buyer's browser and calls the backend through the tunnel URL that `shopify app dev` prints (`https://<words>.trycloudflare.com`). That URL changes **every time** dev starts. Copy it into `APP_URL` in `extensions/intelligent-offer/src/config.js` and save; the dev server rebuilds the extension.

## 9. Limit the app to the demo products and build the AI data

In the app, open **Settings**, set **Upsell tag** to `case-study-demo` and press **Save and sync**.

- Do this whatever else is in the store. Only active products with that tag enter the app, so sample data or your own products stay out and add no AI cost.
- The sync adds the 10 demo products, and the AI then builds profiles and relationships. That takes about 1.5 minutes for 10 products.
- Open **Product intelligence** and wait until all 10 show as enriched with relationships listed.
- If they show as failed, check `OPENAI_API_KEY` and `OPENAI_MODEL`, then press **Run AI update** in Settings.

To check before a real checkout, open **Offer preview**, add the 28-Day Pouch, and confirm that an offer appears.

## Run a test checkout

A normal storefront checkout skips the post-purchase page while `shopify app dev` is running. Use the dev link:

1. Open `<tunnel URL>/extensions/dev-<extension uid>/purchase.post.render`. The uid is in `extensions/intelligent-offer/shopify.extension.toml`.
2. It redirects to `https://<your-store>.myshopify.com/cart/<variant>:1?script_url=...&post_purchase_dev_api_key=...`. The query parameters are what load the local extension. To test another basket, change only the `/cart/...` part, using the paths the seed script printed, and keep everything after `?`. For several items, join them with commas: `/cart/<id>:1,<id>:1`.
3. Fill in any test contact and address, and pay with card number `1`.
4. The post-purchase page shows the offer. **Pay now** adds it to the order; **Decline this offer** goes to the thank-you page.
5. Open **Analytics** to see the offer shown, accepted or declined, and the revenue.

Baskets worth trying: the 28-Day Pouch, the Powder, the Pouch plus the Starter Bundle, and the Canvas Tote.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Checkout goes straight to the thank-you page | Not opened through the dev link (missing query parameters); stale `APP_URL` in `config.js`; or no offer for that basket. The dev terminal logs one `[offer]` line per checkout with the reason |
| Cart link shows a password page | Enter the storefront password (step 5), then open the link again |
| No offers in Offer preview | The AI step hasn't finished or failed (step 9), or the upsell tag doesn't match the products' tag |
| Products stay pending | Automatic AI updates are off in Settings; press **Run AI update** |
| Errors after pulling new code | Run `npm run setup` again and restart `shopify app dev`; the dev server caches the database client |

The seed script's dry run has been tested against the case study's store, and its pure parts are unit-tested. A full run on an empty store has not been done yet.
