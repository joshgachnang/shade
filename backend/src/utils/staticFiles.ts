import path from "node:path";
import type express from "express";

/**
 * Express handler that safely serves a file rooted at `baseDir`. Protects
 * against path traversal (`../foo`) by resolving the requested path and
 * confirming it still lives under the base directory. Responds 403 otherwise.
 *
 * Mount it with a named wildcard so the matched segments appear at
 * `req.params.splat` (Express 5 / path-to-regexp 8 syntax):
 *
 *   app.get("/static/movies/*splat", serveStaticUnder(paths.movies));
 */
export const serveStaticUnder = (baseDir: string): express.RequestHandler => {
  const resolvedBase = path.resolve(baseDir);
  return (req: express.Request, res: express.Response): void => {
    const splat = (req.params as Record<string, string | string[] | undefined>).splat;
    const requested = Array.isArray(splat) ? splat.join("/") : (splat ?? "");
    const resolved = path.resolve(resolvedBase, requested);
    if (!resolved.startsWith(resolvedBase)) {
      res.status(403).json({error: "Forbidden"});
      return;
    }
    res.sendFile(resolved);
  };
};
