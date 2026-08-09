import {execSync} from "node:child_process";

/** Escape a string for use inside AppleScript double quotes */
const escapeAppleScript = (str: string): string => {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
};

export type MessageService = "iMessage" | "SMS";

export const sendIMessage = (
  to: string,
  text: string,
  service: MessageService = "iMessage"
): void => {
  const escapedContent = escapeAppleScript(text);
  const escapedTarget = escapeAppleScript(to);

  // Group chats start with "chat" in their identifier
  const isGroupChat = to.startsWith("chat");

  const script = isGroupChat
    ? `tell application "Messages"
  set targetChat to a reference to text chat id "${escapedTarget}"
  send "${escapedContent}" to targetChat
end tell`
    : `tell application "Messages"
  set targetService to 1st account whose service type = ${service}
  set targetBuddy to participant "${escapedTarget}" of targetService
  send "${escapedContent}" to targetBuddy
end tell`;

  execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
    timeout: 10000,
    stdio: "pipe",
  });

  console.info(`${service} sent to ${to}`);
};
