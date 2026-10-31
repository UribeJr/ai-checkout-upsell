import { useEffect } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getSettings, updateSettings } from "../services/settings.server";
import { isQueueRunning, startQueue } from "../services/catalog/enrichment-queue.server";

// Settings: whether product changes start AI enrichment automatically, and a
// button to run it by hand. Manual mode lets the merchant decide when AI cost
// happens; one run covers every change recorded since the last one.
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [settings, waiting, failed, lastRun] = await Promise.all([
    getSettings(shop),
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
    waiting,
    failed,
    lastEnrichedAt: lastRun._max.enrichedAt?.toISOString() ?? null,
    queueRunning: isQueueRunning(shop),
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

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
  const { autoEnrich, waiting, failed, lastEnrichedAt, queueRunning } = useLoaderData();
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();

  // Show the new setting while the save is in flight.
  const pendingIntent = fetcher.formData?.get("intent");
  const autoEnrichShown =
    pendingIntent === "autoEnrich" ? fetcher.formData.get("enabled") === "true" : autoEnrich;
  const loadingProps = (intent) => (pendingIntent === intent ? { loading: true } : {});

  useEffect(() => {
    if (fetcher.data?.message) shopify.toast.show(fetcher.data.message);
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

  return (
    <s-page heading="Settings">
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
            Off: changes are recorded and wait for Run AI update, so AI cost
            only happens when you run it. Turning it on also processes anything
            waiting.
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
