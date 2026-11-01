import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getOfferAnalytics } from "../services/analytics/metrics.server";
import { LOW_SAMPLE_IMPRESSIONS } from "../services/analytics/metrics";

// Analytics: how post-purchase offers perform, from stored decisions and
// offer events. Read-only.

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return getOfferAnalytics(session.shop);
};

const percent = (value) => (value == null ? "—" : `${Math.round(value * 1000) / 10}%`);
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export default function Analytics() {
  const { totals, topOffers, recent, currencyCode } = useLoaderData();

  const money = (amount) =>
    amount == null
      ? "—"
      : new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode ?? "USD" }).format(amount);

  const tiles = [
    ["Offers shown", totals.impressions],
    ["Conversion", percent(totals.conversion)],
    ["Attributed revenue", money(totals.revenue)],
    ["Revenue per offer shown", money(totals.revenuePerImpression)],
    ["Accepted", totals.accepted],
    ["Declined", totals.declined],
  ];

  return (
    <s-page heading="Analytics">
      <s-section heading="Summary">
        <s-stack gap="base">
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
            {tiles.map(([label, value]) => (
              <s-box key={label} padding="base" border="base" borderRadius="base">
                <s-stack gap="small-200">
                  <s-text color="subdued">{label}</s-text>
                  <s-heading>{value}</s-heading>
                </s-stack>
              </s-box>
            ))}
          </s-grid>
          <s-paragraph>
            {count(totals.checkouts, "checkout", "checkouts")} reached the post-purchase step;{" "}
            {totals.offersDecided} had an offer to show.{" "}
            {count(totals.applied, "offer was", "offers were")} added to orders
            {totals.applyFailed ? `, ${totals.applyFailed} could not be applied` : ""}.
          </s-paragraph>
          {totals.offersDecided > totals.impressions && (
            <s-paragraph>
              Offers decided but never shown include checkouts from before event
              tracking started and buyers who left before the offer page loaded.
            </s-paragraph>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Top offers">
        {topOffers.length === 0 ? (
          <s-paragraph>No offers yet. Complete a test checkout to see results here.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Offer</s-table-header>
              <s-table-header format="numeric">Shown</s-table-header>
              <s-table-header format="numeric">Added</s-table-header>
              <s-table-header format="numeric">Conversion</s-table-header>
              <s-table-header format="numeric">Revenue</s-table-header>
              <s-table-header format="numeric">Per offer shown</s-table-header>
              <s-table-header></s-table-header>
            </s-table-header-row>
            <s-table-body>
              {topOffers.map((offer) => (
                <s-table-row key={offer.productId}>
                  <s-table-cell>{offer.title}</s-table-cell>
                  <s-table-cell>{offer.impressions}</s-table-cell>
                  <s-table-cell>{offer.applied}</s-table-cell>
                  <s-table-cell>{percent(offer.conversion)}</s-table-cell>
                  <s-table-cell>{money(offer.revenue)}</s-table-cell>
                  <s-table-cell>{money(offer.revenuePerImpression)}</s-table-cell>
                  <s-table-cell>
                    {offer.lowSample && <s-badge tone="caution">Low sample</s-badge>}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="Recent checkouts">
        {recent.length === 0 ? (
          <s-paragraph>No checkouts yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Basket</s-table-header>
              <s-table-header>Offer</s-table-header>
              <s-table-header>Copy</s-table-header>
              <s-table-header>Events</s-table-header>
              <s-table-header format="numeric">Revenue</s-table-header>
              <s-table-header>Time</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {recent.map((row) => (
                <s-table-row key={row.id}>
                  <s-table-cell>{row.basket}</s-table-cell>
                  <s-table-cell>{row.offer ?? "No offer"}</s-table-cell>
                  <s-table-cell>{row.source}</s-table-cell>
                  <s-table-cell>{row.events.length ? row.events.join(" → ") : "—"}</s-table-cell>
                  <s-table-cell>{money(row.revenue)}</s-table-cell>
                  <s-table-cell>{new Date(row.createdAt).toLocaleString()}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="Definitions">
        <s-paragraph>
          <s-text type="strong">Offer shown:</s-text> the offer page appeared with
          Shopify-calculated prices.
        </s-paragraph>
        <s-paragraph>
          <s-text type="strong">Conversion:</s-text> offers added to the order ÷ offers shown.
        </s-paragraph>
        <s-paragraph>
          <s-text type="strong">Attributed revenue:</s-text> the added items after discount,
          before shipping and tax. It is not proven incremental (that needs a holdout
          group), and refunds are not subtracted.
        </s-paragraph>
        <s-paragraph>
          <s-text type="strong">Low sample:</s-text> fewer than {LOW_SAMPLE_IMPRESSIONS} offers
          shown, so the rates can change a lot.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
