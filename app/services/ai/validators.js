// Explicit ".js" so the file also loads under plain Node (unit tests).
import { RELATIONSHIP_TYPES } from "./schemas.js";

/**
 * Pure checks on AI output, applied after the JSON schema. The model's answer
 * is only a suggestion; these rules decide what we keep.
 */

const MAX_RELATIONSHIPS = 5;
const MAX_LIST_ITEMS = 6;
const MAX_TEXT_LENGTH = 240;

// A backstop, not proof: catches common health, medical and efficacy wording
// that must never appear in a wellness product's AI-written text.
const HEALTH_CLAIM_PATTERN = new RegExp(
  "\\b(" +
    [
      "cures?", "treat(s|ment)?", "heals?", "prevents?", "disease", "immun(e|ity)",
      "detox", "cleanse", "weight loss", "lose weight", "burn fat", "metabolism",
      "boosts?", "energi[sz]e", "clinically", "doctor", "medical", "medicine", "fda",
      "anxiety", "stress relief", "sleep better", "gut health", "digestion",
      "inflammation", "blood sugar", "cholesterol", "deficienc(y|ies)",
    ].join("|") +
    ")\\b",
  "i",
);

// Answers like "JSON" or "object" mean the model misread the field.
const DATA_TYPE_WORDS = /^(json|object|string|text|array|null)$/i;

// Prices and discounts come from Shopify and store policy, never from AI copy.
const PRICE_OR_DISCOUNT_PATTERN =
  /[$€£¥%]|\b(discount|save|savings|sale|deal|free|off|price|cost|cheap)\b/i;

const MAX_HEADLINE_LENGTH = 60;
const MAX_DESCRIPTION_LENGTH = 160;

export function containsHealthClaim(text) {
  return HEALTH_CLAIM_PATTERN.test(text);
}

// Trims, drops empty or claim-bearing entries, and caps the list length.
function cleanList(values, warnings, label) {
  const kept = [];
  for (const value of values) {
    const text = String(value).trim();
    if (!text) continue;
    if (containsHealthClaim(text)) {
      warnings.push(`${label}: dropped "${text}" (health-claim wording)`);
      continue;
    }
    kept.push(text.slice(0, MAX_TEXT_LENGTH));
  }
  return kept.slice(0, MAX_LIST_ITEMS);
}

/**
 * Checks a product profile. Fact references the model made up (not copied
 * exactly from the product's verified facts) are dropped.
 * Returns { ok, profile, errors, warnings }.
 */
export function validateEnrichment(data, { verifiedFacts }) {
  const errors = [];
  const warnings = [];

  const category = String(data?.category ?? "").trim();
  const format = String(data?.productFormat ?? "").trim();
  if (!category) errors.push("category is empty");
  if (!format) errors.push("productFormat is empty");
  if (DATA_TYPE_WORDS.test(format)) errors.push(`productFormat "${format}" is a data type, not a product format`);

  const factRefs = [];
  for (const ref of data?.factRefs ?? []) {
    if (verifiedFacts.includes(ref)) factRefs.push(ref);
    else warnings.push(`factRefs: dropped "${ref}" (not a verified fact)`);
  }

  const attributes = (data?.attributes ?? [])
    .map(({ name, value }) => ({ name: String(name).trim(), value: String(value).trim() }))
    .filter(({ name, value }) => name && value && !containsHealthClaim(`${name} ${value}`))
    .slice(0, MAX_LIST_ITEMS);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    profile: {
      category: category.slice(0, 60),
      format: format.slice(0, 60),
      attributes,
      useCases: cleanList(data?.useCases ?? [], warnings, "useCases"),
      crossSellAngles: cleanList(data?.crossSellAngles ?? [], warnings, "crossSellAngles"),
      factRefs,
    },
  };
}

/**
 * Checks buyer-facing offer copy against the target product's verified facts.
 * Returns { ok, copy, problems }.
 */
export function validateOfferCopy({ headline, description, factRefs }, targetFacts) {
  const problems = [];
  const cleanHeadline = String(headline ?? "").trim();
  const cleanDescription = String(description ?? "").trim();
  const text = `${cleanHeadline} ${cleanDescription}`;

  if (!cleanHeadline) problems.push("headline is empty");
  if (cleanHeadline.length > MAX_HEADLINE_LENGTH) problems.push("headline is too long");
  if (!cleanDescription) problems.push("description is empty");
  if (cleanDescription.length > MAX_DESCRIPTION_LENGTH) problems.push("description is too long");
  if (containsHealthClaim(text)) problems.push("health-claim wording");
  if (PRICE_OR_DISCOUNT_PATTERN.test(text)) problems.push("mentions price or discount");

  const refs = factRefs ?? [];
  if (refs.length === 0) problems.push("cites no verified fact");
  if (refs.some((ref) => !targetFacts.includes(ref))) problems.push("cites a fact the product doesn't have");

  return {
    ok: problems.length === 0,
    problems,
    copy: { headline: cleanHeadline, description: cleanDescription, factRefs: refs },
  };
}

/**
 * Keeps only usable relationships: known target, not the product itself,
 * valid type, one edge per target. Scores are clamped to 0-1 and the top
 * MAX_RELATIONSHIPS by score are kept.
 *
 * Each edge's offer copy is checked against the target's verified facts. Bad
 * copy doesn't drop the relationship; its copy is left empty (null), and
 * checkout falls back to a template.
 * Returns { edges, dropped, rejectedCopy }.
 */
export function validateRelationships(
  data,
  { sourceProductId, catalogProductIds, factsByProductId = {} },
) {
  const known = new Set(catalogProductIds);
  const seenTargets = new Set();
  const edges = [];
  const dropped = [];
  const rejectedCopy = [];

  for (const edge of data?.relationships ?? []) {
    const reason = (why) => dropped.push({ targetProductId: edge.targetProductId, why });

    if (edge.targetProductId === sourceProductId) { reason("self-link"); continue; }
    if (!known.has(edge.targetProductId)) { reason("unknown product"); continue; }
    if (!RELATIONSHIP_TYPES.includes(edge.type)) { reason("invalid type"); continue; }
    if (seenTargets.has(edge.targetProductId)) { reason("duplicate target"); continue; }

    seenTargets.add(edge.targetProductId);

    const copyCheck = validateOfferCopy(edge, factsByProductId[edge.targetProductId] ?? []);
    if (!copyCheck.ok) {
      rejectedCopy.push({ targetProductId: edge.targetProductId, problems: copyCheck.problems });
    }

    edges.push({
      targetProductId: edge.targetProductId,
      type: edge.type,
      score: Math.min(1, Math.max(0, Number(edge.score) || 0)),
      reasoning: String(edge.reasoning ?? "").trim().slice(0, MAX_TEXT_LENGTH),
      headline: copyCheck.ok ? copyCheck.copy.headline : null,
      description: copyCheck.ok ? copyCheck.copy.description : null,
      factRefs: copyCheck.ok ? copyCheck.copy.factRefs : null,
    });
  }

  edges.sort((a, b) => b.score - a.score);
  return { edges: edges.slice(0, MAX_RELATIONSHIPS), dropped, rejectedCopy };
}
