# Master Context - Running Project State

> **Any agent (Claude, Codex, Gemini, ...) start here.**
> 1. Project root is `/Users/euribe/Desktop/ai-checkout-upsell/ai-checkout-upsell/` (the outer Desktop folder only wraps it).
> 2. Read `CLAUDE.md` for the full spec, requirements and architecture rules. It rarely changes.
> 3. Read this file for **current state**: what is done, what is verified, what is next.
> 4. When you finish a slice or end a session, update "Current status" and the three status lists, and **append** to the Decisions log and Session log. Never rewrite history entries.
> 5. Never write secret values here (API secret, tokens, customer data). Env var **names** only.

---

## 1. Current status

- **Phase:** 1 - **DONE 2026-10-30.** All four slices verified; results in `docs/phase-1-test-checklist.md`.
- **Phase 2 is split into two tracks** (developer, 2026-10-30):
  - **Track A, store/admin setup: DONE 2026-10-30.** See "Dev store state" in section 3. Done directly against the store, not through app code.
  - **Track B, app work: plan approved 2026-10-30, in progress.** Plan: `docs/phase-2-plan.md` (slices 0-7). Slices 1 and 2 verified 2026-10-30 (see `docs/phase-2-test-checklist.md`). Slice 3 verified 2026-10-30. **Architecture revised (developer): no AI call at checkout.** AI writes relationships + per-relationship offer copy offline (`relationships-v3`, migration `relationship_offer_copy`); checkout becomes deterministic. Verified 2026-10-30: 25 relationships with copy, 25/25 copy accepted (checklist 3.12-3.16). Slice 4 (Events) verified 2026-10-31 (archive/reactivate/content edit/price edit = no delivery; the mid-run queue fix still to confirm, checklist 4.7); committed `8dcc305`. **Slice 4b (developer-requested): Settings page with manual AI mode**, verified 2026-10-31 (checklist 4b.1-4b.7). **Slice 5 (candidate engine + ranking + Offer preview): verified and approved by the developer 2026-10-31** (unit tests, engine check on real data, Offer preview page; live stale-fact / out-of-stock runs and decision latency not separately recorded, checklist 5.10-5.12). **Slice 6 (engine wired into checkout): verified 2026-10-31** (real Bogus checkouts: Pouch -> Jar accepted, Powder -> Shaker declined, Pouch + Bundle -> Jar, Jar unavailable -> Tin; orders #1012-#1015 checked via CLI; one `OfferDecision` per checkout; engine 209-317 ms; checklist 6.1-6.8). 6.6 verified too (order #1016: Jar offered, made unavailable before Pay now, not added). Open findings: bundle-contains redundancy, uncapped multi-item bonus, top-8 live check limit (future work, section 6). **Slice 7 (docs): first project README written 2026-10-31** as a living document. **Phase 2 DONE.** **Phase 4 (offer events + Analytics page): verified 2026-10-31** (orders #1017 accept $17.00, #1018 decline after a reload, #1019 sold out before Pay now; Analytics page totals match; `docs/phase-4-test-checklist.md`). Then revisit the README (demo-catalog setup still to decide).
- **Cost model:** `cost.md` (repo root) is the running cost file. Update it whenever a price, cost driver or measured number changes.
- **Dev setup reminder:** tunnel changes on every `shopify app dev` run; update `extensions/intelligent-offer/src/config.js`. Last tunnel: `https://stuff-friend-university-concentrations.trycloudflare.com`. Restart dev after any Prisma migration (the dev server caches the Prisma client).
- **Plans:** Phase 1 plan is summarized in section 7. Phase 2 (Track B) plan: `docs/phase-2-plan.md`. `stash@{0}` holds the abandoned first Phase 2 attempt (seed script); safe to drop once the developer confirms.

## 2. Status lists

### Verified (observed working)
- `npm run lint` passes (after Slice 2 changes)
- **Phase 2 Slice 1:** Shopify grants the app only `read_products` (intelligence page + CLI log `Access scopes auto-granted: read_products`); the app loads with the new home page
- **Phase 2 Slice 2:** first sync created 10 rows with facts; description edit -> `changed: 1`; price-only edit -> `changed: 0`; no prices stored in snapshots; `npm test` 5/5
- **Slice 2:** ShouldRender -> `/api/offer` (token verified by `authenticate.public.checkout`) -> Admin lookup via `unauthenticated.admin(shop)` -> offer shown on the post-purchase page with Shopify-calculated totals (dev link, Bogus card 1). This also confirms the shop is resolved correctly from the token.
- `calculateChangeset` accepts `variantId` (camelCase). Not yet confirmed for the signed changeset used by `applyChangeset`.
- Decline calls `done()` and reaches the normal thank-you page (developer-verified)
- **Slice 3 / full Phase 1 happy path:** purchase A -> offer B -> Pay now -> signed changeset -> `applyChangeset` -> B added to the same order at 15% off with a second charge (order #8KLQEI8PP)
- Shopify accepts the tutorial's changeset JWT format, including `iat: Date.now()` (milliseconds) and `variantId` (camelCase)
- **Slice 4 failure paths:** already-purchased variant -> no offer (token includes `initialPurchase.lineItems[].product.variant.id`); offer variant unavailable -> no offer; backend unreachable -> straight to the thank-you page; regression of the offer page after hardening
- **Post-purchase token claims** (from the TEMP log, now removed): top level `iss`, `sub`, `input_data`, `iat`; **no `dest`**. `input_data` keys: `token`, `shop`, `initialPurchase`, `locale`, `extensionPoint`, `version`. Shop comes from `input_data.shop.domain`, referenceId from `input_data.initialPurchase.referenceId`.
- Embedded app installs and runs on `gruns-dev-store.myshopify.com` (developer-verified before Phase 1)
- Starter "Generate a product" action works (developer-verified)
- Bogus Gateway checkout on gruns-dev-store works (card 1)
- Post-purchase extension `intelligent-offer` (unmodified template) renders after payment on a normal storefront checkout once the app is selected under Settings > Checkout > Post-purchase page (app version `ai-checkout-upsell-2`)

### Coded but NOT verified
- **Phase 2 Slice 5:** `app/services/offers/candidate-ranking.js` (pure: `rankCandidates`, `pickOffer`, `chooseCopy`, `buildTemplateCopy`; `MIN_SCORE` 0.6, `MULTI_SOURCE_BONUS` 0.05), `candidate-engine.server.js` (`getOfferPolicy`, `fetchLiveProducts`, `findOffer`; live check of top 8 in one `nodes(ids:)` query), `app/routes/app.preview.jsx` (basket in `?products=` numeric IDs; offer, candidates with skip reasons, policy, decision time) + nav link. `npm test` 29/29, lint clean, engine check on 6 baskets matches the designed pairings (checklist 5.1-5.8). Developer verified the Offer preview page 2026-10-31. Slice 6 replaced `offer.server.js` at checkout.
- **Phase 2 Slice 6:** `app/services/offers/offer-decision.server.js` (`getCheckoutOffer`, `getOfferToSign`; one `OfferDecision` per `shop` + `referenceId`, reuse after a live check, `P2002` race handled), `offer-payload.js` (pure: `buildChanges`, `basketKey`, `checkStoredPick`, `toExtensionOffer`), `post-purchase-auth.server.js` (adds product GIDs, shop-money subtotal, currency, line titles/qty), both API routes, extension banner uses stored headline/description. `offer.server.js` removed. `npm test` 38/38, lint clean; decision check on real data (checklist 6.1-6.2).
- **Phase 2 Slice 4b (Settings / manual AI mode):** `ShopSettings` model (migration `shop_settings`, `autoEnrich` default true); `app/services/settings.server.js` (`getSettings`, `updateSettings`); `product-events.server.js` starts the queue only when `autoEnrich` is on (otherwise logs `automatic AI updates are off; <id> waits for a manual run`), retirements always happen; new `app/routes/app.settings.jsx` (On/Off badge + Turn on/off button, waiting/failed counts, last AI update, Run AI update, polling while running) and a Settings nav link. Turning it on starts a catch-up run. **Edit-then-undo fix:** `upsertProductSnapshot` compares new content with `enrichedHash`; a match puts the product back to ENRICHED and returns `unchanged` (reactivated products still re-enrich). DB-level scenario check passed. Lint clean, `npm test` 16/16. **Developer-verified live 2026-10-31 (checklist 4b.1-4b.7).**
- **Phase 2 Slice 4 (Events):** `shopify.app.toml` `[events]` now has `catalog-product-created-deleted` (create, delete) and `catalog-product-content-updated` (update; triggers title, descriptionHtml, productType, tags, status, options.*, `custom.verified_facts` metafield value) -> `/webhooks/catalog/products`. Template price subscription + `webhooks.products.update.jsx` removed. New `app/services/catalog/product-events.server.js` (re-reads the product, upserts, retires inactive/deleted, starts the queue only on real changes; delivery-ID dedupe remembers successes only) and `app/routes/webhooks.catalog.products.jsx`. Lint + `shopify app config validate` pass. **Verified 2026-10-31:** dev applied the subscriptions; archive -> retired, reactivate -> changed + re-enriched + edges restored, description revert stored, price edit -> no delivery (checklist 4.1-4.6). **Not verified:** queue fix for edits during a run (`rerunRequested` + save only if `sourceHash` unchanged, 4.7), code-reviewed only.
- **Phase 2 Slice 3:** `openai` SDK 7.45.1; `app/services/ai/{errors.js, schemas.js, validators.js, provider.server.js, openai.server.js}`; `app/services/catalog/{enrichment.server.js, relationships.server.js, enrichment-queue.server.js}`; intelligence page gains Process queue / Re-enrich all, category, errors, relationships table, auto-refresh while running. `npm test` 12/12, lint clean. First real run (`enrichment-v1`): 10/10 ENRICHED with `gpt-6-luna`, 19 relationships that match the designed complements (see `docs/phase-2-test-checklist.md` section 3). Defect found: the model put "JSON"/"object" in `format`; fixed with the `productFormat` field + validator rule + prompt `enrichment-v2`. Run 2 (`enrichment-v2`): 10/10, all formats fixed, 0 warnings/dropped; latency 2.4-5.4 s per call. **Slice 3 gate passed.** Open findings: checkout latency risk for Slice 6 and conservative relationships (fix: `relationships-v2`), see the checklist.
- Double-accept protection: the button lock plus Shopify's `changeset_already_applied` error should prevent a second charge. Not tested.
- 4s backend timeout in the extension (`withTimeout`): only the fast-failure case was tested.
- "Offer not configured" (`OFFER_VARIANT_ID` unset) and tampered-`referenceId` paths: code-reviewed only.
- Canvas Tote description was edited during the Slice 2 test; the developer is restoring the original text ("A sturdy cotton canvas tote bag with the Demo Greens Co. logo.") and its price ($30.99 now, demo price $24.99) may still differ.

### Blocked / unknown
- `input_data.shop.domain` is the myshopify domain on this dev store. On a store with a custom domain it might not be; verify before production.

## 3. Environment and commands

| Item | Value |
|---|---|
| Template | Shopify React Router app (`@shopify/shopify-app-react-router` 4.0.0, `react-router` 7.18.2, React 18), JavaScript/JSX |
| Shopify CLI | 4.9.4 |
| Node | 23.10.0 (engines `>=22.12`) |
| DB | Prisma + SQLite (`prisma/dev.sqlite`): `Session`, `ProductIntelligence`, `ProductRelationship`, `OfferDecision`, `OfferEvent`, `ShopSettings` |
| Admin API version | `July26` (`app/shopify.server.js`) |
| Dev store | `gruns-dev-store.myshopify.com` |
| GitHub | `https://github.com/UribeJr/ai-checkout-upsell` (private, branch `main`) |
| Scopes | `read_products` (since Phase 2 Slice 1) |

**Commands**
- `npm run dev` (= `shopify app dev`): starts the app + tunnel and injects `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`
- Dev Console (CLI 4.9.4): open `<tunnel URL>/extensions/dev-console` in the browser, then use the extension's post-purchase checkout link. Pressing `p` in the terminal opens the embedded app preview, NOT the Dev Console (the tutorial's `p` instruction is outdated for this CLI).
- **Post-purchase preview link (use this, not a normal storefront checkout):** `<tunnel URL>/extensions/dev-<extension uid>/purchase.post.render`. It redirects to `https://gruns-dev-store.myshopify.com/cart/<variant>:1?script_url=...&post_purchase_dev_api_key=...&uuid=...&socket_url=...`. Those query params are what make checkout load the local extension; a normal storefront checkout skips the post-purchase page. Extension uid is in `shopify.extension.toml`. Extension status can be checked with `curl <tunnel URL>/extensions`.
- `npm run lint`

**Env vars (names only; set in your shell or a gitignored `.env`)**
- `OFFER_VARIANT_ID`: retired in Slice 6 (no longer read; remove it from `.env`).
- `OFFER_MAX_ORDER_RATIO`: price cap, offer price ≤ ratio × order subtotal, default `1`
- `OFFER_DISCOUNT_PERCENT`: server-side discount policy, default `15`

**Phase 1 test products (historical; archived in Phase 2 Track A, looked up 2026-10-30):**
| Role | Product | Variant ID | Price | Notes |
|---|---|---|---|---|
| A (purchase) | The Inventory Not Tracked Snowboard | `68349213376735` | $949.95 | CLI's default preview cart already uses it |
| B (offer) | Selling Plans Ski Wax, variant "Selling Plans Ski Wax" | `68349213540575` | $24.95 | `requiresSellingPlan: false`, 0 selling plan groups, so it can be bought one-time. Natural snowboard complement. |
| Negative test (Slice 4) | The Out of Stock Snowboard | `68349213442271` | $885.95 | `availableForSale: false`, should produce no offer |

CLI access: `shopify store auth --store gruns-dev-store.myshopify.com --scopes read_products,write_inventory,read_orders` (re-authorized 2026-10-31; dev store only), then `shopify store execute --store gruns-dev-store.myshopify.com --query '...'`.

**Dev preview vs. deployed version:** while `shopify app dev` runs, the store serves the dev preview instead of the released version. Test the deployed extension on a normal checkout only after stopping dev (or running `shopify app dev clean`).

**Dev store state (Phase 2 Track A, done 2026-10-30 via `shopify store execute`):**
- Metafield definition `custom.verified_facts` (`list.single_line_text_field`, PRODUCT): merchant-owned approved facts. **Written by the merchant (here: us, once, standing in for the merchant). The app only reads it.** AI output is never stored there.
- 10 fictional "Demo Greens Co." products, tagged `case-study-demo`, ACTIVE, published to the Online Store (`gid://shopify/Publication/229669241055`), untracked inventory. Copy and facts come from the approved catalog (stash `scripts/demo-catalog.js`). These are the store's only ACTIVE products.

| Product | Product ID | Variants (ID, price) |
|---|---|---|
| Daily Greens Gummies, 28-Day Pouch | `15478588047583` | Original `68350166466783`, Berry `68350166499551` ($49.99) |
| Daily Greens Gummies, 7-Day Travel Packs | `15478588211423` | Original `68350166696159` ($14.99) |
| Daily Greens Powder, 30 Servings | `15478588342495` | Unflavored `68350166827231`, Mint `68350166859999` ($44.99) |
| Stainless Shaker Bottle, 20 oz | `15478588473567` | Black `68350167023839`, Sage `68350167056607` ($16.99) |
| Daily Greens Starter Bundle | `15478588604639` | Original `68350167351519` ($59.99) |
| Glass Storage Jar | `15478588735711` | Clear `68350167646431` ($19.99) |
| Pocket Travel Tin | `15478588932319` | Silver `68350167810271` ($11.99; was listed as $9.99 here, corrected 2026-11-01 from the store) |
| Evening Routine Gummies, 28-Day Pouch | `15478589128927` | Original `68350169022687` ($39.99) |
| Electrolyte Drink Mix, 10 Sticks | `15478589227231` | Citrus `68350169120991` ($19.99) |
| Canvas Tote | `15478589423839` | Natural `68350169645279` ($24.99) |

- **Archived template products (17).** To undo, set each back to its original status with `productUpdate(product: { id, status })`:

| Product ID | Title | Original status |
|---|---|---|
| `gid://shopify/Product/15478097543391` | The Inventory Not Tracked Snowboard | ACTIVE |
| `gid://shopify/Product/15478097576159` | Gift Card | ACTIVE |
| `gid://shopify/Product/15478097608927` | The Draft Snowboard | DRAFT |
| `gid://shopify/Product/15478097641695` | The Minimal Snowboard | ACTIVE |
| `gid://shopify/Product/15478097739999` | The Out of Stock Snowboard | ACTIVE |
| `gid://shopify/Product/15478097772767` | The Complete Snowboard | ACTIVE |
| `gid://shopify/Product/15478097838303` | The Compare at Price Snowboard | ACTIVE |
| `gid://shopify/Product/15478097903839` | Selling Plans Ski Wax | ACTIVE |
| `gid://shopify/Product/15478097936607` | The Collection Snowboard: Hydrogen | ACTIVE |
| `gid://shopify/Product/15478098002143` | The Videographer Snowboard | ACTIVE |
| `gid://shopify/Product/15478098067679` | The Hidden Snowboard | ACTIVE |
| `gid://shopify/Product/15478098198751` | The Multi-location Snowboard | ACTIVE |
| `gid://shopify/Product/15478098231519` | The 3p Fulfilled Snowboard | ACTIVE |
| `gid://shopify/Product/15478098264287` | The Multi-managed Snowboard | ACTIVE |
| `gid://shopify/Product/15478098297055` | The Collection Snowboard: Oxygen | ACTIVE |
| `gid://shopify/Product/15478098559199` | The Collection Snowboard: Liquid | ACTIVE |
| `gid://shopify/Product/15478117925087` | Orange Snowboard | ACTIVE |

- Test cart for a normal checkout: `https://gruns-dev-store.myshopify.com/cart/68350166466783:1` (28-Day Pouch, Original). The CLI's default dev link still points at the archived snowboard; for dev-link tests, swap the `/cart/<variant>:1` part.
- CLI store login scopes: `read_products,write_products,read_publications,write_publications,read_inventory,write_inventory,read_locations` (CLI only; the app's scopes are unchanged).

**Tunnel URL:** changes every `shopify app dev` run. After starting dev, copy the app URL into `extensions/intelligent-offer/src/config.js` (`APP_URL`). _(file created in Slice 2)_

**Store prerequisites for testing:** Settings > Payments > Bogus Gateway active. Settings > Checkout > post-purchase page set to this app. At least two active products with inventory and a shipping rate. Pay with a Bogus credit card, not Shop Pay / Apple Pay / Google Pay (wallets don't surface the post-purchase page).

## 4. File map (files added or changed by us)

| File | Purpose |
|---|---|
| `master_context.md` | This file - running state for agent handoffs |
| `AGENTS.md` | Added pointer to `CLAUDE.md` + this file (Codex reads AGENTS.md) |
| `GEMINI.md` | Same pointer for Gemini CLI |
| `extensions/intelligent-offer/` | CLI-generated post-purchase extension (`shopify.extension.toml` type `checkout_post_purchase`, `src/index.jsx`, `package.json`). `dist/` is gitignored. |

| `extensions/intelligent-offer/src/index.jsx` | ShouldRender fetches the offer (render only if one exists); Render shows it with Shopify-calculated totals; "Pay now" gets a signed changeset and calls `applyChangeset`; both buttons lock after the first press; every path ends in `done()`. |
| `extensions/intelligent-offer/src/config.js` | `APP_URL` (tunnel URL, update after each dev restart) |
| `app/routes/api.offer.jsx` | Offer endpoint for ShouldRender: verifies the token, looks up the shop's offer, always answers `{ offer }` (null on any failure) |
| `app/services/offer.server.js` | Removed in Slice 6 (was the Phase 1 hardcoded offer) |
| `app/services/offers/offer-decision.server.js`, `offer-payload.js` | Slice 6: checkout decision stored per checkout, sign only the stored pick |
| `app/services/post-purchase-auth.server.js` | Reads `shop` (`input_data.shop.domain`), `referenceId` and the purchased variant IDs (`input_data.initialPurchase.lineItems`) from the verified token |
| `app/routes/api.sign-changeset.jsx` | Accept endpoint: verifies the token, requires body `referenceId` to match the token's, re-runs `getOffer` (fresh eligibility check), signs the server-built changes |
| `app/services/changeset.server.js` | `signChangeset()`: JWT `{ iss, jti, iat, sub, changes }` signed with `SHOPIFY_API_SECRET` (tutorial format) |
| `package.json` | Added `jsonwebtoken` ^9.0.3 |
| `.eslintrc.cjs` | Turned off `react/prop-types` (plain JS project without PropTypes) |
| `.env` (gitignored, not committed) | `OFFER_VARIANT_ID=68349213540575`, `OFFER_DISCOUNT_PERCENT=15` |

| `README.md` | Project README for first-time reviewers: what/why, overview Mermaid diagram, key decisions, quick start, docs index, limitations (restructured 2026-11-01) |
| `docs/setup.md`, `docs/architecture.md`, `docs/analytics.md` | Setup + test checkout + troubleshooting (how-to); pipelines, checkout sequence, data model, decisions, admin pages, limitations (explanation, 3 Mermaid diagrams); events + metric definitions (reference) |
| `app/services/analytics/{offer-events.js, offer-events.server.js, metrics.js, metrics.server.js}`, `app/routes/api.offer-events.jsx`, `app/routes/app.analytics.jsx` | Phase 4: offer events (idempotent per decision + type), metrics, Analytics page |
| `app/services/catalog/catalog-scope.js` | Upsell tag rules (pure): `normalizeTag`, `isInUpsellCatalog`, `catalogSearchQuery`; used by sync, Events and Settings |
| `scripts/demo-catalog.json`, `scripts/seed-demo-catalog.js`, `scripts/demo-catalog-lib.js` | Reviewer setup: the 10 demo products (exported read-only from the dev store) and a standalone seed script via `shopify store execute` (dry run by default, `--yes` to apply, dev stores only, never edits/deletes). Not part of the app |
| `cost.md` | Running cost model: prices (with source/date), cost drivers, token estimates, cost by catalog size, controls, levers, measured spend |
| `app/routes/app.settings.jsx`, `app/services/settings.server.js` | Settings page: automatic vs manual AI updates (`ShopSettings.autoEnrich`) |
| `docs/phase-1-test-checklist.md` | Manual test checklist with status and evidence for every Phase 1 scenario |
| `CLAUDE.md` | Section 2 checkboxes and section 8 phase status updated after Phase 1 |

## 5. Decisions log (append-only)

- 2026-10-30: Phase 1 follows the official Shopify tutorial "Build a post-purchase product offer" (React Router version): `authenticate.public.checkout` for extension requests, `jsonwebtoken` to sign changesets.
- 2026-10-30: Use Node's built-in `crypto.randomUUID()` for the changeset `jti` instead of adding the `uuid` package (only deviation from the tutorial's dependencies).
- 2026-10-30: Discount is server-side business policy via `OFFER_DISCOUNT_PERCENT`, default 15% (matches tutorial). The extension never decides price or discount.
- 2026-10-30: Server re-derives the changeset from an offer ID and takes `referenceId` from the verified token, never trusting client-sent `changes`.
- 2026-10-30: Offer variant comes from `OFFER_VARIANT_ID` env var (store-specific, keeps the repo reproducible on a reviewer's store). Title, image, price and availability are fetched from Shopify Admin GraphQL.
- 2026-10-30: No Prisma changes and no scope changes in Phase 1. Event persistence is Phase 4.
- 2026-10-30: Phase 1 offer = Ski Wax (`68349213540575`) after Snowboard purchase. Low-priced complement, realistic upsell, verified not to require a selling plan.
- 2026-10-30: Stay on Shopify CLI 4.9.4 for the case study. CLI 5.0.0 (major) is available, but upgrading mid-project risks breaking changes. Revisit after Phase 1.
- 2026-10-30: The claude.ai Shopify connector was signed in to an unrelated store, not the dev store. It was disconnected from that store and is not used for this project; use the Shopify CLI `store auth`/`store execute` against gruns-dev-store instead.
- 2026-10-30: Changeset field is `variantId` (camelCase), following the installed `@shopify/post-purchase-ui-extensions` 0.13.x types. The tutorial sample uses `variantID`. If Shopify rejects `variantId` when the changeset is applied, try `variantID` and record it here.
- 2026-10-30: All displayed prices come from `calculateChangeset` (Shopify), not from our backend. The backend sends only title, image, discount % and the changes.
- 2026-10-30: Sign-changeset re-runs the full `getOffer` lookup before signing (instead of rebuilding the changes from the ID alone), so nothing is signed for an offer that became unavailable. Applies the CLAUDE.md rule to recheck eligibility before purchase changes.
- 2026-10-30: Changeset signing lives in `changeset.server.js`. Lint only allows Node globals (`process`) in `*.server.js` files, and this keeps the app secret out of route files.
- 2026-10-30: Exclude the offer when the buyer already bought that variant (from the verified token's line items), applied in both `/api/offer` and `/api/sign-changeset`.
- 2026-10-30: Extension waits at most 4s (`BACKEND_TIMEOUT_MS`) for each backend call, then skips the offer or continues to the thank-you page.
- 2026-10-31: **Corrected:** Shopify does publish a limit. "Network calls must complete in two seconds or less" (https://shopify.dev/docs/apps/build/checkout/product-offers/ux-for-post-purchase-product-offers, Performance consideration). `BACKEND_TIMEOUT_MS` stays at 4000 (developer choice); normal decisions take ~250 ms, so only a slow backend exceeds 2 s, and then the extension waits past Shopify's requirement. What Shopify does when the limit is exceeded is not documented. This requirement is also the strongest reason for no AI at checkout (measured AI calls: 2.4-5.4 s).
- 2026-10-30: Failure-path tests change store/config state instead of restarting dev (restarts change the tunnel URL): edit the cart in the dev link, set stock to 0 in Admin, point `APP_URL` at a dead host.
- 2026-10-30: Demo products are store fixtures created directly through the Admin API (Shopify CLI `store execute`), not app code; the app stays focused on upsell features. The claude.ai Shopify connector was preferred but disconnected, so the CLI was used.
- 2026-10-30: Approved product facts live in the merchant-owned metafield `custom.verified_facts`, written by the merchant; the app only reads them. The AI profile lives in the app database (planned `ProductIntelligence`), never in Shopify.
- 2026-10-30: Planned for Track B: reduce the app's scope from `write_products` (template default) to `read_products`, since the upsell only reads products. Note: the template "Generate a product" page in `app._index.jsx` needs `write_products` and must be removed or replaced at the same time. Requires re-approving the app once.
- 2026-10-30: AI layer: `AiError` codes (not_configured, timeout, provider_error, invalid_json, invalid_output); only `openai.server.js` imports the SDK; `store: false` on requests. Enrichment and relationships are separate AI calls with separate prompt versions; relationships for all profiled products are rebuilt whenever any profile changes (fine at ~10 products; a large catalog would rebuild only the affected neighbourhood). A failed re-enrichment keeps the previous profile and edges.
- 2026-10-30: Pure modules imported by unit tests use explicit `.js` import paths (plain Node needs them; Vite accepts both).
- 2026-10-30: **No AI call at checkout** (developer, after measuring 2.4-5.4 s per call). AI generates relationships + offer copy offline; checkout = DB candidates + live stock/price check + deterministic ranking + stored copy (template if the copy failed validation). Metafield-in-extension alternative rejected: loses basket logic and the live stock check, needs write_products, and the backend is still required for signing. See the revision note at the top of `docs/phase-2-plan.md`.
- 2026-10-30: Offer copy rules (`validateOfferCopy`): headline ≤ 60, description ≤ 160, ≥ 1 cited fact, all cited facts belong to the target product, no price/discount words, no health-claim wording.
- 2026-10-30: Turned off ESLint `react/prop-types` repo-wide. Plain JS, no PropTypes dependency.
- 2026-10-30: Every failure path (backend down, no offer, empty storage, calculateChangeset error) sends the buyer on with `done()` or `render: false`. The offer must never block checkout.
- 2026-10-30: Extension uses the JavaScript React flavor of the `post_purchase_ui` template.
- 2026-10-30: Shopify CLI 4.9.4 picks pnpm when `pnpm-workspace.yaml` exists (part of the template), but this project uses npm (`package-lock.json`) and pnpm isn't installed. To generate extensions, temporarily move `pnpm-workspace.yaml` out of the root, run `npm run shopify -- app generate extension ...`, then move it back. Kept the file because it's part of the official scaffold.
- 2026-10-31: **Manual AI mode** (developer): per-shop `ShopSettings.autoEnrich` on a dedicated Settings page. Off = events still record changes (PENDING) and still retire products, but no AI run starts until Run AI update. Gives the merchant control of when AI cost happens; doesn't reduce the cost of a run (incremental rebuild + shortlist do, see `cost.md`).
- 2026-10-31: Settings uses an On/Off badge + button instead of `<s-switch>`: Shopify's app-home migration docs say a controlled `s-switch`/`s-checkbox` needs React 19 and the app is on React 18.3.1.
- 2026-10-31: `cost.md` added as a running cost file (developer). Prices from https://developers.openai.com/api/docs/pricing (gpt-6-luna $0.10 in / $0.01 cached / $0.50 out per 1M, checked 2026-10-31); token counts are estimates until `response.usage` is logged.
- 2026-10-31: Edit-then-undo costs nothing: sync compares new content with what the AI last enriched (`enrichedHash`), not only the last stored version. Saves one enrichment + a full relationship rebuild per undone edit (~$10 at 1,000 products, see `cost.md`).
- 2026-10-31: Slice 5 policy (developer): price cap `OFFER_MAX_ORDER_RATIO`, default 1 (offer ≤ order subtotal, shop currency); offer preview on its own page. Min score 0.6 and UPGRADE exclusion as planned. The stored AI copy is used only while every cited fact is still in the live `custom.verified_facts` (stale-fact guard); otherwise template copy (`Add {title} to your order` + first live fact). Targets don't need to be ENRICHED, only not retired: the live check and fact guard cover stale data while manual mode holds changes.
- 2026-10-31: Preview avoids controlled `s-checkbox` (React 18): Add/Remove buttons + basket in the URL.
- 2026-11-01: **Upsell catalog tag** (developer idea): `ShopSettings.upsellTag` (Settings page; migration `shop_settings_upsell_tag`). In the catalog = ACTIVE and, if a tag is set, has the tag (case-insensitive). Empty = all active products (default, unchanged behavior). Untagged products are retired via the existing `retireProducts` (no AI cost); tag added in Admin -> Events -> PENDING -> AI run. Saving the tag re-syncs immediately. Sync filters again after the search query because the search index can lag. Tags with quotes/backslashes are rejected (would break the search string). Seed script also checks the facts definition type.
- 2026-11-01: Reviewer setup (developer): both a data file and a seed script, one source of truth (`scripts/demo-catalog.json`). The script is standalone tooling outside `app/` (the app stays upsell-only), uses the reviewer's own CLI login, refuses non-development stores (`shop.plan.partnerDevelopment`), skips existing handles, never edits or deletes.
- 2026-10-31: Phase 4 events: IMPRESSION = offer page shown with Shopify totals (not the ShouldRender preload); ACCEPTED is recorded by the server when it signs (not trusted from the client); APPLIED value = added line after discount in shop money from `calculatedPurchase`, accepted only if 0 < value <= `OfferDecision.offerPrice`, else stored without a value (`value_rejected`). One event per type per decision. Event writes never throw (measurement must not break checkout); extension event calls time out after 1.5 s. Revenue is labeled 'attributed', not incremental (no holdout); refunds not subtracted (would need `read_orders`). Low-sample warning below 30 impressions (our threshold).
- 2026-10-31: Slice 6: decide once per checkout and store it (`OfferDecision`, unique `shop` + `referenceId`); a repeat ShouldRender reuses the stored pick after a live check so the buyer sees the same offer; Accept signs only the stored pick (offer ID = decision ID) after another live check. `NONE` decisions are stored too. Subtotal = sum of token line totals in shop money (same currency as the price cap). The existing `OfferDecision` table is reused, no migration.

## 6. Open questions and risks

- Loom/README talking points from the Slice 3 test: the upsell ships as a second shipment (fulfillment cost/margin impact) and is a second card charge. The dev store charges $0 shipping/tax, so add a small tax or shipping rate if the demo should show `calculateChangeset` doing real work.
- The deployed app version (`ai-checkout-upsell-2`) still contains the template extension. Redeploy (with a reachable backend URL) before demoing a normal checkout.

- Testing tip: `authenticate.public.checkout` returns **410** to bot user agents, and `curl` counts as a bot. Use a browser UA (`curl -A "Mozilla/5.0 ..."`) when smoke-testing `/api/*` routes.

- Documented platform limitations to mention in README/Loom: third-party pixels report only the initial purchase (not the upsell); ScriptTag/additional scripts on the order status page get incomplete data; no post-purchase page for wallets, gift cards, installments, duties/multi-currency orders. Our own event tracking (Phase 4) covers the measurement gap.

- **Deployed app config has `application_url = https://example.com`** (scaffold default in `shopify.app.toml`, released by `shopify app deploy` because `include_config_on_deploy = true`). While `shopify app dev` runs, the dev session overrides it; without dev, the embedded admin app won't load. Before the final demo deploy we need a hosted backend URL (or a stable tunnel) in `shopify.app.toml` and in the extension's `APP_URL`.

- The post-purchase page not appearing is often store config (gateway, wallet payment, app not selected as post-purchase app), not a code bug.
- Tunnel URL must be updated in the extension config each dev run. A stable `--tunnel-url` would remove this step later.
- CLI 4.x template file names may differ from the tutorial's `src/index.jsx`. Check what is generated before editing.
- **Ranking follow-ups (future work, developer chose not to fix now, 2026-10-31):**
  - Multi-item bonus has no ceiling (`MULTI_SOURCE_BONUS` 0.05 per extra source in `candidate-ranking.js`). In a 10-item cart a 0.60 match pointed at by 9 items scores 1.00 and beats a single 0.92 match. Fix: cap the total bonus, e.g. `MULTI_SOURCE_BONUS_MAX = 0.15` + `Math.min`, with a 10-item unit test. 0.15 is a suggestion; tune with Phase 4 accept data. Carts of 2-4 items are unaffected.
  - Bundle redundancy: another item's relationship can offer what a bundle in the cart already contains (order #1014: Starter Bundle buyer accepted a Glass Jar). Fix: a basket-wide "included" exclusion.
  - Only the top 8 candidates are checked live; if all 8 fail there is no offer. Fix: check the next batch.
- Fallback if Shopify APIs block a real demo: a standalone order-simulation page (allowed by the brief), only after documenting the investigation here.

## 7. Phase 1 plan summary

Flow: `ShouldRender` POSTs `/api/offer` with `Bearer inputData.token` -> server verifies the token, fetches the hardcoded offer variant from Admin GraphQL -> extension stores it and renders only if an offer exists. `Render` calls `calculateChangeset` so Shopify computes totals, shipping and tax. Accept -> POST `/api/sign-changeset` -> server re-derives changes and signs a JWT -> `applyChangeset(token)` -> `done()`. Decline -> `done()`.

Slices:
1. Handoff files + generate extension; confirm the unmodified template renders after a Bogus order.
2. `api.offer.jsx` + `offer.server.js` + `post-purchase-auth.server.js`; post-purchase page shows product B with Shopify-calculated totals.
3. `api.sign-changeset.jsx` + accept/decline; Accept adds B (15% off) to the same order in Admin; Decline leaves it unchanged.
4. Hardening (no offer, unavailable variant, server down, double-click) + `docs/phase-1-test-checklist.md` + update this file and `CLAUDE.md` section 2.

## 8. Session log (append-only)

- 2026-10-30 - Claude Code (Opus 5.5): Inspected repo (findings in sections 3-4), researched current Shopify post-purchase docs, wrote Phase 1 plan (approved by developer). Created this file, `GEMINI.md`, and the `AGENTS.md` pointer. Started Slice 1.
- 2026-10-30 - Claude Code (Opus 5.5): Generated `extensions/intelligent-offer` (`--template post_purchase_ui --flavor react`) after working around CLI pnpm detection (see Decisions). Lint shows 4 errors in the generated template only. Waiting on developer's manual checkout test for the Slice 1 gate.
- 2026-10-30 - Claude Code (Opus 5.5): Developer found that `p` opens the app home, not the Dev Console. Verified in the CLI 4.9.4 bundle that the Dev Console is served at `<tunnel URL>/extensions/dev-console`; updated commands above.
- 2026-10-30 - Claude Code (Opus 5.5): Developer checked out via normal storefront checkout and saw no banner. Confirmed via `<tunnel>/extensions` that the extension built successfully for gruns-dev-store; the cause was missing dev query params. Documented the preview link pattern above.
- 2026-10-30 - Claude Code (Opus 5.5): Authenticated the CLI read-only (`read_products`) against gruns-dev-store, listed the catalog, and chose test products A, B and the negative case (section 3).
- 2026-10-30 - Developer: ran `shopify app deploy`. Version `ai-checkout-upsell-2` is active (18:52), containing the unmodified template extension. Next: select the app for the post-purchase page in Settings > Checkout and test a normal storefront checkout with the Bogus Gateway. Not yet verified.
- 2026-10-30 - Developer + Claude: normal storefront checkout (Bogus card 1, Compare at Price Snowboard) went straight to the thank-you page with no post-purchase page. Bogus payment worked. Likely cause: `shopify app dev` was still running, so the store used the dev preview, whose post-purchase extension only loads via the dev link params. Second suspect: app not selected under Settings > Checkout > Post-purchase page. Fix to try: stop dev (or `shopify app dev clean`), confirm the app selection, retest.
- 2026-10-30 - Developer: correction to the entry above. The real cause was that the app was not selected under Settings > Checkout > Post-purchase page. After selecting it, the template post-purchase page rendered on a normal checkout. **Slice 1 gate passed.** Note: the template's button does not call `done()`; Shopify's "View order confirmation" link still reaches the thank-you page. Slice 3 accept/decline must always end with `done()`.
- 2026-10-30 - Claude Code (Opus 5.5): Implemented Slice 2 (files in section 4). Tested the Admin query against the dev store with `shopify store execute`; lint passes; route smoke test passed (401 without a valid token, CORS preflight OK). Created `.env` with the offer settings. Waiting on dev restart + real checkout.
- 2026-10-30 - Developer + Claude: restarted dev (tunnel `fairly-instances-herbal-classified`), updated `APP_URL`, tested the dev link. **Slice 2 gate passed**: Ski Wax offer at $21.21 with Shopify-calculated totals.
- 2026-10-30 - Developer + Claude: confirmed token claims from the TEMP log (no `dest`; see Verified) and removed the log. Developer confirmed Decline reaches the thank-you page. Claude implemented Slice 3 (sign-changeset route, `changeset.server.js`, Pay now button); lint and smoke tests pass. Waiting on a real Accept test.
- 2026-10-30 - Developer: tested Pay now via the dev link. **Slice 3 gate passed** (order #8KLQEI8PP: Ski Wax added at $21.21, second charge, total $971.16). Phase 1 happy path works end to end; Slice 4 (negative tests + checklist) remains.
- 2026-10-30 - Claude Code (Opus 5.5): created private repo `UribeJr/ai-checkout-upsell` and pushed `main`. Single initial commit (a scaffold-only commit wasn't reproducible because package files were already modified). Pre-push scan: no secrets, `.env`/sqlite/dist/.shopify excluded; replaced an employer-store reference in this file with neutral wording.
- 2026-10-30 - Developer + Claude: **Slice 4 done, Phase 1 complete.** Added the already-purchased exclusion and the 4s backend timeout. Tests passed: #5 regression, #6 already purchased, #7 unavailable variant, #8 backend unreachable (details in the checklist). Claude reset the Ski Wax stock via `inventorySetQuantities` (all three variants back to 10 available; the Ski Wax variant has on hand 12 with 2 committed by test orders). Updated CLAUDE.md sections 2 and 8.
- 2026-10-30 - Claude Code (Opus 5.5): Phase 2 attempt 1 (seed script + plan) was stashed at the developer's request (`stash@{0}`); the repo was reset to `b9a74b1`. Phase 2 split into Track A (store setup) and Track B (app). **Track A done:** created `custom.verified_facts`, created and published the 10 demo products (verified ACTIVE, online, sellable, facts present; a rerun skips all 10), and archived the 17 template products (IDs above). Phase 1 demo offer now offline by design.
- 2026-10-30 - Claude Code (Opus 5.5): wrote and got approval for the Track B plan (`docs/phase-2-plan.md`: least privilege, sync, enrichment, Events, candidates, AI selection, docs). Slice 0: committed the Track A record and the plan.
- 2026-10-30 - Claude Code (Opus 5.5): Phase 2 Slice 1 coded (scope reduction + template cleanup); lint and config validation pass. Waiting on the developer to run dev and confirm the app loads after scope re-approval.
- 2026-10-30 - Claude Code (Opus 5.5): Slice 1 app load verified by the developer; scope grant pending confirmation. Slice 2 coded (migration applied to dev.sqlite, sync services, intelligence page, unit tests pass, lint clean). Waiting on a dev restart and the manual sync gate.
- 2026-10-30 - Developer + Claude: Slice 1 and Slice 2 gates passed (granted scope `read_products`; sync created 10 / changed 1 on description edit / changed 0 on price edit). Results in `docs/phase-2-test-checklist.md`.
- 2026-10-30 - Claude Code (Opus 5.5): Slices 1-2 committed (`1cbcb9f`). Developer added `OPENAI_API_KEY` + `OPENAI_MODEL=gpt-6-luna` to `.env` (verified present, not printed). Slice 3 coded and unit-tested; waiting on a dev restart and the first real enrichment run.
- 2026-10-30 - Developer + Claude: first live enrichment run succeeded (10/10, 19 sensible edges). Found and fixed the `format` -> "JSON"/"object" defect (`enrichment-v2`). Waiting on the re-run.
- 2026-10-30 - Developer + Claude: run 2 passed (10/10 `enrichment-v2`, formats fixed, latency recorded). Slice 3 committed. Started `relationships-v2` (more complete edge lists) at the developer's request.
- 2026-10-30 - Claude Code (Opus 5.5): implemented the offline-copy revision: migration `relationship_offer_copy`, `relationships-v3` prompt with offer copy, `validateOfferCopy`, offer copy column on the intelligence page; `npm test` 16/16, lint clean. The `relationships-v2` run was skipped (superseded by v3).
- 2026-10-30 - Developer + Claude: `relationships-v3` run passed: 25 edges, all with validated AI copy, Travel Packs now has an eligible offer (Tin).
- 2026-10-30 - Claude Code (Opus 5.5): Slice 4 coded (Events subscriptions + handler). Fixed in review before running: dedupe originally marked deliveries as seen before processing, which would have skipped Shopify's retry after a failure.
- 2026-10-31 - Developer + Claude Code (Opus 5.5): Slice 4 tested on the Pocket Travel Tin: archive -> retired, reactivate -> changed with automatic enrichment and a 10-product relationship rebuild, description reverted. Found and fixed a queue gap: edits arriving during a run were skipped (and an edit during that product's own AI call could be overwritten by the old profile). Price-edit check and the fix are still to be confirmed live.
- 2026-10-31 - Claude Code (Opus 5.5): committed Slice 4 (`8dcc305`, not pushed). Built Slice 4b, the Settings page with manual AI mode (migration `shop_settings`), and created `cost.md`. Dev needs a restart for the new Prisma model.
- 2026-10-31 - Developer: Slice 4b tests all passed (manual mode, waiting count, Run AI update, retire while off, catch-up on turn-on, edit-then-undo).
- 2026-10-31 - Claude Code (Opus 5.5): Slice 5 coded per the approved plan. 13 new unit tests; engine check on the real DB + live store (temporary CLI-backed admin script, deleted). Developer to test the Offer preview page.
- 2026-10-31 - Claude Code (Opus 5.5): developer confirmed the Offer preview works and approved Slice 5; checklist 5.9 recorded; Slice 5 committed. Next: Slice 6 (wire `findOffer` into checkout).
- 2026-10-31 - Claude Code (Opus 5.5): Slice 6 coded per the approved plan. 9 new unit tests (38/38); decision-service check on real data with simulated token data (rows and script deleted). Finding: Pouch + Starter Bundle offers the Jar the bundle already contains (checklist 6.5). Developer to run the checkout tests 6.3-6.8.
- 2026-10-31 - Developer + Claude Code (Opus 5.5): developer confirmed the Slice 6 checkout tests. DB: 4 checkouts -> 4 decisions (AI_COPY), engine 223-317 ms. Jar inventory tracking turned on for the test and back off afterwards via `shopify store execute` (no AI work triggered). Slice 6 committed.
- 2026-10-31 - Claude Code (Opus 5.5): CLI store auth re-run with `read_orders` (developer approved in browser). Orders #1012-#1015 confirm 6.3-6.5; 6.6 was not actually exercised (moved back to ⏳).
- 2026-10-31 - Developer + Claude Code (Opus 5.5): 6.6 run properly: Jar offered, Claude turned on Jar tracking (stock -2) via CLI while the offer page was open, Pay now -> thank-you page, order #1016 without the Jar. Jar tracking turned back off. All Slice 6 tests pass.
- 2026-10-31 - Claude Code (Opus 5.5): Slice 7 per the approved plan: project README (status, architecture, decisions, setup, test checkout, admin pages, testing, cost, limitations, repo map), stale facts refreshed here and in `CLAUDE.md`. Demo-catalog setup left 'to be decided after Phase 4' (developer). Phase 2 done.
- 2026-10-31 - Claude Code (Opus 5.5): Phase 4 coded per the approved plan (migration `offer_events`, events endpoint, server-side ACCEPTED/APPLY_FAILED, extension events, metrics, Analytics page). 49/49 tests; real-DB service check (rows deleted). Developer to restart dev and run checkout tests 4.4-4.8.
- 2026-10-31 - Developer + Claude Code (Opus 5.5): Phase 4 checkout tests passed (orders #1017-#1019 match the events); Analytics page confirmed by screenshot. Small copy fixes on the page. Phase 4 committed.
- 2026-10-31 - Claude Code (Opus 5.5): developer asked about Shopify timing limits. Found the documented 2-second requirement for post-purchase network calls (earlier notes said there was none). Proposed lowering the extension timeout to 1800 ms; developer chose to keep 4000 ms.
- 2026-11-01 - Claude Code (Opus 5.5): reviewer setup per the approved plan: catalog exported read-only to `scripts/demo-catalog.json`, seed script + pure helpers, 6 new tests (55/55), README store-setup section (script + manual route + product table). Dry run on gruns-dev-store: dev-store check passed, definition found, 10/10 skipped. Mutation arguments checked against the live schema by introspection. Write path not yet run on an empty store.
- 2026-11-01 - Claude Code (Opus 5.5): upsell tag per the approved plan (schema + migration, `catalog-scope.js`, sync/Events/Settings/intelligence page) and seed-script definition-type check. 61/61 tests, lint clean; tag search strings checked read-only on the store (`travel` -> 3, `case-study-demo` -> 10, `drink mix` -> 1). Developer to restart dev and run the Settings tests (a-g).
- 2026-11-01 - Developer + Claude Code (Opus 5.5): developer confirmed all upsell tag tests (a-g) worked. Store state after the tests: Settings tag `case-study-demo`, 10 products ENRICHED, 29 relationships. Developer wants the store on tag `upsell`; no product has that tag yet, so add `upsell` to the 10 demo products first (Admin bulk edit, or CLI `tagsAdd` after re-auth with `write_products`), then set the Settings tag (re-enrichment of all 10 expected: tags are in the content hash). Reviewer docs keep `case-study-demo`. Committed.
- 2026-11-01 - Claude Code (Opus 5.5): reviewer setup finished for a blind test by the developer on a new dev store. README Setup rewritten as numbered steps 1-9 for any store (empty, sample data or own products; step 9 always sets the upsell tag `case-study-demo`), plus test-checkout steps and troubleshooting. Added `.env.example` (`.gitignore` exception), seed script prints test cart paths, home page text fixed (said AI picks at checkout). Unverified in the README: whether `shopify app config link` carries over scopes/webhooks/events (docs silent), told reviewers to check.
- 2026-11-01 - Claude Code (Opus 5.5): documentation pass under the new user-level documentation standards (`~/.claude/CLAUDE.md`, skills technical-writer + mermaid-diagram-builder). README 279 -> 119 lines; details moved to `docs/setup.md`, `docs/architecture.md`, `docs/analytics.md`. ASCII diagram replaced by 4 Mermaid diagrams (overview, background pipeline, checkout sequence, ER), every node checked against the code. Fixed: 'step 10' reference, missing #1017-#1019 in testing summary, events endpoint missing from the repo map, validator list now includes health-claim wording. Mermaid static checks pass (the ER diagram's `o{` is a false positive of the checker); a real render (mmdc) was blocked, so rendering on GitHub is unconfirmed until viewed. Not committed.
- 2026-11-01 - Developer + Claude Code (Opus 5.5): developer found the checkout sequence diagram hard to read (5 lanes, 16 arrows, alt boxes). Split into two small diagrams in `docs/architecture.md` (decide while the buyer pays; accept on the offer page), database lane dropped, decline and sold-out cases moved to bullets. GitHub rendering of the Mermaid confirmed by the developer's screenshot.
- 2026-11-01 - Claude Code (Opus 5.5): added 'Production path' to `docs/architecture.md` (run it for real, trustworthy numbers, better offers, cost at scale), built only from items already recorded in the limitations, `cost.md` and code comments; all labeled not built. Linked from the README. For the 30-minute interview demo (screenshare demo + walkthrough of the README and docs).
