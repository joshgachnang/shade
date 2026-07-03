/**
 * Public base URL that the backend advertises to third-party integrations
 * (Slack Block Kit buttons, webhook callbacks, recording links, etc.).
 *
 * Resolved lazily so `AppConfig.publicUrl` (hydrated into `SHADE_PUBLIC_URL`
 * at boot — see `utils/configEnv.ts`) is respected by callsites that
 * originally cached the value in module-level consts.
 */
const DEFAULT_PUBLIC_URL = "https://shade-api.nang.io";

export const getPublicBaseUrl = (): string => {
  return process.env.SHADE_PUBLIC_URL || DEFAULT_PUBLIC_URL;
};

/**
 * HTTP (not HTTPS) variant of the public URL, used for serving static
 * recording files that we don't want browsers to block as mixed content in
 * some downstream players.
 */
export const getRecordingPublicBaseUrl = (): string => {
  return getPublicBaseUrl().replace(/^https:\/\//i, "http://");
};
