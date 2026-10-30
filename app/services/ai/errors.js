/**
 * The one error type the rest of the app sees from the AI layer, whatever
 * vendor is behind it. Callers decide what to do based on `code`:
 *
 *   not_configured  no API key / model / provider set
 *   timeout         the provider didn't answer in time
 *   provider_error  the provider returned an error (auth, rate limit, 5xx, ...)
 *   invalid_json    the answer wasn't parseable JSON
 *   invalid_output  valid JSON, but it failed our validation rules
 */
export class AiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AiError";
    this.code = code;
  }
}
