export interface AgentRunConfig {
  groupId: string;
  groupFolder: string;
  sessionId: string;
  prompt: string;
  systemPrompt?: string;
  modelBackend: "claude" | "ollama" | "codex" | "gemini" | "mock";
  modelName?: string;
  env?: Record<string, string>;
  timeout: number;
  idleTimeout: number;
  resume?: boolean;
  resumeSessionAt?: string;
  mcpServers?: McpServerConfig[];
  /** Slack timestamp of the triggering message (for reactions) */
  messageTs?: string;
  /** External ID of the user who triggered this run (e.g., Slack user ID) */
  senderExternalId?: string;
  /**
   * True when this run executes an AgentTask from the task board (set by
   * TaskWorkerService). Runners thread it into the MCP context so
   * delegate_task can enforce the one-level delegation rule.
   */
  isBoardTask?: boolean;
  /** Called periodically with assistant text fragments for progress reporting */
  onProgress?: (text: string) => void;
  /**
   * Set when the group runs in a zerg-managed container
   * (Group.executionConfig.mode === "container"). The ZergAgentRunner brings
   * the `<repo>-<feature>` session up (idempotently) and executes the turn
   * inside it; runners that cannot honor it fail the run rather than silently
   * running on the host.
   */
  container?: ContainerTarget;
}

/** Which zerg session (repo + feature) a run executes in. */
export interface ContainerTarget {
  /** Repo name as known to zerg's repos.json. */
  repo: string;
  /** Feature slug; combined with repo to name the container and tmux window. */
  feature: string;
}

/**
 * How a human takes over a run that executed inside a zerg container: the
 * container/tmux names and the exact commands to attach and resume.
 */
export interface AgentAttachInfo {
  /** Docker container name (`<repo>-<feature>`). */
  session: string;
  /** tmux session/window name (`<repo>|<feature>`). */
  tmux: string;
  /** Host command that drops the operator into the session's tmux window. */
  attachCommand: string;
  /** Claude Code session id inside the container, for `claude --resume`. */
  claudeSessionId: string;
  /** Command to run inside the attached window to pick up this conversation. */
  resumeCommand: string;
}

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface AgentRunResult {
  output: string;
  sessionId: string;
  durationMs: number;
  status: "completed" | "failed" | "timeout";
  error?: string;
  costUsd?: number;
  /** SDK session ID for resuming (set on timeout) */
  resumeSessionId?: string;
  /** Last message UUID seen before timeout — resume point */
  lastMessageUuid?: string;
  /** Present when the run executed inside a zerg container. */
  attach?: AgentAttachInfo;
}

export interface AgentRunner {
  run(config: AgentRunConfig): Promise<AgentRunResult>;
  stop(sessionId: string): Promise<void>;
  isRunning(sessionId: string): boolean;
  sendFollowUp(sessionId: string, message: string): Promise<void>;
}
