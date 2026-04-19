import openapi from "@wesleytodd/openapi";

/**
 * Shared OpenAPI document builder. Pass this instance to every `modelRouter()`
 * call so the model-level openApi middlewares register their paths against it,
 * and mount it on the Express app (via `TerrenoApp.addMiddleware`) so clients
 * can fetch `/openapi.json`.
 *
 * We mount our own instance because `TerrenoApp` creates an internal oapi in
 * `build()` but doesn't expose it to user code — so without this shared
 * instance every `modelRouter()` call logs "No options.openApi provided,
 * skipping *OpenApiMiddleware" at debug level.
 */
export const oapi = openapi({
  info: {
    title: "Shade API",
    description: "Shade orchestrator and media tooling API.",
    version: "1.0.0",
  },
  openapi: "3.0.0",
});
