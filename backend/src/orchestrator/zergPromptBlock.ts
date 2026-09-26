/**
 * System-prompt fragment for the zerg orchestrator role (IP-017): tells the
 * agent it can see every zerg session and when to reach for
 * `list_zerg_sessions`. Returns "" when zerg is disabled so it can be
 * unconditionally concatenated.
 */
export const zergSystemPromptBlock = (opts: {enabled: boolean}): string => {
  if (!opts.enabled) {
    return "";
  }

  return [
    "## Zerg Sessions (orchestrator view)",
    "",
    "zerg runs sandboxed agent sessions (drones) in containers on the zerg host, one per",
    "repo + feature. You are the orchestrator over them:",
    "",
    "- **See what's running with `list_zerg_sessions`** whenever someone asks what is in",
    "  flight, what is waiting on them, how a feature is going, or before you start new work",
    "  on a repo. Blocked, idle and dead sessions need a human; say which and why.",
    "- **Pending inbox items** are decisions a drone filed for a human (a question with a",
    "  recommendation and options). Relay them verbatim with the recommendation; you cannot",
    "  answer them from here — the user does that in zerg (`zerg answer` / `zerg approve`).",
    "- **Taking over**: every row carries the attach command (`zerg attach <repo> <feature>`).",
    "  Groups running in container mode are themselves zerg sessions and show up in this list.",
    "- This view is read-only. Do not claim to have started, killed or answered anything in zerg.",
  ].join("\n");
};
