import {describe, expect, test} from "bun:test";
import {markdownToMrkdwn} from "./mrkdwn";

describe("markdownToMrkdwn", () => {
  test("converts headings to bold lines", () => {
    expect(markdownToMrkdwn("# Big Title")).toBe("*Big Title*");
    expect(markdownToMrkdwn("### Deploy Notes")).toBe("*Deploy Notes*");
    expect(markdownToMrkdwn("## Trailing hashes ##")).toBe("*Trailing hashes*");
  });

  test("drops nested bold markers inside headings", () => {
    expect(markdownToMrkdwn("## The **big** day")).toBe("*The big day*");
  });

  test("converts double-marker bold to single asterisk", () => {
    expect(markdownToMrkdwn("**bold**")).toBe("*bold*");
    expect(markdownToMrkdwn("__bold__")).toBe("*bold*");
    expect(markdownToMrkdwn("a **b** c **d** e")).toBe("a *b* c *d* e");
  });

  test("converts single-asterisk italic to underscores", () => {
    expect(markdownToMrkdwn("*italic*")).toBe("_italic_");
    expect(markdownToMrkdwn("some *italic* word")).toBe("some _italic_ word");
  });

  test("converts bold-italic", () => {
    expect(markdownToMrkdwn("***both***")).toBe("*_both_*");
  });

  test("converts strikethrough", () => {
    expect(markdownToMrkdwn("~~gone~~")).toBe("~gone~");
  });

  test("converts links and images to slack format", () => {
    expect(markdownToMrkdwn("see [the docs](https://example.com/a_b)")).toBe(
      "see <https://example.com/a_b|the docs>"
    );
    expect(markdownToMrkdwn("![alt](https://example.com/img.png)")).toBe(
      "<https://example.com/img.png|alt>"
    );
  });

  test("converts bullet list markers to bullets", () => {
    expect(markdownToMrkdwn("- one\n* two\n+ three")).toBe("• one\n• two\n• three");
    expect(markdownToMrkdwn("  - nested")).toBe("  • nested");
  });

  test("leaves numbered lists alone", () => {
    expect(markdownToMrkdwn("1. first\n2. second")).toBe("1. first\n2. second");
  });

  test("leaves code fences untouched, including markdown inside", () => {
    const fence = "```md\n# not a heading\n**not bold**\n```";
    expect(markdownToMrkdwn(fence)).toBe(fence);
  });

  test("leaves inline code untouched", () => {
    expect(markdownToMrkdwn('run `git commit -m "**wip**"` now')).toBe(
      'run `git commit -m "**wip**"` now'
    );
  });

  test("does not italicize math or bullet asterisks", () => {
    expect(markdownToMrkdwn("2 * 3 * 4 = 24")).toBe("2 * 3 * 4 = 24");
  });

  test("does not touch snake_case identifiers", () => {
    expect(markdownToMrkdwn("use loadAppConfig and reply_allowlist here")).toBe(
      "use loadAppConfig and reply_allowlist here"
    );
  });

  test("converts a realistic multi-feature message", () => {
    const input = [
      "## Status Report",
      "",
      "The deploy is **done**. Highlights:",
      "- Fixed the *DNS* bug",
      "- See [PR #88](https://github.com/x/y/pull/88)",
      "",
      "```bash",
      "./shade update dist/shade",
      "```",
    ].join("\n");

    const expected = [
      "*Status Report*",
      "",
      "The deploy is *done*. Highlights:",
      "• Fixed the _DNS_ bug",
      "• See <https://github.com/x/y/pull/88|PR #88>",
      "",
      "```bash",
      "./shade update dist/shade",
      "```",
    ].join("\n");

    expect(markdownToMrkdwn(input)).toBe(expected);
  });
});
