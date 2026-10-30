/**
 * JSON schemas for the AI's structured output. They are "closed" (no extra
 * properties, every field required), as strict structured-output mode needs.
 *
 * A schema guarantees the *shape* of the answer. Whether the content is
 * acceptable (real fact references, real product IDs, no health claims) is
 * checked separately in validators.js.
 */

export const RELATIONSHIP_TYPES = ["COMPLEMENTARY", "ACCESSORY", "REFILL", "UPGRADE"];

const stringList = { type: "array", items: { type: "string" } };

// Offline: what is this product, and what is it used for?
export const ENRICHMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["category", "productFormat", "attributes", "useCases", "crossSellAngles", "factRefs"],
  properties: {
    category: { type: "string", description: "Short product category, e.g. 'Greens gummies'." },
    // Named productFormat, not "format": with "format" the model sometimes
    // answered with a data format ("JSON", "object").
    productFormat: {
      type: "string",
      description: "Physical form of the product, e.g. 'Resealable pouch of gummies'. Not a data format.",
    },
    attributes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "value"],
        properties: { name: { type: "string" }, value: { type: "string" } },
      },
    },
    useCases: { ...stringList, description: "When or how a customer uses it, e.g. 'travel'." },
    crossSellAngles: { ...stringList, description: "Why it pairs with other products, without claims." },
    factRefs: { ...stringList, description: "Verified facts copied exactly from the input." },
  },
};

// Offline: which other catalog products are worth offering after this one?
export const RELATIONSHIPS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["relationships"],
  properties: {
    relationships: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["targetProductId", "type", "score", "reasoning"],
        properties: {
          targetProductId: { type: "string" },
          type: { type: "string", enum: RELATIONSHIP_TYPES },
          score: { type: "number", description: "0 to 1 relevance for a post-purchase offer." },
          reasoning: { type: "string" },
        },
      },
    },
  },
};
