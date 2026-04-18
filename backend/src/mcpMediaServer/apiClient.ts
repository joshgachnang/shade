/**
 * Generic HTTP client for *arr / media service APIs.
 * Each service (Sonarr, Radarr, NZBGet, Plex) uses its own base URL + API key.
 */

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  params?: Record<string, string>;
}

export const makeRequest = async (
  baseUrl: string,
  path: string,
  apiKey: string,
  options: RequestOptions = {}
): Promise<unknown> => {
  const {method = "GET", body, headers = {}, params} = options;

  const url = new URL(path, baseUrl);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path} failed (${res.status}): ${text}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  return res.text();
};

/**
 * NZBGet uses JSON-RPC instead of REST, so it needs a different client.
 */
export const nzbgetRequest = async (
  baseUrl: string,
  username: string,
  password: string,
  method: string,
  params: unknown[] = []
): Promise<unknown> => {
  const url = `${baseUrl.replace(/\/$/, "")}/${username}:${password}/jsonrpc`;

  const res = await fetch(url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({method, params}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`NZBGet ${method} failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {result?: unknown; error?: unknown};
  if (data.error) {
    throw new Error(`NZBGet ${method} error: ${JSON.stringify(data.error)}`);
  }
  return data.result;
};

/**
 * Plex uses X-Plex-Token instead of X-Api-Key.
 */
export const plexRequest = async (
  baseUrl: string,
  path: string,
  token: string,
  options: RequestOptions = {}
): Promise<unknown> => {
  const {method = "GET", body, headers = {}, params = {}} = options;

  const url = new URL(path, baseUrl);
  url.searchParams.set("X-Plex-Token", token);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Plex ${method} ${path} failed (${res.status}): ${text}`);
  }

  return res.json();
};
