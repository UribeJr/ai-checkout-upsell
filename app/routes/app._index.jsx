import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return null;
};

export default function Index() {
  return (
    <s-page heading="AI post-purchase upsell">
      <s-section heading="What this app does">
        <s-paragraph>
          After a buyer pays, this app shows one relevant add-on offer on the
          post-purchase page. If the buyer accepts, the product is added to the
          same order and Shopify charges only the difference.
        </s-paragraph>
        <s-unordered-list>
          <s-list-item>
            Product intelligence is built ahead of checkout from your catalog
            and its verified facts (<s-text>custom.verified_facts</s-text>).
          </s-list-item>
          <s-list-item>
            At checkout, eligible candidates are filtered by fixed rules, and AI
            picks one and writes copy grounded in those facts.
          </s-list-item>
          <s-list-item>
            Prices and discounts always come from Shopify and store policy,
            never from AI.
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
