export interface AgentRunConfig {
  groupId: string;
  groupFolder: string;
  sessionId: string;
  prompt: string;
  systemPrompt?: string;
  modelBackend: "claude" | "ollama" | "codex";
  modelName?: string;
  env?: Record<string, string>;
  timeout: number;
  idleTimeout: number;
  resume?: boolean;
  resumeSessionAt?: string;
  mcpServers?: McpServerConfig[];
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
}

export interface AgentRunner {
  run(config: AgentRunConfig): Promise<AgentRunResult>;
  stop(sessionId: string): Promise<void>;
  isRunning(sessionId: string): boolean;
  sendFollowUp(sessionId: string, message: string): Promise<void>;
}
