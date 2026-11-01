# Writing verified facts

For whoever fills in product details in Shopify Admin. The **Verified facts** field (`custom.verified_facts`) is the only source the AI may quote when it writes an offer to a buyer, so what you put here decides what buyers read.

## What the field does

- **The AI may only state these facts.** When it writes offer copy ("Give your pouch a glass home…"), it must cite facts from the **product being offered**, copied word for word. Copy that cites anything else is thrown out.
- **The first fact can reach buyers unedited.** If AI copy isn't available for an offer, checkout shows "Add {product} to your order" with **fact #1 as the description, exactly as written**. Put the strongest stand-alone fact first.
- **The AI also reads the facts to understand the product,** which shapes which products it pairs together.
- **Changing a fact starts a new AI run** (or queues one, if automatic AI updates are off in Settings). Until that run finishes, any offer copy that cited the old wording falls back to the plain template.

## What makes a good fact

One fact per entry. Each should be:

| Rule | Good | Avoid |
|---|---|---|
| **Specific and checkable**: something you could show on the label, packaging or spec sheet | `56 gummies per pouch` | `Plenty of gummies` |
| **About this product** | `Holds one 28-Day Pouch of gummies` | `Our customers love it` |
| **Plain and short**: one line that reads at a glance | `Leak-resistant screw lid` | A full marketing paragraph |
| **Neutral wording**: the AI writes the pitch, the fact supplies the truth | `Resealable pouch` | `The best pouch you'll ever own!` |
| **Stable**: something that won't change next month | `Stainless steel body` | `Back in stock this week` |

The demo catalog's facts follow these rules. See [`scripts/demo-catalog.json`](../scripts/demo-catalog.json) for 10 complete examples, such as:

> Stainless Shaker Bottle, 20 oz: `20 oz capacity` · `Stainless steel body` · `Includes a stainless mixing ball` · `Leak-resistant screw lid`

## Never put these in a fact

**Health, medical or efficacy claims.** Leave out anything about what the product does to the body: no "supports immunity", "aids digestion", "boosts energy", "clinically proven". The app blocks AI copy that contains this kind of wording. Fact #1 is shown unchecked in template copy, though, so a claim there would reach buyers. Facts should already be approved through your brand's normal product-claims review.

**Prices, discounts and promotions.** Prices and the offer discount always come from Shopify and store settings. A fact that mentions them would be out of date as soon as the price changes.

## Words that block AI copy

The app rejects AI copy that contains any of the words below, so the AI can't use a fact that contains them. It isn't an error, but the offer gets plain template copy instead.

| Blocked because it sounds like… | Words and symbols |
|---|---|
| Price or discount | `$` `€` `£` `¥` `%` discount, save, savings, sale, deal, **free**, **off**, price, cost, cheap |
| Health or medical claim | cure, treat, treatment, heal, prevent, disease, immune, immunity, detox, cleanse, weight loss, lose weight, burn fat, metabolism, boost, energize, clinically, doctor, medical, medicine, FDA, anxiety, stress relief, sleep better, gut health, digestion, inflammation, blood sugar, cholesterol, deficiency |

The common surprise is **"free"**: `Gluten-free`, `Sugar-free` and `BPA-free` all match it. If a fact like that matters for the pitch, reword it, for example `Made without gluten`, or accept template copy for that product. The same goes for `%`, as in `100% stainless steel`, and for `off`.

## Checklist before saving

- [ ] Every entry is one specific, checkable fact about this product.
- [ ] Fact #1 reads well on its own, as the only line under "Add {product} to your order".
- [ ] No health, medical or efficacy claims.
- [ ] No prices, discounts or promotions.
- [ ] Reworded any fact that uses a blocked word, if you want the AI to be able to use it.
- [ ] The wording matches what your claims review approved.

## Entering the facts

- **One product:** open the product in Shopify Admin and fill in **Verified facts** in its **Metafields** section. Each line is one fact.
- **Many products:** select them in the product list and use Shopify's [bulk editor](https://help.shopify.com/en/manual/custom-data/metafields/bulk-edit-metafields) with the Verified facts column.
- **Shopify Sidekick:** fine for **drafting**, for example "suggest one-line factual specs for this product from its description and label." Shopify's Sidekick docs say it can create and edit products and drafts every change for your review, but they don't say it can edit product metafields. Test it on a development store before relying on it.

Whatever tool fills in the field, a person must check every line against the label or spec sheet, and it must go through your claims review. These facts are the guardrail on the checkout AI. If an AI writes them unchecked, nothing is verified anymore.

## How to check the result

1. Save the product, then wait for the AI update. Open **Product intelligence** and check that the product is enriched; if automatic updates are off, press **Run AI update** in Settings.
2. Open **Offer preview**, add a product this one is paired with, and read the offer. A **Template copy** badge means no AI copy passed the checks.
3. Products with no facts still get offers, but always with template copy and no description line.
