import fs from "node:fs/promises";
import path from "node:path";
import {logger} from "@terreno/api";
import {loadAppConfig} from "../../models/appConfig";
import {redactSecrets} from "../security";
import {getTranscriptPath} from "../sessions";
import type {AgentRunConfig, AgentRunner, AgentRunResult} from "./types";

/**
 * System prompt used by the planner. Pinned as a module-level constant per the
 * project style guide ("always extract GPT prompts to constants at the top of
 * the file"). The planner owns the `/ip` workflow inside a feature Slack
 * channel and hands off to Claude for `/implement`.
 */
const PLANNER_SYSTEM_PROMPT = `You are the feature planner for Shade — the implementation-planning half of a
Slack feature channel. You drive the \`/ip\` workflow end-to-end over chat with
the user. You never write application code; Claude (the implementor) will do
that once the user approves the plan.

## Your responsibilities

Walk through the Shape-Up-inspired \`/ip\` flow as a conversation. One step per
reply unless the user asks for more. After each step, ask for confirmation
before advancing.

1. **Ingest** — ask the user to describe the idea (problem + business case).
   Echo back a summary and confirm.
2. **Research** — present what you know about the likely affected code areas,
   existing patterns, risks, and options. Be opinionated; recommend one
   approach.
3. **Shape** — lock in models / APIs / UI / phases. Flag what's in-scope and
   explicitly what is out-of-scope.
4. **Generate** — produce the final implementation plan in a single markdown
   document. Use the section order:
     # Title
     ## Summary
     ## Goals / Non-Goals
     ## Data Model Changes
     ## API / Backend Changes
     ## Frontend / UX Changes
     ## Phases & Tasks (numbered, each independently testable)
     ## Risks & Open Questions
     ## Acceptance Criteria (manual + automated)
5. **Attack** — red-team the plan. Call out critical / high / medium risks and
   revise.

## Hard rules

- **Do not** output application source code, diffs, or CLI invocations beyond
  obvious shell commands. Your output is plan prose, tables, and task lists.
- **Do not** claim to have implemented or committed anything. You are the
  planner only.
- Treat the user's chat history (passed to you as the conversation so far) as
  the source of truth for what has been agreed. Don't repeat yourself.
- When the user is satisfied with the plan, tell them to type \`/implement\`
  (or \`!implement\`) to hand off to the Claude Agent SDK.
- When you are ready to emit the final plan (step 4), wrap the full markdown
  document in fenced triple-backtick markdown like this:

  \`\`\`markdown
  # Title
  ...
  \`\`\`

  The orchestrator will save it to \`docs/implementationPlans/\` inside the
  feature's group folder. You can emit updated drafts the same way; each emit
  overwrites the prior file.

## Config you are running with

- Model: \`{model}\`
- Feature name: \`{featureName}\`
- Assistant display name: \`{assistantName}\`

Keep replies Slack-friendly: short paragraphs, bullet lists, and code blocks
where helpful. Avoid wall-of-text responses.`;

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAIChoice {
  message: {role: string; content: string};
  finish_reason: string;
}

interface OpenAIResponse {
  choices: OpenAIChoice[];
  usage?: {total_tokens: number; prompt_tokens: number; completion_tokens: number};
  model: string;
}

interface PlannerConfig {
  apiKey: string;
  model: string;
  featureName: string;
  assistantName: string;
}

const loadPlannerConfig = async (groupFolder: string): Promise<PlannerConfig> => {
  const appConfig = await loadAppConfig();
  const apiKey = appConfig.apiKeys?.openai?.trim() || process.env.OPENAI_API_KEY?.trim() || "";
  if (!apiKey) {
    throw new Error(
      "AppConfig.apiKeys.openai is not set — the planner cannot run. " +
        "Set it via the admin UI (or the OPENAI_API_KEY env var as a last resort)."
    );
  }
  const model = appConfig.models?.planner?.trim() || "gpt-5.4";
  return {
    apiKey,
    model,
    featureName: path.basename(groupFolder),
    assistantName: appConfig.assistantName,
  };
};

const renderSystemPrompt = (config: PlannerConfig, fallback: string | undefined): string => {
  const head = PLANNER_SYSTEM_PROMPT.replace("{model}", config.model)
    .replace("{featureName}", config.featureName)
    .replace("{assistantName}", config.assistantName);
  if (!fallback) {
    return head;
  }
  return `${head}\n\n---\n\n${fallback}`;
};

/**
 * Very small conversation-history recovery. We don't keep a planner-native
 * session store; instead we load the group's chat transcript (already
 * maintained by `sessions.ts` for Claude) and replay it into OpenAI.
 */
const loadConversationHistory = async (
  groupId: string,
  sessionId: string,
  fallbackPrompt: string
): Promise<OpenAIMessage[]> => {
  const transcriptPath = getTranscriptPath(groupId, sessionId);
  const messages: OpenAIMessage[] = [];
  try {
    const raw = await fs.readFile(transcriptPath, "utf-8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      try {
        const entry = JSON.parse(line) as {type?: string; content?: string; output?: string};
        if (entry.type === "user_message" && entry.content) {
          messages.push({role: "user", content: entry.content});
          continue;
        }
        if (entry.type === "agent_response" && entry.output) {
          messages.push({role: "assistant", content: entry.output});
        }
      } catch {
        // Skip malformed lines — the transcript is best-effort.
      }
    }
  } catch {
    // No transcript yet — fine, this is the first turn.
  }

  if (messages.length === 0) {
    messages.push({role: "user", content: fallbackPrompt});
  }

  return messages;
};

/**
 * Pull the "markdown" fenced block out of the planner response and, if
 * present, persist it as the current plan draft. Returns the path written (or
 * null if the response didn't include a plan draft).
 */
const extractAndPersistPlan = async (
  responseText: string,
  groupFolder: string,
  featureName: string
): Promise<string | null> => {
  const match = responseText.match(/```markdown\n([\s\S]*?)\n```/);
  if (!match) {
    return null;
  }
  const planMarkdown = match[1];
  const planDir = path.join(groupFolder, "docs", "implementationPlans");
  const planPath = path.join(planDir, `${featureName}.md`);
  try {
    await fs.mkdir(planDir, {recursive: true});
    await fs.writeFile(planPath, planMarkdown, "utf-8");
    logger.info(`Planner saved draft plan: ${planPath}`);
    return planPath;
  } catch (err) {
    logger.error(`Planner failed to write plan file ${planPath}: ${err}`);
    return null;
  }
};

/**
 * Agent runner that drives the `/ip` planning conversation in feature
 * channels via the OpenAI Chat Completions API. Used instead of the Claude
 * Agent SDK while `group.featurePhase === "planning"`.
 */
export class OpenAIAgentRunner implements AgentRunner {
  private activeRuns = new Map<string, AbortController>();

  async run(config: AgentRunConfig): Promise<AgentRunResult> {
    const startedAt = Date.now();
    const abortController = new AbortController();
    this.activeRuns.set(config.sessionId, abortController);

    const timeoutId = setTimeout(() => {
      logger.warn(`Planner ${config.sessionId} timed out after ${config.timeout}ms`);
      abortController.abort();
    }, config.timeout);

    try {
      const plannerConfig = await loadPlannerConfig(config.groupFolder);
      const systemPrompt = renderSystemPrompt(plannerConfig, config.systemPrompt);
      const history = await loadConversationHistory(
        config.groupId,
        config.sessionId,
        config.prompt
      );

      const messages: OpenAIMessage[] = [
        {role: "system", content: systemPrompt},
        ...history,
      ];

      logger.info(
        `Planner run: session=${config.sessionId}, model=${plannerConfig.model}, turns=${messages.length}`
      );

      const response = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${plannerConfig.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: plannerConfig.model,
          messages,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
      }

      const data = (await response.json()) as OpenAIResponse;
      const output = data.choices?.[0]?.message?.content?.trim() ?? "";
      if (!output) {
        throw new Error("Planner returned an empty response");
      }

      await extractAndPersistPlan(output, config.groupFolder, plannerConfig.featureName);

      return {
        output: redactSecrets(output),
        sessionId: config.sessionId,
        durationMs: Date.now() - startedAt,
        status: "completed",
      };
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Planner ${config.sessionId} error: ${errorMessage}`);
      return {
        output: "",
        sessionId: config.sessionId,
        durationMs: Date.now() - startedAt,
        status: isAbort ? "timeout" : "failed",
        error: redactSecrets(errorMessage),
      };
    } finally {
      clearTimeout(timeoutId);
      this.activeRuns.delete(config.sessionId);
    }
  }

  async stop(sessionId: string): Promise<void> {
    const controller = this.activeRuns.get(sessionId);
    if (controller) {
      controller.abort();
      logger.info(`Stopped planner ${sessionId}`);
    }
  }

  isRunning(sessionId: string): boolean {
    return this.activeRuns.has(sessionId);
  }

  async sendFollowUp(_sessionId: string, _message: string): Promise<void> {
    // Planner runs are one-shot chat completions — follow-ups happen naturally
    // on the next queue turn when a new user message arrives.
  }
}
