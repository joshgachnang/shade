export const SESSION_STATUSES = [
	"created",
	"preparing",
	"running",
	"interrupted",
	"stopped",
	"merged",
	"cleaning",
	"cleaned",
	"failed",
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const SESSION_SUB_STATUSES = [
	"idle",
	"thinking",
	"awaiting_permission",
	"running_tool",
	"unknown",
] as const;

export type SessionSubStatus = (typeof SESSION_SUB_STATUSES)[number];

export const NODE_STATUSES = ["online", "offline", "degraded"] as const;

export type NodeStatus = (typeof NODE_STATUSES)[number];

export const NODE_KINDS = ["vm", "lxc"] as const;

export type NodeKind = (typeof NODE_KINDS)[number];
