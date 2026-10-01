import {TEST_PASSWORD} from "../testMode/constants";

/**
 * Logs in as a user and returns the auth token.
 */
export const loginAsUser = async (
  baseUrl: string,
  email: string,
  password: string = TEST_PASSWORD
): Promise<string> => {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({email, password}),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Login failed (${res.status}): ${body}`);
  }

  const body = (await res.json()) as {data: {token: string}};
  return body.data.token;
};

/**
 * Sends a command via the /command endpoint, just like sending a Slack message.
 */
export const sendCommand = async (
  baseUrl: string,
  token: string,
  content: string,
  options: {groupId?: string; groupName?: string} = {}
): Promise<{messageId: string; groupId: string; groupName: string}> => {
  const res = await fetch(`${baseUrl}/command`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({content, ...options}),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Command failed (${res.status}): ${body}`);
  }

  const body = (await res.json()) as {
    data: {messageId: string; groupId: string; groupName: string};
  };
  return body.data;
};

export interface OutboxEntry {
  id: string;
  groupId: string;
  content: string;
  richPayload?: Record<string, unknown>;
  correlationId?: string;
  created: string;
}

/**
 * Reads the harness outbox — outbound bot messages. Requires the server to be
 * running in test mode (SHADE_TEST_MODE=1) and an admin token.
 */
export const getOutbox = async (
  baseUrl: string,
  token: string,
  options: {groupId?: string; since?: string} = {}
): Promise<OutboxEntry[]> => {
  const params = new URLSearchParams();
  if (options.groupId) {
    params.set("groupId", options.groupId);
  }
  if (options.since) {
    params.set("since", options.since);
  }
  const res = await fetch(`${baseUrl}/test/outbox?${params}`, {
    headers: {Authorization: `Bearer ${token}`},
  });
  if (!res.ok) {
    throw new Error(`getOutbox failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as {data: OutboxEntry[]};
  return body.data;
};

/**
 * Resets the harness to freshly-seeded state (users and AppConfig survive).
 */
export const resetHarness = async (
  baseUrl: string,
  token: string
): Promise<{adminId: string; userId: string; channelId: string; groupId: string}> => {
  const res = await fetch(`${baseUrl}/test/reset`, {
    method: "POST",
    headers: {Authorization: `Bearer ${token}`},
  });
  if (!res.ok) {
    throw new Error(`resetHarness failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as {
    data: {adminId: string; userId: string; channelId: string; groupId: string};
  };
  return body.data;
};

/**
 * Forces an immediate loop pass in the running orchestrator.
 */
export const tickHarness = async (
  baseUrl: string,
  token: string,
  target: "scheduler" | "messageLoop" | "ipc" | "taskWorker" | "all"
): Promise<void> => {
  const res = await fetch(`${baseUrl}/test/tick`, {
    method: "POST",
    headers: {"Content-Type": "application/json", Authorization: `Bearer ${token}`},
    body: JSON.stringify({target}),
  });
  if (!res.ok) {
    throw new Error(`tickHarness failed (${res.status}): ${await res.text()}`);
  }
};

/**
 * Waits for a condition to become true, polling at interval.
 */
export const waitFor = async (
  fn: () => Promise<boolean>,
  {timeoutMs = 10000, intervalMs = 200} = {}
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) {
      return;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
};
