import { useEffect, useRef } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getSettings, updateSettings } from "../services/settings.server";
import { isQueueRunning, startQueue } from "../services/catalog/enrichment-queue.server";
import { syncCatalog } from "../services/catalog/product-sync.server";
import { normalizeTag } from "../services/catalog/catalog-scope";
import { DISCOUNT_RANGE, PRICE_CAP_RANGE, normalizeOfferPolicyInput } from "../services/offers/offer-policy";
import { getOfferPolicy, getOfferPolicyDefaults } from "../services/offers/candidate-engine.server";

// Settings: the offer policy (discount, price cap), which products are in the
// upsell catalog (optional tag), whether
// product changes start AI enrichment automatically, and a button to run it by
// hand. Manual mode lets the merchant decide when AI cost happens; one run
// covers every change recorded since the last one.
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [settings, offerPolicy, inCatalog, waiting, failed, lastRun] = await Promise.all([
    getSettings(shop),
    getOfferPolicy(shop),
    prisma.productIntelligence.count({ where: { shop, deletedAt: null } }),
    prisma.productIntelligence.count({
      where: { shop, deletedAt: null, enrichmentStatus: "PENDING" },
    }),
    prisma.productIntelligence.count({
      where: { shop, deletedAt: null, enrichmentStatus: "FAILED" },
    }),
    prisma.productIntelligence.aggregate({
      where: { shop, deletedAt: null },
      _max: { enrichedAt: true },
    }),
  ]);

  return {
    autoEnrich: settings.autoEnrich,
    upsellTag: settings.upsellTag,
    // The values in effect, and the ones saved here (null = env default).
    offerPolicy,
    savedPolicy: { discountPercent: settings.discountPercent, maxOrderRatio: settings.maxOrderRatio },
    policyDefaults: getOfferPolicyDefaults(),
    inCatalog,
    waiting,
    failed,
    lastEnrichedAt: lastRun._max.enrichedAt?.toISOString() ?? null,
    queueRunning: isQueueRunning(shop),
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "offerPolicy") {
    const { policy, errors } = normalizeOfferPolicyInput({
      discountPercent: formData.get("discountPercent"),
      maxOrderRatio: formData.get("maxOrderRatio"),
    });
    if (errors) return { policyErrors: errors, error: "Offer policy not saved; check the fields." };

    await updateSettings(session.shop, policy);
    return { message: "Offer policy saved; applies to new checkouts" };
  }

  if (intent === "upsellTag") {
    const { tag, error } = normalizeTag(formData.get("tag"));
    if (error) return { error, tagError: error };

    // Re-sync right away: products outside the new scope are retired (no AI
    // cost), products that came into it are queued for enrichment.
    await updateSettings(session.shop, { upsellTag: tag });
    const counts = await syncCatalog({ shop: session.shop, admin });
    const { autoEnrich } = await getSettings(session.shop);
    if (autoEnrich && counts.created + counts.changed > 0) startQueue(session.shop);

    const added = counts.created + counts.changed;
    return {
      message: `Upsell catalog updated: ${added} added or changed, ${counts.removed} removed`,
    };
  }

  if (intent === "autoEnrich") {
    const autoEnrich = formData.get("enabled") === "true";
    await updateSettings(session.shop, { autoEnrich });

    // Turning it back on catches up on anything that waited.
    if (autoEnrich) startQueue(session.shop);
    return { message: autoEnrich ? "Automatic AI updates on" : "Automatic AI updates off" };
  }
  if (intent === "run") {
    startQueue(session.shop);
    return { message: "AI update started" };
  }

  return new Response("Unknown intent", { status: 400 });
};

export default function Settings() {
  const {
    autoEnrich,
    upsellTag,
    offerPolicy,
    savedPolicy,
    policyDefaults,
    inCatalog,
    waiting,
    failed,
    lastEnrichedAt,
    queueRunning,
  } = useLoaderData();
  const fetcher = useFetcher();
  const tagField = useRef(null);
  const discountField = useRef(null);
  const capField = useRef(null);
  const revalidator = useRevalidator();
  const shopify = useAppBridge();

  // Show the new setting while the save is in flight.
  const pendingIntent = fetcher.formData?.get("intent");
  const autoEnrichShown =
    pendingIntent === "autoEnrich" ? fetcher.formData.get("enabled") === "true" : autoEnrich;
  const loadingProps = (intent) => (pendingIntent === intent ? { loading: true } : {});

  useEffect(() => {
    if (fetcher.data?.message) shopify.toast.show(fetcher.data.message);
    if (fetcher.data?.error) shopify.toast.show(fetcher.data.error, { isError: true });
  }, [fetcher.data, shopify]);

  // Poll while a run is going so the counts update live.
  useEffect(() => {
    if (!queueRunning) return;
    const timer = setInterval(() => revalidator.revalidate(), 3000);
    return () => clearInterval(timer);
  }, [queueRunning, revalidator]);

  // A button rather than <s-switch>: a controlled s-switch needs React 19
  // (Shopify's migration docs), and this app is on React 18.
  const toggleAutoEnrich = () =>
    fetcher.submit(
      { intent: "autoEnrich", enabled: String(!autoEnrichShown) },
      { method: "POST" },
    );

  // Empty fields save as "use the default".
  const savePolicy = () =>
    fetcher.submit(
      {
        intent: "offerPolicy",
        discountPercent: discountField.current?.value ?? "",
        maxOrderRatio: capField.current?.value ?? "",
      },
      { method: "POST" },
    );
  const sourceLabel = (field) =>
    offerPolicy.sources[field] === "settings" ? "saved here" : "default";
  const policyErrors = fetcher.data?.policyErrors ?? {};

  // The field keeps its own typed value; we read it when Save is pressed.
  const saveTag = () =>
    fetcher.submit({ intent: "upsellTag", tag: tagField.current?.value ?? "" }, { method: "POST" });

  return (
    <s-page heading="Settings">
      <s-section heading="Offer policy">
        <s-stack gap="base">
          <s-paragraph>
            Now: {offerPolicy.discountPercent}% off ({sourceLabel("discountPercent")}), offers up to{" "}
            {offerPolicy.maxOrderRatio}× the order subtotal ({sourceLabel("maxOrderRatio")}).
          </s-paragraph>
          <s-number-field
            ref={discountField}
            label="Discount (%)"
            name="discountPercent"
            value={savedPolicy.discountPercent ?? ""}
            min={DISCOUNT_RANGE.min}
            max={DISCOUNT_RANGE.max}
            step={1}
            placeholder={`Default: ${policyDefaults.discountPercent}`}
            details={`Whole number from ${DISCOUNT_RANGE.min} to ${DISCOUNT_RANGE.max}. 0 means no discount. Leave empty for the default.`}
            error={policyErrors.discountPercent}
          />
          <s-number-field
            ref={capField}
            label="Price cap (× order subtotal)"
            name="maxOrderRatio"
            value={savedPolicy.maxOrderRatio ?? ""}
            min={PRICE_CAP_RANGE.min}
            max={PRICE_CAP_RANGE.max}
            step={0.05}
            placeholder={`Default: ${policyDefaults.maxOrderRatio}`}
            details={`An offer can cost at most this many times the order subtotal (${PRICE_CAP_RANGE.min} to ${PRICE_CAP_RANGE.max}). Leave empty for the default.`}
            error={policyErrors.maxOrderRatio}
          />
          <s-button onClick={savePolicy} {...loadingProps("offerPolicy")}>
            Save offer policy
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Upsell catalog">
        <s-stack gap="base">
          <s-paragraph>
            {upsellTag ? (
              <>
                Products tagged <s-text type="strong">{upsellTag}</s-text>
              </>
            ) : (
              "All active products"
            )}{" "}
            · {inCatalog} product{inCatalog === 1 ? "" : "s"} in the catalog now.
          </s-paragraph>
          <s-text-field
            ref={tagField}
            label="Upsell tag"
            name="tag"
            value={upsellTag ?? ""}
            placeholder="Leave empty for all active products"
            details="Only active products with this tag are enriched, offered and used to pick offers."
            error={fetcher.data?.tagError}
          />
          <s-button onClick={saveTag} {...loadingProps("upsellTag")}>
            Save and sync
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="AI updates">
        <s-stack gap="base">
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-text>Automatic AI updates</s-text>
            <s-badge tone={autoEnrichShown ? "success" : "neutral"}>
              {autoEnrichShown ? "On" : "Off"}
            </s-badge>
            <s-button onClick={toggleAutoEnrich} {...loadingProps("autoEnrich")}>
              {autoEnrichShown ? "Turn off" : "Turn on"}
            </s-button>
          </s-stack>
          <s-paragraph>
            On: product changes from Shopify are enriched by AI right away.
            Off (the default): changes are recorded and wait for Run AI update,
            so AI cost only happens when you run it. Turning it on also
            processes anything waiting.
          </s-paragraph>

          {queueRunning && (
            <s-banner tone="info">AI update is running. This page updates automatically.</s-banner>
          )}

          <s-paragraph>
            {waiting === 0
              ? "No product changes are waiting."
              : `${waiting} product${waiting === 1 ? "" : "s"} changed since the last AI run.`}
            {failed > 0 && ` ${failed} failed and will be retried by the next run.`}
          </s-paragraph>
          <s-paragraph>
            Last AI update:{" "}
            {lastEnrichedAt ? new Date(lastEnrichedAt).toLocaleString() : "never"}
          </s-paragraph>

          <s-button
            onClick={() => fetcher.submit({ intent: "run" }, { method: "POST" })}
            variant="primary"
            disabled={queueRunning}
            {...loadingProps("run")}
          >
            Run AI update
          </s-button>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Offer policy">
        <s-paragraph>
          The discount and price cap are set here, never by AI. A change applies
          to new checkouts; a buyer already on the offer page keeps the discount
          they were shown. Shopify calculates the final price.
        </s-paragraph>
      </s-section>

      <s-section slot="aside" heading="Upsell tag">
        <s-paragraph>
          Add the tag to a product in Shopify Admin to bring it into the upsell
          catalog; remove it to take the product out (its relationships are
          removed right away, at no AI cost). New products in the catalog are
          enriched by the next AI run. Leave the tag empty to use every active
          product.
        </s-paragraph>
      </s-section>

      <s-section slot="aside" heading="What a run costs">
        <s-paragraph>
          A run enriches each changed product (one AI call each), then rebuilds
          relationships for every product (one AI call each). Archived and
          deleted products are always removed right away, whether this is on or
          off. Checkout never calls the AI.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
