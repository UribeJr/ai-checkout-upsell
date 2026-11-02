import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { toProductDetail } from "../services/catalog/product-detail";
import { MIN_SCORE } from "../services/offers/candidate-ranking";

// One product's intelligence: what the AI read, what it concluded, and its
// relationships in both directions. Read-only: no AI calls, no writes.
// URL: /app/intelligence/<numeric product ID>. The "_" in the file name keeps
// it a page of its own instead of nesting it inside the list page.

const STATUS_TONES = {
  PENDING: "info",
  PROCESSING: "info",
  ENRICHED: "success",
  FAILED: "critical",
};

const PROFILE_LABELS = {
  CURRENT: { tone: "success", text: "Profile current" },
  OUT_OF_DATE: { tone: "caution", text: "Profile out of date: content changed since the last AI run" },
  NOT_ENRICHED: { tone: "neutral", text: "Not enriched yet" },
};

const SKIP_LABELS = {
  upgrade: "Never offered: upgrade",
  below_min_score: `Never offered: score below ${MIN_SCORE}`,
};

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const productId = `gid://shopify/Product/${params.productId}`;

  const row = await prisma.productIntelligence.findUnique({
    where: { shop_productId: { shop, productId } },
  });
  if (!row) throw new Response("Product not found", { status: 404 });

  const [outgoing, incoming, products] = await Promise.all([
    prisma.productRelationship.findMany({ where: { shop, sourceProductId: productId } }),
    prisma.productRelationship.findMany({ where: { shop, targetProductId: productId } }),
    prisma.productIntelligence.findMany({ where: { shop }, select: { productId: true, title: true } }),
  ]);
  const titles = Object.fromEntries(products.map((p) => [p.productId, p.title]));

  return toProductDetail(row, { outgoing, incoming, titles });
};

const formatDate = (iso) =>
  iso ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "—";

function List({ items, empty = "None" }) {
  if (!items.length) return <s-paragraph>{empty}</s-paragraph>;
  return (
    <s-unordered-list>
      {items.map((item) => (
        <s-list-item key={item}>{item}</s-list-item>
      ))}
    </s-unordered-list>
  );
}

export default function ProductDetail() {
  const product = useLoaderData();
  const { read, profile } = product;
  const profileLabel = PROFILE_LABELS[product.profileState];

  return (
    <s-page heading={product.title}>
      <s-link slot="breadcrumb-actions" href="/app/intelligence">
        Product intelligence
      </s-link>
      <s-button slot="secondary-actions" href={`/app/preview?products=${product.numericId}`}>
        Preview this product&apos;s offer
      </s-button>

      <s-section>
        <s-stack gap="small-200">
          <s-stack direction="inline" gap="small-200">
            {product.retired ? (
              <s-badge tone="neutral">Retired</s-badge>
            ) : (
              <s-badge>{product.status}</s-badge>
            )}
            <s-badge tone={STATUS_TONES[product.enrichmentStatus] ?? "neutral"}>
              {product.enrichmentStatus}
            </s-badge>
            <s-badge tone={profileLabel.tone}>{profileLabel.text}</s-badge>
          </s-stack>
          {product.retired && (
            <s-banner tone="info">
              Retired: archived, deleted or not in the upsell catalog. It can&apos;t be offered, and
              its relationships were removed. If it comes back, it gets a new AI run.
            </s-banner>
          )}
          {product.lastError && (
            <s-banner tone="critical">
              Last AI error (attempt {product.attempts}): {product.lastError}
            </s-banner>
          )}
        </s-stack>
      </s-section>

      <s-section heading="What the AI read">
        <s-stack gap="base">
          <s-paragraph>{read.description || "No description."}</s-paragraph>
          <s-paragraph>
            Type: {read.productType || "—"} · Tags: {read.tags.join(", ") || "—"} · Variants:{" "}
            {read.variants.join(", ") || "—"}
          </s-paragraph>
          <s-stack gap="small-200">
            <s-heading>Verified facts (merchant-approved)</s-heading>
            {read.verifiedFacts.length ? (
              <s-ordered-list>
                {read.verifiedFacts.map((fact) => (
                  <s-list-item key={fact}>{fact}</s-list-item>
                ))}
              </s-ordered-list>
            ) : (
              <s-paragraph>No verified facts: offers for this product use template copy.</s-paragraph>
            )}
            <s-text color="subdued">
              Fact 1 is the description line when an offer for this product falls back to template copy.
            </s-text>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="What the AI concluded">
        <s-stack gap="base">
          <s-paragraph>
            Category: <s-text type="strong">{profile.category ?? "—"}</s-text> · Format:{" "}
            <s-text type="strong">{profile.format ?? "—"}</s-text>
          </s-paragraph>
          <s-stack gap="small-200">
            <s-heading>Attributes</s-heading>
            <List items={profile.attributes.map((a) => `${a.name}: ${a.value}`)} />
          </s-stack>
          <s-stack gap="small-200">
            <s-heading>Use cases</s-heading>
            <List items={profile.useCases} />
          </s-stack>
          <s-stack gap="small-200">
            <s-heading>Cross-sell angles</s-heading>
            <List items={profile.crossSellAngles} />
          </s-stack>
          <s-stack gap="small-200">
            <s-heading>Verified facts the AI cited</s-heading>
            <List items={profile.factRefs} />
          </s-stack>
          <s-text color="subdued">
            Model {profile.modelName ?? "—"} · {profile.enrichmentVersion ?? "—"} · enriched{" "}
            {formatDate(profile.enrichedAt)}. The AI profile lives in the app database and is never
            written back to Shopify.
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading={`Offers after buying this product (${product.outgoing.length})`}>
        {product.outgoing.length === 0 ? (
          <s-paragraph>
            No relationships. They are generated by AI after the product is enriched, and removed
            when it&apos;s retired.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Offer</s-table-header>
              <s-table-header>Type</s-table-header>
              <s-table-header format="numeric">Score</s-table-header>
              <s-table-header>Offer copy (AI)</s-table-header>
              <s-table-header>Facts cited</s-table-header>
              <s-table-header>Reasoning (AI)</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {product.outgoing.map((edge) => (
                <s-table-row key={edge.id}>
                  <s-table-cell>
                    <s-stack gap="small-300">
                      <s-link href={`/app/intelligence/${edge.numericId}`}>{edge.title}</s-link>
                      {edge.skipReason && <s-badge tone="neutral">{SKIP_LABELS[edge.skipReason]}</s-badge>}
                    </s-stack>
                  </s-table-cell>
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
                  <s-table-cell>{edge.factRefs.join(" · ") || "—"}</s-table-cell>
                  <s-table-cell>{edge.reasoning}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading={`Offered after buying (${product.incoming.length})`}>
        {product.incoming.length === 0 ? (
          <s-paragraph>No other product points at this one.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Bought</s-table-header>
              <s-table-header>Type</s-table-header>
              <s-table-header format="numeric">Score</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {product.incoming.map((edge) => (
                <s-table-row key={edge.id}>
                  <s-table-cell>
                    <s-stack gap="small-300">
                      <s-link href={`/app/intelligence/${edge.numericId}`}>{edge.title}</s-link>
                      {edge.skipReason && <s-badge tone="neutral">{SKIP_LABELS[edge.skipReason]}</s-badge>}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{edge.type}</s-table-cell>
                  <s-table-cell>{edge.score.toFixed(2)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="About this page">
        <s-paragraph>
          Read-only. The verified facts come from the product&apos;s custom.verified_facts metafield;
          everything under &quot;What the AI concluded&quot; and the relationships were produced by AI
          offline and validated before saving.
        </s-paragraph>
        <s-paragraph>
          Scores rank relevance; they are not conversion probabilities. Checkout also checks stock
          and the price cap live before offering anything.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
