import {logger} from "@terreno/api";
import {logError} from "../errors";
import {handleMovieSearch} from "../movieSearch";
import type {InboundMessage} from "./types";

/**
 * Reply the router will send back through the originating channel, or null
 * to stay silent.
 */
interface CommandReply {
  content: string;
}

interface ChatCommand {
  /** Human-readable name, used only in log lines. */
  name: string;
  /** Matches the leading token of the message (case-insensitive). */
  match: (content: string) => RegExpMatchArray | null;
  /**
   * Run the command against the captured groups. Return the reply to post
   * back, or null to suppress a reply.
   */
  run: (args: {inbound: InboundMessage; match: RegExpMatchArray}) => Promise<CommandReply | null>;
}

const movieSearchCommand: ChatCommand = {
  name: "moviesearch",
  match: (content) => content.match(/^!moviesearch\s+(.+)/i),
  run: async ({inbound, match}) => {
    const query = match[1].trim();
    logger.info(`Movie search from ${inbound.sender}: "${query}"`);
    try {
      const response = await handleMovieSearch(query);
      return {content: response};
    } catch (err) {
      logError("Movie search failed", err);
      return {content: `Search failed: ${err instanceof Error ? err.message : String(err)}`};
    }
  },
};

/**
 * Dispatches chat-prefix commands (`!moviesearch ...`, etc.) before messages
 * fall through to the regular message-storage pipeline. Keeping this out of
 * `ChannelManager` means new bot commands can be added by registering a
 * `ChatCommand` instead of editing channel plumbing.
 */
export class ChatCommandRouter {
  private commands: ChatCommand[];

  constructor(commands: ChatCommand[] = [movieSearchCommand]) {
    this.commands = commands;
  }

  /**
   * Try to match `inbound.content` against the registered commands. Returns
   * the command's reply (or null) if a command handled the message, and
   * `undefined` if nothing matched — the caller should continue the normal
   * message-storage path.
   */
  async tryHandle(inbound: InboundMessage): Promise<CommandReply | null | undefined> {
    for (const cmd of this.commands) {
      const matched = cmd.match(inbound.content);
      if (!matched) {
        continue;
      }
      return cmd.run({inbound, match: matched});
    }
    return undefined;
  }
}

export type {ChatCommand, CommandReply};
