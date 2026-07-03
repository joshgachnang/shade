export declare const SESSION_STATUSES: readonly ["created", "preparing", "running", "interrupted", "stopped", "merged", "cleaning", "cleaned", "failed"];
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export declare const SESSION_SUB_STATUSES: readonly ["idle", "thinking", "awaiting_permission", "running_tool", "unknown"];
export type SessionSubStatus = (typeof SESSION_SUB_STATUSES)[number];
export declare const NODE_STATUSES: readonly ["online", "offline", "degraded"];
export type NodeStatus = (typeof NODE_STATUSES)[number];
export declare const NODE_KINDS: readonly ["vm", "lxc"];
export type NodeKind = (typeof NODE_KINDS)[number];
//# sourceMappingURL=sessionStates.d.ts.map