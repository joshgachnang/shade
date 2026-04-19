import {
  type ModelRouterRegistration,
  modelRouter,
  Permissions,
  type RESTPermissions,
} from "@terreno/api";
import type {Model} from "mongoose";
import {
  AgentSession,
  AIRequest,
  AppConfig,
  CalendarConfig,
  Channel,
  Character,
  CommandClassification,
  Frame,
  FrameAnalysis,
  Group,
  Message,
  Movie,
  Plugin,
  RadioStream,
  RemoteAgent,
  ScheduledTask,
  TaskRunLog,
  Transcript,
  User,
  WebhookSource,
} from "../models";
import {oapi} from "../openapi";

/**
 * Permission preset: writes restricted to admins; reads require authentication.
 * Used for most models that aren't user-owned.
 */
const ADMIN_WRITES: RESTPermissions<unknown> = {
  create: [Permissions.IsAdmin],
  delete: [Permissions.IsAdmin],
  list: [Permissions.IsAuthenticated],
  read: [Permissions.IsAuthenticated],
  update: [Permissions.IsAdmin],
};

/**
 * Permission preset: any authenticated user can perform any action.
 * Used for movie-pipeline resources and similar collaborative data.
 */
const AUTHENTICATED_ALL: RESTPermissions<unknown> = {
  create: [Permissions.IsAuthenticated],
  delete: [Permissions.IsAuthenticated],
  list: [Permissions.IsAuthenticated],
  read: [Permissions.IsAuthenticated],
  update: [Permissions.IsAuthenticated],
};

interface CrudRouteDescriptor {
  path: string;
  // Each concrete model has its own Document generic; Model<any> lets us collect
  // them in one array since modelRouter itself is generic per call.
  model: Model<any>;
  permissions: RESTPermissions<unknown>;
  queryFields: string[];
  sort: string;
}

/**
 * CRUD route descriptors. Add a new entry here instead of creating a new
 * one-off `backend/src/api/<model>.ts` file for pure modelRouter wrappers.
 * Models that need custom routes (e.g. Movie, Transcript) still live in their
 * own file and register additional plugins.
 */
const descriptors: CrudRouteDescriptor[] = [
  {
    path: "/users",
    model: User,
    permissions: ADMIN_WRITES,
    queryFields: ["email", "name"],
    sort: "name",
  },
  {
    path: "/channels",
    model: Channel,
    permissions: ADMIN_WRITES,
    queryFields: ["type", "status"],
    sort: "name",
  },
  {
    path: "/groups",
    model: Group,
    permissions: ADMIN_WRITES,
    queryFields: ["channelId", "isMain", "name"],
    sort: "name",
  },
  {
    path: "/messages",
    model: Message,
    permissions: ADMIN_WRITES,
    queryFields: ["groupId", "isFromBot", "processedAt"],
    sort: "-created",
  },
  {
    path: "/scheduledTasks",
    model: ScheduledTask,
    permissions: {
      create: [Permissions.IsAuthenticated],
      delete: [Permissions.IsAdmin],
      list: [Permissions.IsAuthenticated],
      read: [Permissions.IsAuthenticated],
      update: [Permissions.IsAuthenticated],
    },
    queryFields: ["groupId", "status", "scheduleType", "classification"],
    sort: "-created",
  },
  {
    path: "/taskRunLogs",
    model: TaskRunLog,
    permissions: ADMIN_WRITES,
    queryFields: ["groupId", "taskId", "trigger", "status", "modelBackend"],
    sort: "-startedAt",
  },
  {
    path: "/agentSessions",
    model: AgentSession,
    permissions: ADMIN_WRITES,
    queryFields: ["groupId", "status"],
    sort: "-lastActivityAt",
  },
  {
    path: "/aiRequests",
    model: AIRequest,
    permissions: ADMIN_WRITES,
    queryFields: ["aiModel", "groupId", "requestType", "status", "sessionId"],
    sort: "-created",
  },
  {
    path: "/remoteAgents",
    model: RemoteAgent,
    permissions: ADMIN_WRITES,
    queryFields: ["status", "capabilities"],
    sort: "name",
  },
  {
    path: "/commandClassifications",
    model: CommandClassification,
    permissions: ADMIN_WRITES,
    queryFields: ["classification"],
    sort: "-priority",
  },
  {
    path: "/plugins",
    model: Plugin,
    permissions: ADMIN_WRITES,
    queryFields: ["enabled"],
    sort: "name",
  },
  {
    path: "/radioStreams",
    model: RadioStream,
    permissions: {
      create: [Permissions.IsAuthenticated],
      delete: [Permissions.IsAdmin],
      list: [Permissions.IsAuthenticated],
      read: [Permissions.IsAuthenticated],
      update: [Permissions.IsAuthenticated],
    },
    queryFields: ["status", "targetGroupId"],
    sort: "-created",
  },
  {
    path: "/webhookSources",
    model: WebhookSource,
    permissions: ADMIN_WRITES,
    queryFields: ["type", "groupId", "enabled", "classification"],
    sort: "name",
  },
  {
    path: "/movies",
    model: Movie,
    permissions: AUTHENTICATED_ALL,
    queryFields: ["title", "status"],
    sort: "-created",
  },
  {
    path: "/frames",
    model: Frame,
    permissions: AUTHENTICATED_ALL,
    queryFields: ["movieId", "status", "frameNumber"],
    sort: "timestamp",
  },
  {
    path: "/frameAnalyses",
    model: FrameAnalysis,
    permissions: AUTHENTICATED_ALL,
    queryFields: ["movieId", "frameId"],
    sort: "timestamp",
  },
  {
    path: "/characters",
    model: Character,
    permissions: AUTHENTICATED_ALL,
    queryFields: ["movieId", "name"],
    sort: "name",
  },
  {
    path: "/transcripts",
    model: Transcript,
    permissions: ADMIN_WRITES,
    queryFields: ["radioStreamId", "targetGroupId"],
    sort: "-created",
  },
  {
    path: "/calendar-configs",
    model: CalendarConfig,
    permissions: {
      create: [Permissions.IsAuthenticated],
      delete: [Permissions.IsOwner],
      list: [Permissions.IsAuthenticated],
      read: [Permissions.IsOwner],
      update: [Permissions.IsOwner],
    },
    queryFields: ["name", "owner"],
    sort: "name",
  },
  {
    path: "/app-configs",
    model: AppConfig,
    permissions: ADMIN_WRITES,
    queryFields: [],
    sort: "-created",
  },
];

export const crudRoutes: ModelRouterRegistration[] = descriptors.map(
  ({path, model, permissions, queryFields, sort}) =>
    modelRouter(path, model, {permissions, queryFields, sort, openApi: oapi})
);
