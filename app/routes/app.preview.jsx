import { useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { fetchLiveProducts, findOffer } from "../services/offers/candidate-engine.server";

// Offer preview: build a basket and see which post-purchase offer the engine
// would choose, and why every other candidate wasn't chosen. Read-only: it
// runs the same decision as checkout (no AI calls, no writes).
//
// The basket lives in the URL (?products=<numeric product IDs>), so a preview
// can be reloaded or shared.

const toProductGid = (id) => `gid://shopify/Product/${id}`;
const numericId = (gid) => gid.split("/").pop();

const SKIP_LABELS = {
  upgrade: "Skipped: upgrade of a purchased item",
  purchased: "Skipped: already in the basket",
  below_min_score: "Skipped: score below the minimum",
  inactive: "Skipped: not active in Shopify",
  out_of_stock: "Skipped: out of stock",
  over_price_cap: "Skipped: above the price cap",
};

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const products = await prisma.productIntelligence.findMany({
    where: { shop, deletedAt: null },
    orderBy: { title: "asc" },
    select: { productId: true, title: true },
  });
  const titles = Object.fromEntries(products.map((p) => [p.productId, p.title]));

  const requested = new URL(request.url).searchParams.get("products") ?? "";
  const basketIds = [...new Set(requested.split(",").filter(Boolean).map(toProductGid))].filter(
    (id) => id in titles,
  );

  const page = { products, basket: [], subtotal: 0, currencyCode: null, decision: null, candidates: [] };
  if (basketIds.length === 0) return page;

  // Like a checkout of one unit of each basket product (first available variant).
  const { products: live, currencyCode } = await fetchLiveProducts(admin, basketIds);
  const basket = basketIds.map((productId) => {
    const variant = live.get(productId)?.variants.find((option) => option.availableForSale);
    return {
      productId,
      title: titles[productId],
      variantId: variant?.id ?? null,
      variantTitle: variant?.title ?? null,
      price: variant?.price ?? null,
    };
  });
  const subtotal =
    Math.round(basket.reduce((sum, line) => sum + (line.price ?? 0), 0) * 100) / 100;

  const decision = await findOffer({
    shop,
    admin,
    purchase: {
      productIds: basketIds,
      variantIds: basket.map((line) => line.variantId).filter(Boolean),
      subtotal,
    },
  });

  return {
    ...page,
    basket,
    subtotal,
    currencyCode,
    decision: {
      offer: decision.offer,
      policy: decision.policy,
      durationMs: decision.durationMs,
    },
    candidates: describeCandidates(decision, titles),
  };
};

// One row per candidate: ranked ones with their outcome, then relationships
// that were filtered out before ranking.
function describeCandidates({ offer, ranked, skipped }, titles) {
  const liveSkips = new Map(
    skipped.filter((entry) => !entry.relationship).map((entry) => [entry.productId, entry.reason]),
  );

  const rankedRows = ranked.map((candidate) => {
    const reason = liveSkips.get(candidate.productId);
    let status = "Eligible, ranked lower";
    if (offer?.productId === candidate.productId) status = "Offered";
    else if (reason) status = SKIP_LABELS[reason];

    return {
      key: candidate.productId,
      title: titles[candidate.productId] ?? candidate.productId,
      score: candidate.rankScore,
      type: candidate.relationship.type,
      via: candidate.sourceProductIds.map((id) => titles[id] ?? id).join(", "),
      status,
    };
  });

  const filteredRows = skipped
    .filter((entry) => entry.relationship)
    .map(({ relationship, reason }) => ({
      key: relationship.id,
      title: titles[relationship.targetProductId] ?? relationship.targetProductId,
      score: relationship.score,
      type: relationship.type,
      via: titles[relationship.sourceProductId] ?? relationship.sourceProductId,
      status: SKIP_LABELS[reason],
    }));

  return [...rankedRows, ...filteredRows];
}

function statusTone(status) {
  if (status === "Offered") return "success";
  if (status.startsWith("Skipped")) return "neutral";
  return "info";
}

export default function OfferPreview() {
  const { products, basket, subtotal, currencyCode, decision, candidates } = useLoaderData();
  const navigate = useNavigate();

  const money = (amount) =>
    amount === null
      ? "unavailable"
      : new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode ?? "USD" }).format(amount);

  const basketIds = basket.map((line) => line.productId);
  const setBasket = (ids) =>
    navigate(ids.length ? `?products=${ids.map(numericId).join(",")}` : "?");

  const offer = decision?.offer;

  return (
    <s-page heading="Offer preview">
      <s-section heading="Basket">
        {basket.length === 0 ? (
          <s-paragraph>
            Add products below to see which post-purchase offer a buyer of
            that basket would get.
          </s-paragraph>
        ) : (
          <s-stack gap="base">
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Product</s-table-header>
                <s-table-header>Variant</s-table-header>
                <s-table-header format="numeric">Price</s-table-header>
                <s-table-header></s-table-header>
              </s-table-header-row>
              <s-table-body>
                {basket.map((line) => (
                  <s-table-row key={line.productId}>
                    <s-table-cell>{line.title}</s-table-cell>
                    <s-table-cell>{line.variantTitle ?? "—"}</s-table-cell>
                    <s-table-cell>{money(line.price)}</s-table-cell>
                    <s-table-cell>
                      <s-button
                        variant="tertiary"
                        onClick={() => setBasket(basketIds.filter((id) => id !== line.productId))}
                      >
                        Remove
                      </s-button>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
            <s-paragraph>Subtotal: {money(subtotal)}</s-paragraph>
          </s-stack>
        )}
      </s-section>

      {decision && (
        <s-section heading="Offer the buyer would see">
          {offer ? (
            <s-stack gap="small-200">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text type="strong">{offer.headline}</s-text>
                <s-badge tone={offer.copySource === "AI_COPY" ? "success" : "caution"}>
                  {offer.copySource === "AI_COPY" ? "AI copy" : "Template copy"}
                </s-badge>
              </s-stack>
              {offer.description && <s-paragraph>{offer.description}</s-paragraph>}
              <s-paragraph>
                {offer.productTitle}
                {offer.variantTitle && offer.variantTitle !== "Default Title" ? ` (${offer.variantTitle})` : ""}
                {" · "}
                {money(offer.price)}
                {offer.discountPercent > 0 ? ` before ${offer.discountPercent}% off` : ", no discount"} (Shopify
                calculates the final price)
              </s-paragraph>
              <s-paragraph>
                Rank score {offer.rankScore.toFixed(2)} · {offer.relationshipType}
              </s-paragraph>
            </s-stack>
          ) : (
            <s-banner tone="info">
              No offer: no related product passed the rules. The buyer goes
              straight to the thank-you page.
            </s-banner>
          )}
        </s-section>
      )}

      {decision && (
        <s-section heading={`Candidates (${candidates.length})`}>
          {candidates.length === 0 ? (
            <s-paragraph>No stored relationships for these products.</s-paragraph>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Product</s-table-header>
                <s-table-header format="numeric">Score</s-table-header>
                <s-table-header>Type</s-table-header>
                <s-table-header>Because of</s-table-header>
                <s-table-header>Result</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {candidates.map((row) => (
                  <s-table-row key={row.key}>
                    <s-table-cell>{row.title}</s-table-cell>
                    <s-table-cell>{row.score.toFixed(2)}</s-table-cell>
                    <s-table-cell>{row.type}</s-table-cell>
                    <s-table-cell>{row.via}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={statusTone(row.status)}>{row.status}</s-badge>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-section>
      )}

      <s-section heading="Products">
        {products.length === 0 ? (
          <s-paragraph>No products synced yet. Run Sync catalog on Product intelligence.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Product</s-table-header>
              <s-table-header></s-table-header>
            </s-table-header-row>
            <s-table-body>
              {products.map((product) => (
                <s-table-row key={product.productId}>
                  <s-table-cell>{product.title}</s-table-cell>
                  <s-table-cell>
                    <s-button
                      variant="tertiary"
                      disabled={basketIds.includes(product.productId)}
                      onClick={() => setBasket([...basketIds, product.productId])}
                    >
                      Add to basket
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      {decision && (
        <s-section slot="aside" heading="Policy">
          <s-paragraph>Minimum score: {decision.policy.minScore}</s-paragraph>
          <s-paragraph>
            Price cap: {decision.policy.maxOrderRatio}× subtotal ={" "}
            {money(decision.policy.maxOrderRatio * subtotal)}
          </s-paragraph>
          <s-paragraph>Discount: {decision.policy.discountPercent}%</s-paragraph>
          <s-paragraph>Decision time: {decision.durationMs} ms (no AI call)</s-paragraph>
        </s-section>
      )}
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
