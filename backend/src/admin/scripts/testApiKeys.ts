import type {ScriptRunner} from "./types";

/**
 * Pings each configured third-party API with a minimal request to verify the
 * key is valid and the service is reachable. Non-destructive — `wetRun` is
 * ignored, but the script is still safe for dry-run use.
 *
 * Covers Anthropic, OpenRouter, Deepgram, and Brave Search. Adds entries for
 * services that don't have a key configured so the operator can see the gap.
 */
export const testApiKeys: ScriptRunner = async (): Promise<{
  success: boolean;
  results: string[];
}> => {
  const results: string[] = [];
  let allOk = true;

  const report = (service: string, ok: boolean, detail: string): void => {
    results.push(`${ok ? "✓" : "✗"} ${service.padEnd(15)} ${detail}`);
    if (!ok) {
      allOk = false;
    }
  };

  // Anthropic — hit /v1/models with a `x-api-key` header.
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(8000),
      });
      report("anthropic", res.ok, res.ok ? "OK" : `HTTP ${res.status} ${res.statusText}`);
    } catch (err) {
      report("anthropic", false, `error: ${err}`);
    }
  } else {
    report("anthropic", false, "no key configured (AppConfig.apiKeys.anthropic)");
  }

  // OpenRouter — /api/v1/models with a Bearer token.
  if (process.env.OPENROUTER_API_KEY) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
        headers: {Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`},
        signal: AbortSignal.timeout(8000),
      });
      report("openrouter", res.ok, res.ok ? "OK" : `HTTP ${res.status} ${res.statusText}`);
    } catch (err) {
      report("openrouter", false, `error: ${err}`);
    }
  } else {
    report("openrouter", false, "no key configured (AppConfig.apiKeys.openRouter)");
  }

  // Deepgram — /v1/projects is the standard auth-check endpoint.
  if (process.env.DEEPGRAM_API_KEY) {
    try {
      const res = await fetch("https://api.deepgram.com/v1/projects", {
        headers: {Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`},
        signal: AbortSignal.timeout(8000),
      });
      report("deepgram", res.ok, res.ok ? "OK" : `HTTP ${res.status} ${res.statusText}`);
    } catch (err) {
      report("deepgram", false, `error: ${err}`);
    }
  } else {
    report("deepgram", false, "no key configured (AppConfig.apiKeys.deepgram)");
  }

  // Brave Search — 1-result query is the cheapest live check.
  if (process.env.BRAVE_SEARCH_API_KEY) {
    try {
      const res = await fetch("https://api.search.brave.com/res/v1/web/search?q=ping&count=1", {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY,
        },
        signal: AbortSignal.timeout(8000),
      });
      report("braveSearch", res.ok, res.ok ? "OK" : `HTTP ${res.status} ${res.statusText}`);
    } catch (err) {
      report("braveSearch", false, `error: ${err}`);
    }
  } else {
    report("braveSearch", false, "no key configured (AppConfig.apiKeys.braveSearch)");
  }

  // GitHub — /user is a cheap identity probe.
  if (process.env.GITHUB_TOKEN) {
    try {
      const res = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
        signal: AbortSignal.timeout(8000),
      });
      report("github", res.ok, res.ok ? "OK" : `HTTP ${res.status} ${res.statusText}`);
    } catch (err) {
      report("github", false, `error: ${err}`);
    }
  } else {
    report("github", false, "no token configured (AppConfig.apiKeys.github)");
  }

  return {success: allOk, results};
};
