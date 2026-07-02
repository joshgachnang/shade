import {zodToJsonSchema} from "zod-to-json-schema";
import {RichResponse} from "./schema";

/**
 * Stable JSON Schema for the RichResponse envelope. Embedded into the
 * system prompt so the LLM can construct correctly-shaped payloads for
 * `respond_with_card` without trial-and-error.
 *
 * zod-to-json-schema's types target Zod 3; the runtime accepts Zod 4 objects
 * unchanged. We cast through `unknown` at the boundary to acknowledge that.
 */
export const richResponseJsonSchema = zodToJsonSchema(
  RichResponse as unknown as Parameters<typeof zodToJsonSchema>[0],
  {
    $refStrategy: "none",
    target: "jsonSchema7",
  }
);

export const richResponseJsonSchemaString = JSON.stringify(richResponseJsonSchema, null, 2);
