import type {RichResponse} from "../schema";
import type {CardRenderer, ChannelType, FallbackRenderResult} from "./types";

/**
 * FallbackTextRenderer — used for any channel that cannot render cards
 * (currently email, webhook, imessage). Returns only the schema's
 * fallbackText; the cards array is ignored at render time (but still
 * persisted in Message.richPayload for audit).
 */
export class FallbackTextRenderer implements CardRenderer<FallbackRenderResult> {
  readonly channelType: ChannelType;
  readonly supportsRich = false;

  constructor(channelType: ChannelType) {
    this.channelType = channelType;
  }

  render(response: RichResponse): FallbackRenderResult {
    return {text: response.fallbackText};
  }
}
