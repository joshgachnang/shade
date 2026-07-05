import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

/** Tools a fixture may script; each executes through the real IPC/board path. */
export type LlmFixtureActionTool =
  | "send_message"
  | "schedule_task"
  | "create_task"
  | "add_reaction";

export interface LlmFixtureAction {
  tool: LlmFixtureActionTool;
  args: Record<string, unknown>;
}

export interface LlmFixtureMatch {
  /** Restrict the fixture to one group; empty/unset matches any group. */
  groupId?: string;
  /** Regex tested against the incoming prompt; empty/unset matches any prompt. */
  pattern?: string;
}

export interface LlmFixtureFields {
  name: string;
  match: LlmFixtureMatch;
  /** The text the mock agent returns as its run output. */
  response: string;
  actions: LlmFixtureAction[];
  /** Extra latency for this fixture, on top of AppConfig.testMode.simulateLatencyMs. */
  delayMs: number;
  /** Higher wins when multiple fixtures match. */
  priority: number;
  /** Fire at most once; claimed atomically so concurrent runs can't double-fire. */
  consumeOnce: boolean;
}

export type LlmFixtureDocument = DefaultDoc & LlmFixtureFields;
export type LlmFixtureStatics = DefaultStatics<LlmFixtureDocument>;
export type LlmFixtureModel = DefaultModel<LlmFixtureDocument> & LlmFixtureStatics;
export type LlmFixtureSchema = mongoose.Schema<LlmFixtureDocument, LlmFixtureModel>;
