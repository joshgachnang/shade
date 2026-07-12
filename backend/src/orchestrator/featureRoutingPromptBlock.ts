/**
 * System-prompt fragment for main groups instructing the agent to route
 * feature requests through the `create_feature` tool instead of planning or
 * implementing inline. Returns "" for non-main groups (feature channels do
 * the implementation work themselves) so it can be unconditionally
 * concatenated.
 */
export const featureRoutingPromptBlock = (opts: {isMain: boolean}): string => {
  if (!opts.isMain) {
    return "";
  }

  return [
    "## Feature requests → create_feature (mandatory)",
    "",
    "When the user asks you to build a new feature, tool, integration, or app —",
    "anything that means writing or changing code beyond a quick fix or answer —",
    "do NOT plan, design, or implement it in this channel. Instead:",
    "",
    "1. Call the `create_feature` tool immediately with:",
    '   - `name`: a short kebab-case feature name (e.g. "cursor-workflows")',
    "   - `description`: a one-line summary for the channel topic",
    "   - `request`: the user's request verbatim, plus any constraints, context,",
    "     or decisions they gave earlier in the conversation",
    "2. Reply with one short sentence confirming the channel is being created.",
    "",
    "The dedicated feature channel handles all planning and implementation.",
    "Writing an implementation plan or code directly in this channel instead of",
    "calling `create_feature` is a mistake, even if the request seems small.",
  ].join("\n");
};
