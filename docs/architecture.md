# Architecture

How the app picks and shows a post-purchase offer, and why it's built this way. For setup, see [setup.md](setup.md).

The principle: **AI recommends offline, the backend validates, and Shopify calculates and applies.** The model never decides prices, discounts, stock or what gets charged.

## Background pipeline: where the AI runs

Product data reaches the app three ways: **Sync catalog** on Product intelligence, saving the upsell tag in Settings, and Shopify Product events. The events fire only on content fields, never on price or inventory. A content hash then decides whether the AI has anything new to do.

```mermaid
flowchart TD
    accTitle: Background product intelligence pipeline
    accDescr: A manual sync, a Settings save or a Shopify Product event updates the product snapshot. Content changes mark the product pending; the queue then runs AI enrichment and rebuilds relationships with offer copy, validating each result before saving it. Archived, deleted or untagged products are retired without AI.

    trigger([Sync catalog, Settings save or Product event]) --> fetch[Read the product from Shopify]
    fetch --> scope{Active and in the upsell catalog?}
    scope -- No --> retire[Retire: remove its relationships]
    scope -- Yes --> hash{Content hash changed?}
    hash -- No --> skip([No AI work])
    hash -- Yes --> pending[Mark PENDING]
    pending --> mode{Automatic AI updates on?}
    mode -- No --> wait([Waits for Run AI update])
    mode -- Yes --> queue[[Queue: one runner per shop, retries]]
    wait -. manual run .-> queue
    queue --> enrich[AI enrichment: category, format, use cases]
    enrich --> rel[AI relationships: up to 5 per product, score, type, offer copy]
    rel --> validate{Valid and cites only verified facts?}
    validate -- Yes --> save[(ProductIntelligence and ProductRelationship)]
    validate -- No --> drop[Drop the bad item, keep the previous data]
```

- **Enrichment** (`app/services/catalog/enrichment.server.js`) gives each product a category, format and use cases.
- **Relationships** (`relationships.server.js`) give each product up to 5 related products. Each relationship has a score, a type (`COMPLEMENTARY`, `ACCESSORY`, `REFILL` or `UPGRADE`) and offer copy. The copy may only use the target product's `custom.verified_facts`.
- **Validation** (`app/services/ai/validators.js`) checks every AI result before it is saved: known product IDs, no self-links, facts that really belong to the product, no prices, discounts or health-claim wording in the copy, and length limits. An invalid result is dropped and the previous data is kept.
- **The queue** (`enrichment-queue.server.js`) runs in-process, with one runner per shop and up to 3 attempts with backoff.

## Checkout: no AI call

```mermaid
sequenceDiagram
    accTitle: Checkout offer sequence
    accDescr: The extension asks the backend for an offer during payment. The backend decides once per checkout from stored relationships and a live Shopify check, then the extension shows Shopify-calculated prices. On accept, the backend rechecks and signs the stored pick, and Shopify applies it. Each step records an offer event.

    actor Buyer
    participant Ext as Post-purchase extension
    participant App as App backend
    participant DB as App database
    participant Shop as Shopify

    Buyer->>Ext: Pays for the order
    Ext->>App: POST /api/offer (ShouldRender, signed token)
    App->>DB: Stored relationships for the purchased products
    App->>Shop: Live check of the top 8 (status, stock, price)
    App->>DB: Save one OfferDecision for this checkout
    App-->>Ext: Offer: product, AI or template copy, signed-change inputs
    Ext->>Shop: calculateChangeset (prices, discount, shipping, tax)
    Ext->>App: POST /api/offer-events (IMPRESSION)
    alt Buyer presses Pay now
        Ext->>App: POST /api/sign-changeset
        App->>Shop: Recheck the stored pick
        App-->>Ext: Signed changes (ACCEPTED), or 409 if no longer available
        Ext->>Shop: applyChangeset
        Ext->>App: POST /api/offer-events (APPLIED or APPLY_FAILED)
    else Buyer declines
        Ext->>App: POST /api/offer-events (DECLINED)
    end
    Ext-->>Buyer: Thank-you page
```

How `/api/offer` picks the offer (`app/services/offers/`):

1. **Basket.** The purchased products, variants and subtotal come from the post-purchase token, which Shopify signs and the backend verifies.
2. **Candidates.** The stored relationships of those products.
3. **Rules.** Drop `UPGRADE` relationships, products already bought and scores below 0.6. When several cart items point at the same product, keep it once with +0.05 per extra item.
4. **Live check.** One Shopify query for the top 8. Keep the first that is active, in stock and priced at or below the order subtotal.
5. **Copy.** Use the stored AI copy only if every fact it cites is still a verified fact. Otherwise use template copy ("Add {product} to your order").
6. **Store.** Save one `OfferDecision` per checkout. A repeat call reuses it after another live check.

The extension shows only prices from Shopify's `calculateChangeset`. On **Pay now**, `/api/sign-changeset` rechecks the stored pick and signs changes it builds itself.

## Data model

```mermaid
erDiagram
    accTitle: App database tables
    accDescr: Each product has outgoing relationships to other products. Each checkout has one offer decision, and each decision has its offer events. Shop settings hold the upsell tag and the AI update mode.

    ProductIntelligence ||--o{ ProductRelationship : "source of"
    OfferDecision ||--o{ OfferEvent : "has"

    ProductIntelligence {
        string productId
        string sourceHash
        string enrichmentStatus
        datetime deletedAt
    }
    ProductRelationship {
        string sourceProductId
        string targetProductId
        string type
        float score
        string headline
    }
    OfferDecision {
        string referenceId
        string selectedVariantId
        string source
        float offerPrice
    }
    OfferEvent {
        string type
        float value
        string reason
    }
    ShopSettings {
        string shop
        boolean autoEnrich
        string upsellTag
    }
```

The full schema is in [`prisma/schema.prisma`](../prisma/schema.prisma). JSON fields are stored as strings so SQLite and Postgres behave the same.

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

## Admin pages

- **Product intelligence:** sync status, AI profiles and relationships for each product, plus the queue controls.
- **Offer preview:** build a basket and see the offer checkout would choose, every candidate and why each one wasn't chosen. It runs the same decision code as checkout and makes no writes.
- **Settings:** the upsell tag (which products are in the upsell catalog), automatic vs. manual AI updates, waiting and failed counts, and a manual **Run AI update** button.
- **Analytics:** offers shown, conversion, attributed revenue, revenue per offer shown, top offers (with a low-sample warning) and recent checkouts with their events.

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
