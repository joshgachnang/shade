export interface AgentRunConfig {
  groupId: string;
  groupFolder: string;
  sessionId: string;
  prompt: string;
  systemPrompt?: string;
  modelBackend: "claude" | "ollama" | "codex" | "gemini";
  modelName?: string;
  env?: Record<string, string>;
  timeout: number;
  idleTimeout: number;
  resume?: boolean;
  resumeSessionAt?: string;
  mcpServers?: McpServerConfig[];
  /** Called periodically with assistant text fragments for progress reporting */
  onProgress?: (text: string) => void;
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
}

export interface AgentRunner {
  run(config: AgentRunConfig): Promise<AgentRunResult>;
  stop(sessionId: string): Promise<void>;
  isRunning(sessionId: string): boolean;
  sendFollowUp(sessionId: string, message: string): Promise<void>;
}
