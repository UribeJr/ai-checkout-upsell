import { useEffect } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncCatalog } from "../services/catalog/product-sync.server";
import { getSettings } from "../services/settings.server";
import {
  isQueueRunning,
  reEnrichAll,
  startQueue,
} from "../services/catalog/enrichment-queue.server";

// Status page for product intelligence: what the app knows about each
// product, and buttons to run the background steps by hand.
export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const [products, relationships, settings] = await Promise.all([
    prisma.productIntelligence.findMany({
      where: { shop },
      orderBy: [{ deletedAt: "asc" }, { title: "asc" }],
      include: { _count: { select: { outgoing: true } } },
    }),
    prisma.productRelationship.findMany({
      where: { shop },
      orderBy: [{ sourceProductId: "asc" }, { score: "desc" }],
    }),
    getSettings(shop),
  ]);

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

  const titles = Object.fromEntries(products.map((p) => [p.productId, p.title]));

  return {
    grantedScopes: data.currentAppInstallation.accessScopes.map((scope) => scope.handle),
    upsellTag: settings.upsellTag,
    queueRunning: isQueueRunning(shop),
    products: products.map((product) => ({
      id: product.id,
      title: product.title,
      status: product.status,
      retired: product.deletedAt !== null,
      factCount: JSON.parse(product.snapshot).verifiedFacts.length,
      category: product.category,
      enrichmentStatus: product.enrichmentStatus,
      lastError: product.lastError,
      relationshipCount: product._count.outgoing,
      syncedAt: product.syncedAt.toISOString(),
    })),
    relationships: relationships.map((edge) => ({
      id: edge.id,
      source: titles[edge.sourceProductId] ?? edge.sourceProductId,
      target: titles[edge.targetProductId] ?? edge.targetProductId,
      type: edge.type,
      score: edge.score,
      reasoning: edge.reasoning,
      headline: edge.headline,
      description: edge.description,
    })),
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const intent = (await request.formData()).get("intent");

  if (intent === "sync") {
    const counts = await syncCatalog({ shop: session.shop, admin });
    return { intent, message: `Synced: ${counts.created} new, ${counts.changed} changed, ${counts.unchanged} unchanged, ${counts.removed} retired` };
  }
  // AI work runs in the background; the page refreshes until it's done.
  if (intent === "process") {
    startQueue(session.shop);
    return { intent, message: "Enrichment started" };
  }
  if (intent === "reenrich") {
    await reEnrichAll(session.shop);
    return { intent, message: "Re-enrichment of all products started" };
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
  const { grantedScopes, upsellTag, queueRunning, products, relationships } = useLoaderData();
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();

  const busyIntent = fetcher.state !== "idle" ? fetcher.formData?.get("intent") : null;
  const working = queueRunning || products.some((p) => p.enrichmentStatus === "PROCESSING");

  useEffect(() => {
    if (fetcher.data?.message) shopify.toast.show(fetcher.data.message);
  }, [fetcher.data, shopify]);

  // Poll while the background run is going so statuses update live.
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => revalidator.revalidate(), 3000);
    return () => clearInterval(timer);
  }, [working, revalidator]);

  const run = (intent) => fetcher.submit({ intent }, { method: "POST" });
  const loadingProps = (intent) => (busyIntent === intent ? { loading: true } : {});

  return (
    <s-page heading="Product intelligence">
      <s-button slot="primary-action" onClick={() => run("sync")} {...loadingProps("sync")}>
        Sync catalog
      </s-button>
      <s-button
        slot="secondary-actions"
        onClick={() => run("process")}
        disabled={working}
        {...loadingProps("process")}
      >
        Process queue
      </s-button>
      <s-button
        slot="secondary-actions"
        onClick={() => run("reenrich")}
        disabled={working}
        {...loadingProps("reenrich")}
      >
        Re-enrich all
      </s-button>

      {working && (
        <s-banner tone="info">AI enrichment is running. This page updates automatically.</s-banner>
      )}

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
              <s-table-header>Category (AI)</s-table-header>
              <s-table-header format="numeric">Relationships</s-table-header>
              <s-table-header>Last error</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {products.map((product) => (
                <s-table-row key={product.id}>
                  <s-table-cell>{product.title}</s-table-cell>
                  <s-table-cell>
                    {product.retired ? <s-badge tone="neutral">Retired</s-badge> : product.status}
                  </s-table-cell>
                  <s-table-cell>{product.factCount}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={STATUS_TONES[product.enrichmentStatus] ?? "neutral"}>
                      {product.enrichmentStatus}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{product.category ?? "—"}</s-table-cell>
                  <s-table-cell>{product.relationshipCount}</s-table-cell>
                  <s-table-cell>{product.lastError ?? ""}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading={`Relationships (${relationships.length})`}>
        {relationships.length === 0 ? (
          <s-paragraph>
            No relationships yet. They are generated by AI after products are
            enriched (<s-text>Process queue</s-text>).
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Bought</s-table-header>
              <s-table-header>Offer</s-table-header>
              <s-table-header>Type</s-table-header>
              <s-table-header format="numeric">Score</s-table-header>
              <s-table-header>Offer copy (AI)</s-table-header>
              <s-table-header>Reasoning (AI)</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {relationships.map((edge) => (
                <s-table-row key={edge.id}>
                  <s-table-cell>{edge.source}</s-table-cell>
                  <s-table-cell>{edge.target}</s-table-cell>
                  <s-table-cell>{edge.type}</s-table-cell>
                  <s-table-cell>{edge.score.toFixed(2)}</s-table-cell>
                  <s-table-cell>
                    {edge.headline ? (
                      <s-text>
                        <strong>{edge.headline}</strong> {edge.description}
                      </s-text>
                    ) : (
                      <s-badge tone="caution">Template</s-badge>
                    )}
                  </s-table-cell>
                  <s-table-cell>{edge.reasoning}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="Upsell catalog">
        <s-paragraph>
          {upsellTag ? (
            <>
              Products tagged <s-text type="strong">{upsellTag}</s-text>.
            </>
          ) : (
            "All active products."
          )}{" "}
          <s-link href="/app/settings">Change in Settings</s-link>
        </s-paragraph>
      </s-section>

      <s-section slot="aside" heading="Access">
        <s-paragraph>
          Scopes granted by Shopify: <s-text>{grantedScopes.join(", ") || "none"}</s-text>
        </s-paragraph>
        <s-paragraph>
          The app only reads products. Verified facts are written by the
          merchant; the AI profile and relationships live in the app database.
          Scores rank relevance; they are not conversion probabilities.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
