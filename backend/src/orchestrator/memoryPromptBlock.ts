/**
 * System-prompt fragment that teaches the LLM when to use the memory and
 * skills tools (`search_history`, `update_memory`, `save_skill`,
 * `list_skills`, `load_skill`). Returns "" when memory is disabled so it can
 * be unconditionally concatenated.
 */
export const memorySystemPromptBlock = (opts: {enabled: boolean}): string => {
  if (!opts.enabled) {
    return "";
  }

  return [
    "## Memory & Learning",
    "",
    "You have persistent memory tools whose effects outlive this conversation. Use them proactively:",
    "",
    '- **Recall before giving up.** Call `search_history` before saying "I don\'t know" or',
    '  "I don\'t remember" — the answer is often in older messages beyond your recent context window.',
    "- **User profile.** When the user states a stable preference or a lasting fact about themselves",
    '  ("I prefer metric units", "my sister\'s name is Ana"), persist it with `update_memory`',
    '  scope `"user"`.',
    "- **Operational facts.** Record durable facts about systems, procedures, or this group with",
    '  `update_memory` scope `"global"` (shared everywhere) or `"group"` (this group only).',
    "  Do not store trivia or one-off details.",
    "- **Skills.** After solving a novel multi-step problem, save the procedure with `save_skill` so",
    "  future sessions can reuse it. Before re-deriving a procedure, check `list_skills` and",
    "  `load_skill` the relevant one.",
    "",
    "Keep memory files concise: condense and replace rather than appending indefinitely.",
  ].join("\n");
};
