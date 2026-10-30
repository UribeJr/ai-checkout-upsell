import { AiError } from "./errors";
import { generateWithOpenAI } from "./openai.server";

/**
 * Vendor-neutral entry point for structured AI output. The rest of the app
 * calls generateStructured() and never imports a vendor SDK, so switching to
 * another provider means adding one adapter here, not rewriting services.
 *
 * An adapter receives the request and returns { text, modelName }, or throws
 * an AiError.
 */
const ADAPTERS = {
  openai: generateWithOpenAI,
};

/**
 * Asks the configured provider for JSON matching `schema`.
 * Returns { data, modelName, durationMs }; throws AiError.
 *
 * `task` names the request (letters, digits, "_" only), e.g. "product_enrichment".
 */
export async function generateStructured({
  task,
  instructions,
  input,
  schema,
  timeoutMs,
  maxRetries = 0,
}) {
  const providerName = process.env.AI_PROVIDER ?? "openai";
  const adapter = ADAPTERS[providerName];
  if (!adapter) {
    throw new AiError("not_configured", `Unknown AI_PROVIDER "${providerName}"`);
  }

  const startedAt = Date.now();
  const { text, modelName } = await adapter({
    task,
    instructions,
    input: JSON.stringify(input),
    schema,
    timeoutMs,
    maxRetries,
  });

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AiError("invalid_json", `${task}: response was not valid JSON`);
  }

  return { data, modelName, durationMs: Date.now() - startedAt };
}
