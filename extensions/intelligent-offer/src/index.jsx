/**
 * Post-purchase offer extension.
 *
 * 1. ShouldRender runs while the buyer is paying. It asks our backend for an
 *    offer and only requests the post-purchase page if there is one.
 * 2. Render shows that offer after payment. Every amount on the page comes from
 *    Shopify's calculateChangeset, not from our backend.
 *
 * Based on Shopify's "Build a post-purchase product offer" tutorial.
 */
// eslint-disable-next-line no-unused-vars -- React must be in scope for this extension's JSX build
import React, { useEffect, useState } from "react";
import {
  extend,
  render,
  useExtensionInput,
  BlockStack,
  Button,
  CalloutBanner,
  Heading,
  Image,
  Layout,
  Separator,
  Text,
  TextBlock,
  TextContainer,
  Tiles,
  View,
} from "@shopify/post-purchase-ui-extensions-react";

import { APP_URL } from "./config";

extend(
  "Checkout::PostPurchase::ShouldRender",
  async ({ inputData, storage }) => {
    const offer = await fetchOffer(inputData);
    if (!offer) return { render: false };

    await storage.update({ offer });
    return { render: true };
  },
);

// Returns the offer from our backend, or null on any problem, so a backend
// outage never blocks the buyer's checkout.
async function fetchOffer(inputData) {
  try {
    const response = await fetch(`${APP_URL}/api/offer`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${inputData.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        referenceId: inputData.initialPurchase.referenceId,
      }),
    });
    if (!response.ok) return null;

    const { offer } = await response.json();
    return offer ?? null;
  } catch (error) {
    console.error("[intelligent-offer] could not load offer", error);
    return null;
  }
}

// Asks our backend to sign the accepted offer. Returns the token, or null.
async function fetchSignedChangeset(inputData, offerId) {
  try {
    const response = await fetch(`${APP_URL}/api/sign-changeset`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${inputData.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        referenceId: inputData.initialPurchase.referenceId,
        offerId,
      }),
    });
    if (!response.ok) return null;

    const { token } = await response.json();
    return token ?? null;
  } catch (error) {
    console.error("[intelligent-offer] could not sign changeset", error);
    return null;
  }
}

render("Checkout::PostPurchase::Render", () => <App />);

export function App() {
  const { storage, done } = useExtensionInput();
  const offer = storage.initialData?.offer;

  // Storage can be empty (for example if ShouldRender and Render don't share
  // it). Without an offer there is nothing to show, so continue the checkout.
  if (!offer) return <ContinueToOrderStatus onContinue={done} />;

  return <OfferPage offer={offer} />;
}

function OfferPage({ offer }) {
  const { calculateChangeset, applyChangeset, done, inputData } =
    useExtensionInput();
  const [calculatedPurchase, setCalculatedPurchase] = useState(null);
  const [calculationFailed, setCalculationFailed] = useState(false);
  // Set as soon as the buyer presses either button, so they can't double-submit.
  const [submitting, setSubmitting] = useState(false);

  // Ask Shopify what the order would cost with this offer added:
  // discounted price, shipping and taxes for the buyer's address.
  useEffect(() => {
    async function calculatePurchase() {
      const result = await calculateChangeset({ changes: offer.changes });

      if (result.status === "processed") {
        setCalculatedPurchase(result.calculatedPurchase);
      } else {
        console.error("[intelligent-offer] calculateChangeset failed", result.errors);
        setCalculationFailed(true);
      }
    }
    calculatePurchase();
  }, [calculateChangeset, offer.changes]);

  if (calculationFailed) return <ContinueToOrderStatus onContinue={done} />;

  async function acceptOffer() {
    setSubmitting(true);

    // Our backend signs the changeset with the app secret, then Shopify
    // applies it to the order and charges the buyer the difference.
    const token = await fetchSignedChangeset(inputData, offer.id);
    if (token) {
      const result = await applyChangeset(token);
      if (result.status !== "processed") {
        console.error("[intelligent-offer] applyChangeset failed", result.errors);
      }
    }

    // Whatever happened, continue to the order status page.
    done();
  }

  function declineOffer() {
    setSubmitting(true);
    done();
  }

  const formatMoney = (amount, currencyCode) =>
    new Intl.NumberFormat(inputData.locale, {
      style: "currency",
      currency: currencyCode,
    }).format(Number(amount));

  const totals = calculatedPurchase && getTotals(calculatedPurchase);

  return (
    <BlockStack spacing="loose">
      <CalloutBanner title="It's not too late to add this to your order.">
        <Text size="medium">Add the {offer.productTitle} to your order and </Text>
        <Text size="medium" emphasized>
          save {offer.discountPercent}%.
        </Text>
      </CalloutBanner>

      <Layout
        maxInlineSize={0.95}
        media={[
          { viewportSize: "small", sizes: [1, 30, 1] },
          { viewportSize: "medium", sizes: [300, 30, 0.5] },
          { viewportSize: "large", sizes: [400, 30, 0.33] },
        ]}
      >
        <View>
          {offer.imageUrl && (
            <Image source={offer.imageUrl} description={offer.productTitle} />
          )}
        </View>
        <View />
        <BlockStack spacing="xloose">
          <TextContainer>
            <Heading>{offer.productTitle}</Heading>
            {totals ? (
              <TextBlock>
                <Text role="deletion" size="large">
                  {formatMoney(totals.originalPrice, totals.currencyCode)}
                </Text>{" "}
                <Text emphasized size="large" appearance="critical">
                  {formatMoney(totals.discountedPrice, totals.currencyCode)}
                </Text>
              </TextBlock>
            ) : (
              <TextBlock subdued>Calculating your price…</TextBlock>
            )}
          </TextContainer>

          {totals && (
            <BlockStack spacing="tight">
              <Separator />
              <PriceRow
                label="Subtotal"
                value={formatMoney(totals.discountedPrice, totals.currencyCode)}
              />
              <PriceRow
                label="Shipping"
                value={formatMoney(totals.shipping, totals.currencyCode)}
              />
              <PriceRow
                label="Taxes"
                value={formatMoney(totals.taxes, totals.currencyCode)}
              />
              <Separator />
              <PriceRow
                label="Total"
                value={formatMoney(totals.total, totals.currencyCode)}
                emphasized
              />
            </BlockStack>
          )}

          <BlockStack>
            <Button
              submit
              onPress={acceptOffer}
              loading={submitting}
              disabled={!totals || submitting}
            >
              {totals
                ? `Pay now · ${formatMoney(totals.total, totals.currencyCode)}`
                : "Pay now"}
            </Button>
            <Button subdued onPress={declineOffer} disabled={submitting}>
              Decline this offer
            </Button>
          </BlockStack>
        </BlockStack>
      </Layout>
    </BlockStack>
  );
}

// Pulls the amounts we display out of Shopify's calculated purchase.
// All values are in the buyer's (presentment) currency.
function getTotals(calculatedPurchase) {
  const lineItem = calculatedPurchase.updatedLineItems[0];
  const sumAmounts = (lines) =>
    lines.reduce((sum, line) => sum + Number(line.priceSet.presentmentMoney.amount), 0);

  return {
    currencyCode: lineItem.priceSet.presentmentMoney.currencyCode,
    originalPrice: lineItem.priceSet.presentmentMoney.amount,
    discountedPrice: lineItem.totalPriceSet.presentmentMoney.amount,
    shipping: sumAmounts(calculatedPurchase.addedShippingLines),
    taxes: sumAmounts(calculatedPurchase.addedTaxLines),
    total: calculatedPurchase.totalOutstandingSet.presentmentMoney.amount,
  };
}

function PriceRow({ label, value, emphasized = false }) {
  return (
    <Tiles>
      <TextBlock size={emphasized ? "medium" : "small"} emphasized={emphasized}>
        {label}
      </TextBlock>
      <TextContainer alignment="trailing">
        <TextBlock size={emphasized ? "medium" : "small"} emphasized={emphasized}>
          {value}
        </TextBlock>
      </TextContainer>
    </Tiles>
  );
}

// Shown when there is nothing valid to offer. Sends the buyer to the normal
// order status page right away.
function ContinueToOrderStatus({ onContinue }) {
  useEffect(() => {
    onContinue();
  }, [onContinue]);

  return null;
}
