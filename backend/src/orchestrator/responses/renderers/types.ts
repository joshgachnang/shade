import type {KnownBlock} from "@slack/types";
import type {ChannelDocument} from "../../../types";
import type {RichResponse} from "../schema";

export type ChannelType = ChannelDocument["type"];

/** Token substituted by SlackConnector with the real groupId at send time. */
export const SHADE_GROUP_PLACEHOLDER = "__SHADE_GROUP__";

/** Token substituted by SlackConnector with the real correlationId at send time. */
export const SHADE_CORR_PLACEHOLDER = "__SHADE_CORR__";

/** Builds the placeholder action_id form: shade:<group>:<corr>:<actionId>. */
export const placeholderActionId = (actionId: string): string =>
  `shade:${SHADE_GROUP_PLACEHOLDER}:${SHADE_CORR_PLACEHOLDER}:${actionId}`;

export interface SlackRenderResult {
  blocks: KnownBlock[];
  text: string;
}

export interface FallbackRenderResult {
  text: string;
}

export interface CardRenderer<TOutput> {
  readonly channelType: ChannelType | "terreno";
  readonly supportsRich: boolean;
  render(response: RichResponse): TOutput;
}
