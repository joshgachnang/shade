/**
 * Converts standard Markdown (what models emit) to Slack mrkdwn (what Slack
 * renders). Slack has no heading syntax, uses single markers for emphasis
 * (`*bold*`, `_italic_`, `~strike~`), and `<url|label>` links. Code spans and
 * fences are identical in both, so they're stashed first and restored
 * untouched.
 *
 * Sentinels use Unicode private-use-area characters, which cannot occur in real message text.
 */

const CODE_OPEN = "\uE000C";
const LINK_OPEN = "\uE000L";
const BOLD_OPEN = "\uE000B";
const BOLD_CLOSE = "\uE000E";
const TOKEN_CLOSE = "\uE000";

export const markdownToMrkdwn = (markdown: string): string => {
  const stash: string[] = [];
  const stashToken = (prefix: string, value: string): string => {
    stash.push(value);
    return `${prefix}${stash.length - 1}${TOKEN_CLOSE}`;
  };

  // 1. Protect code from all transforms: fences first, then inline spans.
  let text = markdown.replace(/```[\s\S]*?```/g, (m) => stashToken(CODE_OPEN, m));
  text = text.replace(/`[^`\n]+`/g, (m) => stashToken(CODE_OPEN, m));

  // 2. Links and images become <url|label>, stashed so URLs survive the
  //    emphasis passes (underscores and asterisks are common in URLs).
  text = text.replace(/!?\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) =>
    stashToken(LINK_OPEN, label ? `<${url}|${label}>` : `<${url}>`)
  );

  // 3. Inline emphasis. Bold is tokenized (not converted straight to `*`) so
  //    the italic pass can't re-match its markers.
  text = text
    .replace(/\*\*\*([^*]+)\*\*\*/g, `${BOLD_OPEN}_$1_${BOLD_CLOSE}`)
    .replace(/\*\*([^*]+)\*\*/g, `${BOLD_OPEN}$1${BOLD_CLOSE}`)
    .replace(/__([^_]+)__/g, `${BOLD_OPEN}$1${BOLD_CLOSE}`)
    .replace(/~~([^~]+)~~/g, "~$1~")
    // Single-asterisk italic → underscore. Requires a non-space right after
    // the opener so `2 * 3` and `* bullet` lines are left alone.
    .replace(/(?<![\w*])\*([^\s*][^*\n]*?)\*(?![\w*])/g, "_$1_");

  // 4. Line-level: headings become bold lines, bullet markers become •.
  text = text
    .split("\n")
    .map((line) => {
      const heading = line.match(/^(\s{0,3})#{1,6}\s+(.+?)\s*#*\s*$/);
      if (heading) {
        // The whole line is bolded, so drop any bold markers inside it.
        const content = heading[2]
          .replaceAll(BOLD_OPEN, "")
          .replaceAll(BOLD_CLOSE, "")
          .replace(/\*/g, "");
        return `${heading[1]}*${content}*`;
      }
      const bullet = line.match(/^(\s*)[-+*]\s+(.*)$/);
      if (bullet) {
        return `${bullet[1]}• ${bullet[2]}`;
      }
      return line;
    })
    .join("\n");

  // 5. Resolve bold tokens, then restore stashed links and code.
  text = text.replace(/\uE000B([\s\S]*?)\uE000E/g, "*$1*");
  text = text.replace(/\uE000[CL](\d+)\uE000/g, (_m, i: string) => stash[Number(i)]);

  return text;
};
