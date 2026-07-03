import mongoose from "mongoose";
import type {LlmFixtureDocument, LlmFixtureModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

export const MAX_FIXTURE_PATTERN_LENGTH = 500;

const isValidPattern = (value: string): boolean => {
  if (!value) {
    return true;
  }
  if (value.length > MAX_FIXTURE_PATTERN_LENGTH) {
    return false;
  }
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
};

const actionSchema = new mongoose.Schema(
  {
    tool: {
      type: String,
      required: true,
      enum: ["send_message", "schedule_task", "create_task", "add_reaction"],
    },
    args: {type: mongoose.Schema.Types.Mixed, default: {}},
  },
  {_id: false}
);

/**
 * Scripted response for MockAgentRunner (IP-012 AI testability harness).
 * Fixtures are matched against incoming prompts by priority; the winning
 * fixture's `response` becomes the mock agent's output and its `actions`
 * execute through the real IPC/board path. Programmed at runtime via the
 * /llmFixtures CRUD routes or POST /test/llm-fixtures.
 */
const llmFixtureSchema = new mongoose.Schema<LlmFixtureDocument, LlmFixtureModel>(
  {
    name: {type: String, required: true, trim: true},
    match: {
      groupId: {type: String},
      pattern: {
        type: String,
        validate: {
          validator: isValidPattern,
          message: `match.pattern must be a valid regular expression of at most ${MAX_FIXTURE_PATTERN_LENGTH} characters`,
        },
      },
    },
    response: {type: String, required: true},
    actions: {type: [actionSchema], default: []},
    delayMs: {type: Number, default: 0},
    priority: {type: Number, default: 0},
    consumeOnce: {type: Boolean, default: false},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

llmFixtureSchema.index({priority: -1, created: 1});

addDefaultPlugins(llmFixtureSchema);

export const LlmFixture = mongoose.model<LlmFixtureDocument, LlmFixtureModel>(
  "LlmFixture",
  llmFixtureSchema
);
