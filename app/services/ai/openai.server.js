import OpenAI, { APIConnectionTimeoutError } from "openai";
import { AiError } from "./errors";

/**
 * OpenAI adapter: the only file that imports the OpenAI SDK.
 *
 * Uses the Responses API with strict JSON-schema structured output, so the
 * model's answer always has the shape we asked for.
 * Configured by OPENAI_API_KEY and OPENAI_MODEL (server-side only).
 */
let client;

function getClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new AiError("not_configured", "OPENAI_API_KEY is not set");
  }
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export async function generateWithOpenAI({
  task,
  instructions,
  input,
  schema,
  timeoutMs,
  maxRetries,
}) {
  const model = process.env.OPENAI_MODEL;
  if (!model) throw new AiError("not_configured", "OPENAI_MODEL is not set");

  try {
    const response = await getClient().responses.create(
      {
        model,
        instructions,
        input,
        text: { format: { type: "json_schema", name: task, strict: true, schema } },
        store: false, // don't keep requests on OpenAI's side
      },
      { timeout: timeoutMs, maxRetries },
    );

    return { text: response.output_text, modelName: response.model ?? model };
  } catch (error) {
    if (error instanceof AiError) throw error;
    if (error instanceof APIConnectionTimeoutError) {
      throw new AiError("timeout", `${task}: no answer within ${timeoutMs}ms`);
    }
    throw new AiError("provider_error", `${task}: ${error.message}`);
  }
}
