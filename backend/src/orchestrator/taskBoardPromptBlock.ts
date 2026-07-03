/**
 * System-prompt fragment that teaches the LLM when to use the task board
 * tools (`delegate_task`, `get_task_result`, `list_agent_tasks`,
 * `cancel_agent_task`). Returns "" when the task worker is disabled so it can
 * be unconditionally concatenated.
 */
export const taskBoardSystemPromptBlock = (opts: {enabled: boolean}): string => {
  if (!opts.enabled) {
    return "";
  }

  return [
    "## Background Task Delegation",
    "",
    "You can fan work out to background agents through the task board:",
    "",
    "- **Delegate with `delegate_task`** when a subtask is independent and would take more than",
    "  a minute (research, long-running checks, batch work), or when the user explicitly asks",
    '  for something "in the background". Each delegated task runs as its own agent,',
    "  concurrently with this conversation.",
    "- **Getting results back.** Set `deliverResult: true` when the user wants to be messaged",
    "  on completion; otherwise poll `get_task_result` with the returned task id and report",
    "  back yourself.",
    "- **Don't delegate trivial lookups.** Anything you can answer in a few seconds (a quick",
    "  search, a single tool call) should be done directly in this run.",
    "- **One level only.** Delegated tasks cannot delegate further, so give each task a",
    "  complete, self-contained prompt — the background agent cannot see this conversation.",
    "- **Manage tasks** with `list_agent_tasks` (what's pending/running/done) and",
    "  `cancel_agent_task` (stop a task that's no longer needed).",
  ].join("\n");
};
