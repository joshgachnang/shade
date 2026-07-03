import {FallbackTextRenderer} from "./fallback";
import {SlackBlockKitRenderer} from "./slack";
import {TerrenoRenderer} from "./terreno";
import type {CardRenderer, ChannelType} from "./types";

export {FallbackTextRenderer} from "./fallback";
export {SlackBlockKitRenderer} from "./slack";
export {TerrenoRenderer} from "./terreno";
export type {
  CardRenderer,
  ChannelType,
  FallbackRenderResult,
  SlackRenderResult,
} from "./types";
export {
  placeholderActionId,
  SHADE_CORR_PLACEHOLDER,
  SHADE_GROUP_PLACEHOLDER,
} from "./types";

const slack = new SlackBlockKitRenderer();
const email = new FallbackTextRenderer("email");
const webhook = new FallbackTextRenderer("webhook");
const imessage = new FallbackTextRenderer("imessage");
const test = new FallbackTextRenderer("test");
const terreno = new TerrenoRenderer();

/**
 * Pick the renderer for a channel type. `"terreno"` is reserved for the
 * future in-app renderer and currently throws on render(); use it to
 * preview / type-check, not to deliver.
 */
export const pickRenderer = (channelType: ChannelType | "terreno"): CardRenderer<unknown> => {
  switch (channelType) {
    case "slack":
      return slack;
    case "email":
      return email;
    case "webhook":
      return webhook;
    case "imessage":
      return imessage;
    case "test":
      return test;
    case "terreno":
      return terreno;
  }
};
