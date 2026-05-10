import type {z} from "zod";
import type {Card} from "./schema";

type MapCard = Extract<Card, {kind: "map"}>;

const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 400;
const DEFAULT_STYLE = "mapbox/streets-v12";

const SEMANTIC_TO_HEX: Record<NonNullable<MapCard["markers"][number]["color"]>, string> = {
  primary: "3B82F6",
  neutral: "6B7280",
  success: "10B981",
  warning: "F59E0B",
  error: "EF4444",
  info: "06B6D4",
};

/**
 * Build a Mapbox Static API URL for a MapCard.
 *
 * Format:
 *   https://api.mapbox.com/styles/v1/<style>/static/<overlays>/<lng,lat,zoom>/<width>x<height>?access_token=<tok>
 *
 * Marker overlays use pin-s (small dot) with optional hex color and label.
 */
export const mapStaticUrl = (
  card: MapCard,
  opts: {token: string; width?: number; height?: number; style?: string}
): string => {
  const width = opts.width ?? DEFAULT_WIDTH;
  const height = opts.height ?? DEFAULT_HEIGHT;
  const style = opts.style ?? DEFAULT_STYLE;

  const overlaySegments = card.markers.map((m) => {
    const color = m.color ? SEMANTIC_TO_HEX[m.color] : SEMANTIC_TO_HEX.primary;
    const label = m.label ? encodeURIComponent(m.label.slice(0, 2)) : "";
    const pin = label ? `pin-s-${label}+${color}` : `pin-s+${color}`;
    return `${pin}(${m.lng},${m.lat})`;
  });

  const overlays = overlaySegments.length > 0 ? `${overlaySegments.join(",")}/` : "";
  const center = `${card.longitude},${card.latitude},${card.zoom}`;
  const tokenParam = `access_token=${encodeURIComponent(opts.token)}`;

  return `https://api.mapbox.com/styles/v1/${style}/static/${overlays}${center}/${width}x${height}?${tokenParam}`;
};

export type {MapCard};
// Marker type re-export for tests
export type Marker = z.infer<
  Exclude<MapCard["markers"], undefined> extends Array<infer M> ? z.ZodType<M> : never
>;
