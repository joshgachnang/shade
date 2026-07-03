import path from "node:path";

/**
 * Resolve the writable data directory at access time so `AppConfig.dataDir`
 * (hydrated into `SHADE_DATA_DIR` at boot) is respected. Consumers read
 * `paths.data`, `paths.groups`, … as before — the getter indirection is
 * invisible at the callsite.
 *
 * Individual path fields expose setters so tests can redirect a single path
 * (e.g. `paths.groups = tmpDir`) for isolation. Setters write into a local
 * override map; the getter returns the override if present, otherwise the
 * computed default based on the current data dir.
 */
const getDataDir = (): string => {
  return process.env.SHADE_DATA_DIR || path.join(process.cwd(), "data");
};

const overrides: Partial<
  Record<"data" | "groups" | "sessions" | "ipc" | "plugins" | "movies", string>
> = {};

const makePathAccessor = (key: keyof typeof overrides, segment: string): PropertyDescriptor => ({
  enumerable: true,
  configurable: true,
  get(): string {
    return overrides[key] ?? (segment === "" ? getDataDir() : path.join(getDataDir(), segment));
  },
  set(value: string) {
    overrides[key] = value;
  },
});

/**
 * Static filesystem paths — these don't belong directly in the database, but
 * the root data directory can be overridden via AppConfig (which hydrates
 * SHADE_DATA_DIR). Everything else is derived from the data dir at access
 * time.
 */
export const paths = Object.defineProperties({} as Record<keyof typeof overrides, string>, {
  data: makePathAccessor("data", ""),
  groups: makePathAccessor("groups", "groups"),
  sessions: makePathAccessor("sessions", "sessions"),
  ipc: makePathAccessor("ipc", "ipc"),
  plugins: makePathAccessor("plugins", "plugins"),
  movies: makePathAccessor("movies", "movies"),
});
