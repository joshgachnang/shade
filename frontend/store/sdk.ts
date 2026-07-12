import {generateTags} from "@terreno/rtk";

import {addTagTypes, openapi} from "./openApiSdk";

export interface ApiErrorResponse {
  status: number;
  data?: {
    title?: string;
    message?: string;
  };
}

export interface ProfileResponse {
  data: {
    _id: string;
    id: string;
    admin: boolean;
    email: string;
    name: string;
  };
}

export interface UpdateProfileRequest {
  name?: string;
  email?: string;
  password?: string;
}

// Movie types
export interface Movie {
  _id: string;
  id: string;
  title: string;
  filePath: string;
  duration: number;
  fps: number;
  resolution: {width: number; height: number};
  frameCount: number;
  processedFrameCount: number;
  status: "pending" | "extracting" | "analyzing" | "complete" | "error";
  errorMessage?: string;
  actors: string[];
  extractionConfig: {
    mode: "scene-change" | "interval" | "every-frame";
    intervalSeconds?: number;
    sceneThreshold?: number;
  };
  openRouterModel: string;
  created: string;
  updated: string;
}

export interface Frame {
  _id: string;
  id: string;
  movieId: string;
  frameNumber: number;
  timestamp: number;
  imagePath: string;
  width: number;
  height: number;
  fileSizeBytes: number;
  status: "pending" | "analyzing" | "complete" | "error";
}

export interface FrameAnalysis {
  _id: string;
  id: string;
  frameId: string;
  movieId: string;
  timestamp: number;
  sceneDescription: string;
  objects: Array<{label: string; confidence: number}>;
  characters: Array<{name: string; description: string; confidence: number}>;
  text: Array<{content: string; context: string}>;
  tags: string[];
  mood: string;
  modelUsed: string;
  tokensUsed: number;
  frame?: {imagePath: string; frameNumber: number};
}

export interface Character {
  _id: string;
  id: string;
  movieId: string;
  name: string;
  actorName?: string;
  firstSeen: number;
  lastSeen: number;
  totalAppearances: number;
  appearances: Array<{frameId: string; timestamp: number; description: string}>;
}

export interface MovieProgress {
  status: string;
  totalFrames: number;
  processedFrames: number;
  percentage: number;
  currentPhase: string;
}

export interface SearchResult {
  query: string;
  type: string;
  count: number;
  results: Array<FrameAnalysis & {score: number}>;
}

export interface SearchSuggestions {
  suggestions: string[];
}

// Rich response (IP-005) — kept loose; the backend Zod schema is the source of truth.
export interface PreviewCardRequest {
  v: string;
  cards: Array<Record<string, unknown>>;
  fallbackText: string;
}

export interface PreviewCardResponse {
  slackBlocks: Array<Record<string, unknown>> | null;
  fallbackText: string | null;
  validation: Array<Record<string, unknown>> | null;
}

export interface MessageRichResponse {
  message: Record<string, unknown>;
  richPayload: Record<string, unknown> | null;
  slackBlocks: Array<Record<string, unknown>> | null;
}

// Feature types
export interface FeatureStep {
  _id: string;
  name: string;
  description?: string;
  order: number;
  status: "pending" | "in_progress" | "complete" | "error" | "skipped";
  startedAt?: string;
  completedAt?: string;
  result?: string;
  errorMessage?: string;
}

export interface Feature {
  _id: string;
  id: string;
  name: string;
  description?: string;
  groupId?: string;
  status: "planned" | "in_progress" | "paused" | "complete" | "error";
  steps: FeatureStep[];
  currentStepIndex: number;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
  created: string;
  updated: string;
}

export interface FeatureProgress {
  status: string;
  totalSteps: number;
  completedSteps: number;
  percentage: number;
  currentStepIndex: number;
  currentStepName: string | null;
  currentStepStatus: string | null;
}

interface ListResponse<T> {
  results: T[];
  count: number;
}

// Edge Agent types
export interface EdgeAgent {
  _id: string;
  id: string;
  name: string;
  agentType: string;
  status: "pending" | "approved" | "online" | "offline" | "error";
  platform?: "darwin" | "linux" | "windows";
  arch?: string;
  version?: string;
  hostname?: string;
  lastHeartbeatAt?: string;
  config: Record<string, unknown>;
  secrets: Record<string, unknown>;
  capabilities: string[];
  channelId?: string;
  approvedAt?: string;
  approvedBy?: string;
  pendingCommands: Array<{
    commandId: string;
    type: string;
    payload: Record<string, unknown>;
    queuedAt: string;
  }>;
  lastCommandResults: Array<{
    commandId: string;
    success: boolean;
    error?: string;
    completedAt?: string;
  }>;
  created: string;
  updated: string;
}

export interface EdgeAgentEvent {
  _id: string;
  id: string;
  agentId: string;
  eventType: string;
  payload: Record<string, unknown>;
  created: string;
}

// Apple Reminders / Calendar types (synced from the Mac by the edge agent)
export interface ReminderList {
  _id: string;
  externalId: string;
  name: string;
  description?: string;
  isDefault: boolean;
  lastSyncedAt?: string;
}

export interface Reminder {
  _id: string;
  externalId: string;
  title: string;
  notes?: string;
  dueDate?: string;
  priority: number;
  completed: boolean;
  completedAt?: string;
  listName: string;
  listExternalId: string;
  syncStatus: "active" | "removed";
  lastSyncedAt?: string;
}

export interface AppleCalendar {
  _id: string;
  externalId: string;
  name: string;
  description?: string;
  isDefault: boolean;
  writable: boolean;
  lastSyncedAt?: string;
}

export interface CalendarEvent {
  _id: string;
  externalId: string;
  title: string;
  notes?: string;
  location?: string;
  url?: string;
  status?: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  calendarName: string;
  calendarExternalId: string;
  syncStatus: "active" | "removed";
  lastSyncedAt?: string;
}

export interface QueuedAppleCommand {
  data: {commandId: string; agentName?: string; reminderId?: string};
}

export interface CreateReminderRequest {
  title: string;
  listName?: string;
  notes?: string;
  dueDate?: string;
  priority?: number;
}

export interface CreateCalendarEventRequest {
  title: string;
  calendarName?: string;
  startDate: string;
  endDate: string;
  allDay?: boolean;
  location?: string;
  notes?: string;
}

export const terrenoApi = openapi
  .injectEndpoints({
    endpoints: (builder) => ({
      getMe: builder.query<ProfileResponse, void>({
        providesTags: ["profile" as any],
        query: () => ({
          method: "GET",
          url: "/auth/me",
        }),
      }),
      patchMe: builder.mutation<ProfileResponse, UpdateProfileRequest>({
        invalidatesTags: ["profile" as any],
        query: (body) => ({
          body,
          method: "PATCH",
          url: "/auth/me",
        }),
      }),
      // Movie endpoints
      listMovies: builder.query<ListResponse<Movie>, void>({
        providesTags: ["Movies" as any],
        query: () => ({url: "/movies"}),
      }),
      getMovie: builder.query<Movie, string>({
        providesTags: (_result, _err, id) => [{type: "Movies" as any, id}],
        query: (id) => ({url: `/movies/${id}`}),
      }),
      createMovie: builder.mutation<Movie, Partial<Movie>>({
        invalidatesTags: ["Movies" as any],
        query: (body) => ({body, method: "POST", url: "/movies"}),
      }),
      updateMovie: builder.mutation<Movie, {id: string; body: Partial<Movie>}>({
        invalidatesTags: (_result, _err, {id}) => [{type: "Movies" as any, id}],
        query: ({id, body}) => ({body, method: "PATCH", url: `/movies/${id}`}),
      }),
      processMovie: builder.mutation<{movieId: string; status: string}, string>({
        invalidatesTags: (_result, _err, id) => [{type: "Movies" as any, id}],
        query: (id) => ({method: "POST", url: `/movie-actions/${id}/process`}),
      }),
      cancelMovie: builder.mutation<{movieId: string; status: string}, string>({
        invalidatesTags: (_result, _err, id) => [{type: "Movies" as any, id}],
        query: (id) => ({method: "POST", url: `/movie-actions/${id}/cancel`}),
      }),
      getMovieProgress: builder.query<MovieProgress, string>({
        query: (id) => ({url: `/movie-actions/${id}/progress`}),
      }),
      getMovieTimeline: builder.query<
        FrameAnalysis[],
        {id: string; character?: string; object?: string}
      >({
        query: ({id, character, object}) => {
          const params = new URLSearchParams();
          if (character) {
            params.set("character", character);
          }
          if (object) {
            params.set("object", object);
          }
          const qs = params.toString();
          return {url: `/movie-actions/${id}/timeline${qs ? `?${qs}` : ""}`};
        },
      }),
      // Frame endpoints
      listFrames: builder.query<ListResponse<Frame>, {movieId: string}>({
        query: ({movieId}) => ({url: `/frames?movieId=${movieId}`}),
      }),
      getFrame: builder.query<Frame, string>({
        query: (id) => ({url: `/frames/${id}`}),
      }),
      // Frame Analysis endpoints
      getFrameAnalysis: builder.query<ListResponse<FrameAnalysis>, {frameId: string}>({
        query: ({frameId}) => ({url: `/frameAnalyses?frameId=${frameId}`}),
      }),
      // Character endpoints
      listCharacters: builder.query<ListResponse<Character>, {movieId: string}>({
        query: ({movieId}) => ({url: `/characters?movieId=${movieId}`}),
      }),
      // Feature endpoints
      listFeatures: builder.query<ListResponse<Feature>, {status?: string} | undefined>({
        providesTags: ["Features" as any],
        query: (args) => {
          const params = new URLSearchParams();
          if (args && "status" in args && args.status) {
            params.set("status", args.status);
          }
          const qs = params.toString();
          return {url: `/features${qs ? `?${qs}` : ""}`};
        },
      }),
      getFeature: builder.query<Feature, string>({
        providesTags: (_result, _err, id) => [{type: "Features" as any, id}],
        query: (id) => ({url: `/features/${id}`}),
      }),
      createFeature: builder.mutation<Feature, Partial<Feature>>({
        invalidatesTags: ["Features" as any],
        query: (body) => ({body, method: "POST", url: "/features"}),
      }),
      updateFeature: builder.mutation<Feature, {id: string; body: Partial<Feature>}>({
        invalidatesTags: (_result, _err, {id}) => [
          {type: "Features" as any, id},
          "Features" as any,
        ],
        query: ({id, body}) => ({body, method: "PATCH", url: `/features/${id}`}),
      }),
      resumeFeature: builder.mutation<Feature, string>({
        invalidatesTags: (_result, _err, id) => [{type: "Features" as any, id}, "Features" as any],
        query: (id) => ({method: "POST", url: `/feature-actions/${id}/resume`}),
      }),
      pauseFeature: builder.mutation<Feature, string>({
        invalidatesTags: (_result, _err, id) => [{type: "Features" as any, id}, "Features" as any],
        query: (id) => ({method: "POST", url: `/feature-actions/${id}/pause`}),
      }),
      startFeatureStep: builder.mutation<Feature, {id: string; stepIndex?: number}>({
        invalidatesTags: (_result, _err, {id}) => [{type: "Features" as any, id}],
        query: ({id, stepIndex}) => ({
          body: stepIndex !== undefined ? {stepIndex} : {},
          method: "POST",
          url: `/feature-actions/${id}/start-step`,
        }),
      }),
      completeFeatureStep: builder.mutation<
        Feature,
        {id: string; stepIndex?: number; result?: string}
      >({
        invalidatesTags: (_result, _err, {id}) => [{type: "Features" as any, id}],
        query: ({id, stepIndex, result}) => ({
          body: {stepIndex, result},
          method: "POST",
          url: `/feature-actions/${id}/complete-step`,
        }),
      }),
      failFeatureStep: builder.mutation<
        Feature,
        {id: string; stepIndex?: number; errorMessage?: string}
      >({
        invalidatesTags: (_result, _err, {id}) => [{type: "Features" as any, id}],
        query: ({id, stepIndex, errorMessage}) => ({
          body: {stepIndex, errorMessage},
          method: "POST",
          url: `/feature-actions/${id}/fail-step`,
        }),
      }),
      getFeatureProgress: builder.query<FeatureProgress, string>({
        query: (id) => ({url: `/feature-actions/${id}/progress`}),
      }),
      listResumableFeatures: builder.query<ListResponse<Feature>, void>({
        query: () => ({url: "/feature-actions/resumable"}),
      }),
      // Search endpoints
      search: builder.query<SearchResult, {q: string; movieId?: string; type?: string}>({
        query: ({q, movieId, type}) => {
          const params = new URLSearchParams({q});
          if (movieId) {
            params.set("movieId", movieId);
          }
          if (type) {
            params.set("type", type);
          }
          return {url: `/search?${params.toString()}`};
        },
      }),
      searchSuggest: builder.query<SearchSuggestions, string>({
        query: (q) => ({url: `/search/suggest?q=${encodeURIComponent(q)}`}),
      }),
      // Edge Agent endpoints
      listEdgeAgents: builder.query<
        ListResponse<EdgeAgent>,
        {status?: string; agentType?: string} | undefined
      >({
        providesTags: ["EdgeAgents" as any],
        query: (params) => {
          const qs = new URLSearchParams();
          if (params?.status) {
            qs.set("status", params.status);
          }
          if (params?.agentType) {
            qs.set("agentType", params.agentType);
          }
          const q = qs.toString();
          return {url: `/edgeAgents${q ? `?${q}` : ""}`};
        },
      }),
      getEdgeAgent: builder.query<EdgeAgent, string>({
        providesTags: (_result, _err, id) => [{type: "EdgeAgents" as any, id}],
        query: (id) => ({url: `/edgeAgents/${id}`}),
      }),
      updateEdgeAgent: builder.mutation<EdgeAgent, {id: string; body: Partial<EdgeAgent>}>({
        invalidatesTags: (_result, _err, {id}) => [
          {type: "EdgeAgents" as any, id},
          "EdgeAgents" as any,
        ],
        query: ({id, body}) => ({body, method: "PATCH", url: `/edgeAgents/${id}`}),
      }),
      approveEdgeAgent: builder.mutation<{status: string}, string>({
        invalidatesTags: (_result, _err, id) => [
          {type: "EdgeAgents" as any, id},
          "EdgeAgents" as any,
        ],
        query: (id) => ({method: "POST", url: `/api/edge/agents/${id}/approve`}),
      }),
      revokeEdgeAgent: builder.mutation<{status: string}, string>({
        invalidatesTags: (_result, _err, id) => [
          {type: "EdgeAgents" as any, id},
          "EdgeAgents" as any,
        ],
        query: (id) => ({method: "POST", url: `/api/edge/agents/${id}/revoke`}),
      }),
      sendEdgeAgentCommand: builder.mutation<
        {commandId: string},
        {id: string; type: string; payload: Record<string, unknown>}
      >({
        invalidatesTags: (_result, _err, {id}) => [{type: "EdgeAgents" as any, id}],
        query: ({id, ...body}) => ({body, method: "POST", url: `/api/edge/agents/${id}/command`}),
      }),
      listEdgeAgentEvents: builder.query<ListResponse<EdgeAgentEvent>, {agentId: string}>({
        providesTags: ["EdgeAgentEvents" as any],
        query: ({agentId}) => ({url: `/edgeAgentEvents?agentId=${agentId}`}),
      }),
      // Apple Reminders endpoints. Reads come from the synced Mongo models;
      // mutations go through /apple/* actions, which queue edge-agent commands.
      listReminderLists: builder.query<ListResponse<ReminderList>, void>({
        providesTags: ["Reminders" as any],
        query: () => ({url: "/reminderLists?limit=100"}),
      }),
      listReminders: builder.query<
        ListResponse<Reminder>,
        {listName?: string; completed?: boolean} | undefined
      >({
        providesTags: ["Reminders" as any],
        query: (args) => {
          const params = new URLSearchParams({syncStatus: "active", limit: "250"});
          if (args?.listName) {
            params.set("listName", args.listName);
          }
          if (args?.completed !== undefined) {
            params.set("completed", String(args.completed));
          }
          return {url: `/reminders?${params.toString()}`};
        },
      }),
      createReminder: builder.mutation<QueuedAppleCommand, CreateReminderRequest>({
        invalidatesTags: ["Reminders" as any],
        query: (body) => ({body, method: "POST", url: "/apple/reminders"}),
      }),
      completeReminder: builder.mutation<QueuedAppleCommand, string>({
        invalidatesTags: ["Reminders" as any],
        query: (id) => ({method: "POST", url: `/apple/reminders/${id}/complete`}),
      }),
      removeReminder: builder.mutation<QueuedAppleCommand, string>({
        invalidatesTags: ["Reminders" as any],
        query: (id) => ({method: "POST", url: `/apple/reminders/${id}/remove`}),
      }),
      // Apple Calendar endpoints
      listAppleCalendars: builder.query<ListResponse<AppleCalendar>, void>({
        providesTags: ["CalendarEvents" as any],
        query: () => ({url: "/appleCalendars?limit=100"}),
      }),
      listCalendarEvents: builder.query<
        ListResponse<CalendarEvent>,
        {calendarName?: string} | undefined
      >({
        providesTags: ["CalendarEvents" as any],
        query: (args) => {
          const params = new URLSearchParams({syncStatus: "active", limit: "500"});
          if (args?.calendarName) {
            params.set("calendarName", args.calendarName);
          }
          return {url: `/calendarEvents?${params.toString()}`};
        },
      }),
      createCalendarEvent: builder.mutation<QueuedAppleCommand, CreateCalendarEventRequest>({
        invalidatesTags: ["CalendarEvents" as any],
        query: (body) => ({body, method: "POST", url: "/apple/calendar-events"}),
      }),
      appleSyncNow: builder.mutation<QueuedAppleCommand, void>({
        invalidatesTags: ["Reminders" as any, "CalendarEvents" as any],
        query: () => ({method: "POST", url: "/apple/sync"}),
      }),
      // Rich-response admin endpoints (IP-005).
      previewCard: builder.mutation<PreviewCardResponse, PreviewCardRequest>({
        query: (body) => ({body, method: "POST", url: "/orchestrator/preview-card"}),
      }),
      getMessageRich: builder.query<MessageRichResponse, string>({
        query: (id) => ({url: `/orchestrator/messages/${id}/rich`}),
      }),
    }),
  })
  .enhanceEndpoints({
    addTagTypes: [
      "profile",
      "Movies",
      "EdgeAgents",
      "EdgeAgentEvents",
      "Features",
      "Reminders",
      "CalendarEvents",
    ],
    endpoints: {
      ...generateTags(openapi, [...addTagTypes]),
    },
  });

export const {
  useEmailLoginMutation,
  useEmailSignUpMutation,
  useGetMeQuery,
  usePatchMeMutation,
  useListMoviesQuery,
  useGetMovieQuery,
  useCreateMovieMutation,
  useUpdateMovieMutation,
  useProcessMovieMutation,
  useCancelMovieMutation,
  useGetMovieProgressQuery,
  useGetMovieTimelineQuery,
  useListFramesQuery,
  useGetFrameQuery,
  useGetFrameAnalysisQuery,
  useListCharactersQuery,
  useSearchQuery,
  useSearchSuggestQuery,
  useListEdgeAgentsQuery,
  useGetEdgeAgentQuery,
  useUpdateEdgeAgentMutation,
  useApproveEdgeAgentMutation,
  useRevokeEdgeAgentMutation,
  useSendEdgeAgentCommandMutation,
  useListEdgeAgentEventsQuery,
  useListFeaturesQuery,
  useGetFeatureQuery,
  useCreateFeatureMutation,
  useUpdateFeatureMutation,
  useResumeFeatureMutation,
  usePauseFeatureMutation,
  useStartFeatureStepMutation,
  useCompleteFeatureStepMutation,
  useFailFeatureStepMutation,
  useGetFeatureProgressQuery,
  useListResumableFeaturesQuery,
  usePreviewCardMutation,
  useGetMessageRichQuery,
  useListReminderListsQuery,
  useListRemindersQuery,
  useCreateReminderMutation,
  useCompleteReminderMutation,
  useRemoveReminderMutation,
  useListAppleCalendarsQuery,
  useListCalendarEventsQuery,
  useCreateCalendarEventMutation,
  useAppleSyncNowMutation,
} = terrenoApi;
export * from "./openApiSdk";
