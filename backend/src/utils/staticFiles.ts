import path from "node:path";
import type express from "express";

/**
 * Express handler that safely serves a file rooted at `baseDir`. Protects
 * against path traversal (`../foo`) by resolving the requested path and
 * confirming it still lives under the base directory. Responds 403 otherwise.
 *
 * Mount it with a trailing `*` path so the wildcard appears at `req.params[0]`:
 *
 *   app.get("/static/movies/*", serveStaticUnder(paths.movies));
 */
export const serveStaticUnder = (baseDir: string): express.RequestHandler => {
  const resolvedBase = path.resolve(baseDir);
  return (req: express.Request, res: express.Response): void => {
    const requested = (req.params as Record<string, string>)[0] ?? "";
    const resolved = path.resolve(resolvedBase, requested);
    if (!resolved.startsWith(resolvedBase)) {
      res.status(403).json({error: "Forbidden"});
      return;
    }
    res.sendFile(resolved);
  };
};
