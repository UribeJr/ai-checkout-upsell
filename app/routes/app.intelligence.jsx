import { useEffect } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncCatalog } from "../services/catalog/product-sync.server";

// Status page for product intelligence: what the app knows about each
// product, and buttons to run the background steps by hand.
export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const products = await prisma.productIntelligence.findMany({
    where: { shop: session.shop },
    orderBy: [{ deletedAt: "asc" }, { title: "asc" }],
    include: { _count: { select: { outgoing: true } } },
  });

  // What Shopify has actually granted this app, not what we last requested.
  const scopesResponse = await admin.graphql(`#graphql
    query GrantedScopes {
      currentAppInstallation {
        accessScopes {
          handle
        }
      }
    }`);
  const { data } = await scopesResponse.json();

  return {
    grantedScopes: data.currentAppInstallation.accessScopes.map((scope) => scope.handle),
    products: products.map((product) => ({
      id: product.id,
      title: product.title,
      status: product.status,
      retired: product.deletedAt !== null,
      factCount: JSON.parse(product.snapshot).verifiedFacts.length,
      enrichmentStatus: product.enrichmentStatus,
      relationshipCount: product._count.outgoing,
      syncedAt: product.syncedAt.toISOString(),
    })),
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  if (formData.get("intent") === "sync") {
    const counts = await syncCatalog({ shop: session.shop, admin });
    return { intent: "sync", counts };
  }

  return new Response("Unknown intent", { status: 400 });
};

const STATUS_TONES = {
  PENDING: "info",
  PROCESSING: "info",
  ENRICHED: "success",
  FAILED: "critical",
};

export default function Intelligence() {
  const { grantedScopes, products } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const isSyncing = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "sync";

  useEffect(() => {
    const counts = fetcher.data?.counts;
    if (counts) {
      shopify.toast.show(
        `Synced: ${counts.created} new, ${counts.changed} changed, ${counts.unchanged} unchanged, ${counts.removed} retired`,
      );
    }
  }, [fetcher.data, shopify]);

  const sync = () => fetcher.submit({ intent: "sync" }, { method: "POST" });

  return (
    <s-page heading="Product intelligence">
      <s-button
        slot="primary-action"
        onClick={sync}
        {...(isSyncing ? { loading: true } : {})}
      >
        Sync catalog
      </s-button>

      <s-section heading={`Products (${products.length})`}>
        {products.length === 0 ? (
          <s-paragraph>
            No products synced yet. Run <s-text>Sync catalog</s-text> to read
            the ACTIVE products and their verified facts from Shopify.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Product</s-table-header>
              <s-table-header>Shopify status</s-table-header>
              <s-table-header format="numeric">Verified facts</s-table-header>
              <s-table-header>Intelligence</s-table-header>
              <s-table-header format="numeric">Relationships</s-table-header>
              <s-table-header>Last synced</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {products.map((product) => (
                <s-table-row key={product.id}>
                  <s-table-cell>{product.title}</s-table-cell>
                  <s-table-cell>
                    {product.retired ? (
                      <s-badge tone="neutral">Retired</s-badge>
                    ) : (
                      product.status
                    )}
                  </s-table-cell>
                  <s-table-cell>{product.factCount}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={STATUS_TONES[product.enrichmentStatus] ?? "neutral"}>
                      {product.enrichmentStatus}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{product.relationshipCount}</s-table-cell>
                  <s-table-cell>{new Date(product.syncedAt).toLocaleString()}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="Access">
        <s-paragraph>
          Scopes granted by Shopify: <s-text>{grantedScopes.join(", ") || "none"}</s-text>
        </s-paragraph>
        <s-paragraph>
          The app only reads products. Verified facts are written by the
          merchant; the AI profile lives in the app database.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
