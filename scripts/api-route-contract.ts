import { quoteIdPattern } from "../packages/contracts/quotes.ts";

const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: "object", properties, required,
});
const json = (schema: object) => ({ "application/json": { schema } });
const success = (description: string, schema: object) => ({ description, content: json(schema) });
const text = { type: "string" };
const error = (description: string) => success(description, object({ error: text }));
const authFailure = { 401: error("Missing or invalid credential."), 403: error("The request lacks the required same-site marker.") };
const device = object({ id: text, name: text, kind: text }, ["id"]);
const query = (name: string, schema: object, required = true) => ({ name, in: "query", schema, required });
const quote = object({ id: { ...text, pattern: quoteIdPattern }, name: text, price: text, currency: text,
  priceCNY: text, at: { ...text, format: "date-time" }, changePercent: { type: "number" },
  timeSource: { enum: ["market", "retrieved"] } }, ["id", "name", "price", "currency", "priceCNY", "at"]);

export const supportingPaths = {
  "/v1/pair": { post: {
    operationId: "pairDevice", security: [],
    requestBody: { required: true, content: json(object({ code: { ...text, minLength: 4, maxLength: 32 } })) },
    responses: { 200: {
      ...success("Phone and CLI receive a credential. A browser receives a cookie.", object({ device, credential: text }, ["device"])),
      headers: { "Set-Cookie": { schema: text } },
    }, 400: error("Invalid or expired pairing code."), 403: authFailure[403], 429: error("Pairing rate limit.") },
  } },
  "/v1/session": { get: { operationId: "currentSession", responses: {
    200: success("Current device.", object({ device })), ...authFailure,
  } } },
  "/v1/session/revoke": { post: { operationId: "revokeSession", responses: {
    200: success("Current credential revoked.", object({ revoked: { const: true } })), ...authFailure,
  } } },
  "/v1/events": { get: { operationId: "subscribeChanges", responses: {
    200: { description: "Server-sent ready/change hints. Pull the change feed for confirmed data.",
      content: { "text/event-stream": { schema: text } } },
    ...authFailure, 429: error("Subscription limit."),
  } } },
  "/v1/quotes": { get: { operationId: "fetchQuotes", parameters: [query("ids", { ...text, maxLength: 4000 })], responses: {
    200: success("Available quotes and valid identifiers without a quote.", object({
      quotes: { type: "object", additionalProperties: quote }, missing: { type: "array", items: text },
    })), ...authFailure,
  } } },
  "/v1/quotes/search": { get: { operationId: "searchQuotes", parameters: [
    query("kind", { enum: ["crypto", "stock"] }), query("q", { ...text, minLength: 1, maxLength: 40 }),
  ], responses: { 200: success("Matching assets.", object({ results: { type: "array", items: object({
    quoteId: text, name: text, symbol: text, kind: { enum: ["crypto", "stock"] }, market: text, currency: text,
  }) } })), ...authFailure, 502: error("Market data temporarily unavailable.") } } },
};
