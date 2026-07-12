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
  Record<"data" | "groups" | "sessions" | "ipc" | "plugins" | "movies" | "skills", string>
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
  skills: makePathAccessor("skills", "skills"),
});

/**
 * Remove a test override so the path falls back to the SHADE_DATA_DIR-derived
 * default. Tests must restore with this rather than assigning the previously
 * captured value: assigning a string pins the override permanently, so a later
 * test file that redirects SHADE_DATA_DIR (e.g. the harness e2e suite) would
 * still write through the stale absolute path into the real data directory.
 */
export const clearPathOverride = (key: keyof typeof overrides): void => {
  delete overrides[key];
};
