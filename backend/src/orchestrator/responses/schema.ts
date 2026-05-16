import {z} from "zod";

export const SCHEMA_VERSION = "1" as const;

const SemanticColor = z.enum(["primary", "neutral", "success", "warning", "error", "info"]);
const ButtonStyle = z.enum(["primary", "danger", "default"]);

const Action = z.object({
  actionId: z.string().min(1).max(64),
  label: z.string().min(1).max(75),
  style: ButtonStyle.default("default"),
  value: z.string().max(2000).optional(),
  url: z.string().url().optional(),
});

const WithActions = z.object({
  actions: z.array(Action).max(5).optional(),
});

const TextCard = z.object({
  kind: z.literal("text"),
  markdown: z.string().min(1).max(3000),
});

const YesNoCard = z.object({
  kind: z.literal("yes_no"),
  question: z.string().min(1).max(500),
  yesLabel: z.string().max(75).default("Yes"),
  noLabel: z.string().max(75).default("No"),
  actionId: z.string().min(1).max(64),
});

const WeatherCard = z.object({
  kind: z.literal("weather"),
  location: z.string().max(120),
  summary: z.string().max(200),
  tempF: z.number(),
  feelsLikeF: z.number().optional(),
  highF: z.number().optional(),
  lowF: z.number().optional(),
  precipChance: z.number().min(0).max(1).optional(),
  windMph: z.number().optional(),
  iconUrl: z.string().url().optional(),
});

const CodeCard = z.object({
  kind: z.literal("code"),
  language: z.string().max(32).default("text"),
  code: z.string().min(1).max(4000),
  caption: z.string().max(200).optional(),
});

const MapMarker = z.object({
  lat: z.number(),
  lng: z.number(),
  label: z.string().max(40).optional(),
  color: SemanticColor.optional(),
});

const MapCard = z.object({
  kind: z.literal("map"),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  zoom: z.number().min(0).max(22).default(13),
  markers: z.array(MapMarker).max(20).default([]),
  caption: z.string().max(200).optional(),
});

const ListItem = z.object({
  title: z.string().min(1).max(120),
  subtitle: z.string().max(200).optional(),
  badge: z
    .object({
      label: z.string().max(40),
      color: SemanticColor.default("neutral"),
    })
    .optional(),
  onPress: Action.optional(),
});

const ListCard = z.object({
  kind: z.literal("list"),
  title: z.string().max(120).optional(),
  items: z.array(ListItem).min(1).max(10),
});

const ErrorCard = z.object({
  kind: z.literal("error"),
  message: z.string().min(1).max(500),
  detail: z.string().max(2000).optional(),
});

const ImageCard = z.object({
  kind: z.literal("image"),
  url: z.string().url(),
  altText: z.string().min(1).max(200),
  caption: z.string().max(200).optional(),
  aspectRatio: z.number().min(0.1).max(10).optional(),
});

const TableCard = z.object({
  kind: z.literal("table"),
  title: z.string().max(120).optional(),
  columns: z.array(z.string().max(60)).min(2).max(4),
  rows: z
    .array(z.array(z.string().max(200)))
    .min(1)
    .max(20)
    .refine(
      (rows) => rows.every((r) => r.length === rows[0].length),
      "All rows must have the same column count"
    ),
});

/**
 * Card discriminated union.
 *
 * Note on .merge(WithActions): in Zod 4.3.6, .merge() on a ZodObject preserves
 * the discriminator literal, so discriminatedUnion works on the merged shape.
 * Verified by tests in schema.test.ts ("accepts a card with actions").
 * YesNoCard and ErrorCard intentionally omit the trailing actions row —
 * YesNoCard has its own buttons; ErrorCard is terminal.
 */
export const Card = z.discriminatedUnion("kind", [
  TextCard.merge(WithActions),
  YesNoCard,
  WeatherCard.merge(WithActions),
  CodeCard.merge(WithActions),
  MapCard.merge(WithActions),
  ListCard.merge(WithActions),
  ErrorCard,
  ImageCard.merge(WithActions),
  TableCard.merge(WithActions),
]);

export const MAX_CARDS = 10;
export const FALLBACK_TEXT_MAX = 4000;

export const RichResponse = z.object({
  v: z.literal(SCHEMA_VERSION),
  cards: z.array(Card).min(1).max(MAX_CARDS),
  fallbackText: z.string().min(1).max(FALLBACK_TEXT_MAX),
});

export type RichResponse = z.infer<typeof RichResponse>;
export type Card = z.infer<typeof Card>;
export type Action = z.infer<typeof Action>;
export type CardKind = Card["kind"];
