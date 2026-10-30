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
  - **Track B, app work: plan approved 2026-10-30, in progress.** Plan: `docs/phase-2-plan.md` (slices 0-7). Slices 1 and 2 verified 2026-10-30 (see `docs/phase-2-test-checklist.md`). Slice 3 verified 2026-10-30. **Architecture revised (developer): no AI call at checkout.** AI writes relationships + per-relationship offer copy offline (`relationships-v3`, migration `relationship_offer_copy`); checkout becomes deterministic. Verified 2026-10-30: 25 relationships with copy, 25/25 copy accepted (checklist 3.12-3.16). Next: **Slice 4 - Events**.
- **Phase 1 demo is offline on purpose:** the Ski Wax offer product was archived, so `/api/offer` returns no offer until Phase 2's AI offer selection replaces it.
- **Dev setup reminder:** tunnel changes on every `shopify app dev` run; update `extensions/intelligent-offer/src/config.js`. Last tunnel: `https://stereo-chen-varieties-rocks.trycloudflare.com`. Restart dev after any Prisma migration (the dev server caches the Prisma client).
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
| DB | Prisma + SQLite (`prisma/dev.sqlite`), only `Session` model so far |
| Admin API version | `July26` (`app/shopify.server.js`) |
| Dev store | `gruns-dev-store.myshopify.com` |
| GitHub | `https://github.com/UribeJr/ai-checkout-upsell` (private, branch `main`) |
| Scopes | `write_products,write_metaobjects,write_metaobject_definitions` |

**Commands**
- `npm run dev` (= `shopify app dev`): starts the app + tunnel and injects `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`
- Dev Console (CLI 4.9.4): open `<tunnel URL>/extensions/dev-console` in the browser, then use the extension's post-purchase checkout link. Pressing `p` in the terminal opens the embedded app preview, NOT the Dev Console (the tutorial's `p` instruction is outdated for this CLI).
- **Post-purchase preview link (use this, not a normal storefront checkout):** `<tunnel URL>/extensions/dev-<extension uid>/purchase.post.render`. It redirects to `https://gruns-dev-store.myshopify.com/cart/<variant>:1?script_url=...&post_purchase_dev_api_key=...&uuid=...&socket_url=...`. Those query params are what make checkout load the local extension; a normal storefront checkout skips the post-purchase page. Extension uid is in `shopify.extension.toml`. Extension status can be checked with `curl <tunnel URL>/extensions`.
- `npm run lint`

**Env vars (names only; set in your shell or a gitignored `.env`)**
- `OFFER_VARIANT_ID`: numeric variant ID of the product to offer (product B). Find it in Admin > Products > product > variant (the number at the end of the URL) or via GraphiQL. Do not invent one.
- `OFFER_DISCOUNT_PERCENT`: server-side discount policy, default `15`

**Dev store test products (looked up 2026-10-30 via `shopify store execute`, read-only):**
| Role | Product | Variant ID | Price | Notes |
|---|---|---|---|---|
| A (purchase) | The Inventory Not Tracked Snowboard | `68349213376735` | $949.95 | CLI's default preview cart already uses it |
| B (offer) | Selling Plans Ski Wax, variant "Selling Plans Ski Wax" | `68349213540575` | $24.95 | `requiresSellingPlan: false`, 0 selling plan groups, so it can be bought one-time. Natural snowboard complement. |
| Negative test (Slice 4) | The Out of Stock Snowboard | `68349213442271` | $885.95 | `availableForSale: false`, should produce no offer |

CLI access: `shopify store auth --store gruns-dev-store.myshopify.com --scopes read_products,read_inventory,write_inventory,read_locations` (done; dev store only), then `shopify store execute --store gruns-dev-store.myshopify.com --query '...'`.

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
| Pocket Travel Tin | `15478588932319` | Silver `68350167810271` ($9.99) |
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
| `app/services/offer.server.js` | Phase 1 hardcoded offer from env vars; Admin GraphQL variant lookup; returns null when not configured, already purchased, or unavailable |
| `app/services/post-purchase-auth.server.js` | Reads `shop` (`input_data.shop.domain`), `referenceId` and the purchased variant IDs (`input_data.initialPurchase.lineItems`) from the verified token |
| `app/routes/api.sign-changeset.jsx` | Accept endpoint: verifies the token, requires body `referenceId` to match the token's, re-runs `getOffer` (fresh eligibility check), signs the server-built changes |
| `app/services/changeset.server.js` | `signChangeset()`: JWT `{ iss, jti, iat, sub, changes }` signed with `SHOPIFY_API_SECRET` (tutorial format) |
| `package.json` | Added `jsonwebtoken` ^9.0.3 |
| `.eslintrc.cjs` | Turned off `react/prop-types` (plain JS project without PropTypes) |
| `.env` (gitignored, not committed) | `OFFER_VARIANT_ID=68349213540575`, `OFFER_DISCOUNT_PERCENT=15` |

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
- 2026-10-30: Extension waits at most 4s (`BACKEND_TIMEOUT_MS`, our own choice; Shopify publishes no limit) for each backend call, then skips the offer or continues to the thank-you page.
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

## 6. Open questions and risks

- Loom/README talking points from the Slice 3 test: the upsell ships as a second shipment (fulfillment cost/margin impact) and is a second card charge. The dev store charges $0 shipping/tax, so add a small tax or shipping rate if the demo should show `calculateChangeset` doing real work.
- The deployed app version (`ai-checkout-upsell-2`) still contains the template extension. Redeploy (with a reachable backend URL) before demoing a normal checkout.

- Testing tip: `authenticate.public.checkout` returns **410** to bot user agents, and `curl` counts as a bot. Use a browser UA (`curl -A "Mozilla/5.0 ..."`) when smoke-testing `/api/*` routes.

- Documented platform limitations to mention in README/Loom: third-party pixels report only the initial purchase (not the upsell); ScriptTag/additional scripts on the order status page get incomplete data; no post-purchase page for wallets, gift cards, installments, duties/multi-currency orders. Our own event tracking (Phase 4) covers the measurement gap.

- **Deployed app config has `application_url = https://example.com`** (scaffold default in `shopify.app.toml`, released by `shopify app deploy` because `include_config_on_deploy = true`). While `shopify app dev` runs, the dev session overrides it; without dev, the embedded admin app won't load. Before the final demo deploy we need a hosted backend URL (or a stable tunnel) in `shopify.app.toml` and in the extension's `APP_URL`.

- The post-purchase page not appearing is often store config (gateway, wallet payment, app not selected as post-purchase app), not a code bug.
- Tunnel URL must be updated in the extension config each dev run. A stable `--tunnel-url` would remove this step later.
- CLI 4.x template file names may differ from the tutorial's `src/index.jsx`. Check what is generated before editing.
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
