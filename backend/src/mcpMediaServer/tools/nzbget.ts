import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {nzbgetRequest} from "../apiClient";
import type {NzbgetConfig} from "../config";

export const registerNzbgetTools = (server: McpServer, config: NzbgetConfig) => {
  const rpc = (method: string, params?: unknown[]) =>
    nzbgetRequest(config.baseUrl, config.username, config.password, method, params);

  server.tool(
    "nzbget_status",
    "Get NZBGet server status including download speed, remaining size, and state.",
    {},
    async () => {
      const result = await rpc("status");
      const status = result as Record<string, unknown>;
      const summary = {
        downloadRate: `${((status.DownloadRate as number) / 1024 / 1024).toFixed(1)} MB/s`,
        remainingSize: `${((status.RemainingSizeMB as number) ?? 0).toFixed(0)} MB`,
        downloadPaused: status.DownloadPaused,
        postJobCount: status.PostJobCount,
        serverStandBy: status.ServerStandBy,
        uptimeSec: status.UpTimeSec,
        downloadLimit: status.DownloadLimit,
        freeSpaceMB: status.FreeDiskSpaceMB,
      };
      return {content: [{type: "text", text: JSON.stringify(summary, null, 2)}]};
    }
  );

  server.tool("nzbget_list_downloads", "List active downloads in NZBGet's queue.", {}, async () => {
    const results = await rpc("listgroups");
    const groups = (results as Array<Record<string, unknown>>).map((g) => ({
      id: g.NZBID,
      name: g.NZBName,
      status: g.Status,
      fileSizeMB: ((g.FileSizeMB as number) ?? 0).toFixed(0),
      remainingMB: ((g.RemainingSizeMB as number) ?? 0).toFixed(0),
      category: g.Category,
      health: g.Health,
      downloadedSizeMB: ((g.DownloadedSizeMB as number) ?? 0).toFixed(0),
    }));
    return {content: [{type: "text", text: JSON.stringify(groups, null, 2)}]};
  });

  server.tool(
    "nzbget_history",
    "Get NZBGet download history.",
    {
      limit: z.number().default(20).describe("Number of history entries to return (default: 20)"),
    },
    async ({limit}) => {
      const results = await rpc("history", [false]);
      const history = (results as Array<Record<string, unknown>>).slice(0, limit).map((h) => ({
        id: h.NZBID,
        name: h.Name,
        status: h.Status,
        fileSizeMB: ((h.FileSizeMB as number) ?? 0).toFixed(0),
        category: h.Category,
        parStatus: h.ParStatus,
        unpackStatus: h.UnpackStatus,
        deleteStatus: h.DeleteStatus,
        markStatus: h.MarkStatus,
        downloadTimeSec: h.DownloadTimeSec,
      }));
      return {content: [{type: "text", text: JSON.stringify(history, null, 2)}]};
    }
  );

  server.tool("nzbget_pause", "Pause NZBGet downloads globally.", {}, async () => {
    await rpc("pausedownload");
    return {content: [{type: "text", text: "Downloads paused."}]};
  });

  server.tool("nzbget_resume", "Resume NZBGet downloads globally.", {}, async () => {
    await rpc("resumedownload");
    return {content: [{type: "text", text: "Downloads resumed."}]};
  });

  server.tool(
    "nzbget_set_speed_limit",
    "Set NZBGet download speed limit in KB/s. Set to 0 for unlimited.",
    {limitKBs: z.number().min(0).describe("Speed limit in KB/s (0 = unlimited)")},
    async ({limitKBs}) => {
      await rpc("rate", [limitKBs]);
      return {
        content: [
          {
            type: "text",
            text: limitKBs === 0 ? "Speed limit removed." : `Speed limited to ${limitKBs} KB/s.`,
          },
        ],
      };
    }
  );

  server.tool(
    "nzbget_pause_item",
    "Pause a specific download in the queue.",
    {nzbId: z.number().describe("NZB ID to pause")},
    async ({nzbId}) => {
      const result = await rpc("editqueue", ["GroupPause", "", [nzbId]]);
      return {
        content: [
          {type: "text", text: result ? `Item ${nzbId} paused.` : `Failed to pause item ${nzbId}.`},
        ],
      };
    }
  );

  server.tool(
    "nzbget_resume_item",
    "Resume a specific paused download in the queue.",
    {nzbId: z.number().describe("NZB ID to resume")},
    async ({nzbId}) => {
      const result = await rpc("editqueue", ["GroupResume", "", [nzbId]]);
      return {
        content: [
          {
            type: "text",
            text: result ? `Item ${nzbId} resumed.` : `Failed to resume item ${nzbId}.`,
          },
        ],
      };
    }
  );

  server.tool(
    "nzbget_delete_item",
    "Delete a download from NZBGet's queue.",
    {nzbId: z.number().describe("NZB ID to delete")},
    async ({nzbId}) => {
      const result = await rpc("editqueue", ["GroupDelete", "", [nzbId]]);
      return {
        content: [
          {
            type: "text",
            text: result ? `Item ${nzbId} deleted.` : `Failed to delete item ${nzbId}.`,
          },
        ],
      };
    }
  );

  server.tool(
    "nzbget_move_item",
    "Move a download in the queue (change priority by position).",
    {
      nzbId: z.number().describe("NZB ID to move"),
      offset: z.number().describe("Positions to move (negative = up, positive = down)"),
    },
    async ({nzbId, offset}) => {
      const result = await rpc("editqueue", ["GroupMoveOffset", String(offset), [nzbId]]);
      return {
        content: [
          {
            type: "text",
            text: result
              ? `Item ${nzbId} moved by ${offset} positions.`
              : `Failed to move item ${nzbId}.`,
          },
        ],
      };
    }
  );
};
