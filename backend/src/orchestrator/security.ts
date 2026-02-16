const SENSITIVE_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "OPENAI_API_KEY",
  "SLACK_BOT_TOKEN",
  "SLACK_APP_TOKEN",
  "SLACK_SIGNING_SECRET",
  "MONGO_URI",
  "MONGODB_URI",
  "DATABASE_URL",
  "JWT_SECRET",
  "SESSION_SECRET",
];

export const buildAgentEnv = (extraEnv?: Record<string, string>): Record<string, string> => {
  const env: Record<string, string> = {};

  // Pass through ANTHROPIC_API_KEY for the SDK to use
  if (process.env.ANTHROPIC_API_KEY) {
    env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  }

  // Pass through user-specified env vars
  if (extraEnv) {
    Object.assign(env, extraEnv);
  }

  return env;
};

export const getSanitizedEnvForShell = (): string[] => {
  return SENSITIVE_ENV_VARS.map((v) => `unset ${v}`);
};

export const createPreToolUseHook = (): string => {
  const unsetCommands = SENSITIVE_ENV_VARS.map((v) => `unset ${v}`).join("; ");
  return unsetCommands;
};

export const redactSecrets = (text: string): string => {
  let redacted = text;
  for (const varName of SENSITIVE_ENV_VARS) {
    const value = process.env[varName];
    if (value && value.length > 4) {
      redacted = redacted.replaceAll(value, `[REDACTED:${varName}]`);
    }
  }
  return redacted;
};
