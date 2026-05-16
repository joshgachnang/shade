import type {RichResponse} from "../schema";
import type {CardRenderer} from "./types";

/**
 * TerrenoRenderer — placeholder for the @terreno/ui in-app renderer.
 * Not implemented in v1; schema is designed to map cleanly when this is built.
 */
export class TerrenoRenderer implements CardRenderer<never> {
  readonly channelType = "terreno" as const;
  readonly supportsRich = true;

  render(_response: RichResponse): never {
    throw new Error("TerrenoRenderer is not implemented in v1");
  }
}
