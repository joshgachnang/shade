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

interface ListResponse<T> {
  results: T[];
  count: number;
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
    }),
  })
  .enhanceEndpoints({
    addTagTypes: ["profile", "Movies"],
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
} = terrenoApi;
export * from "./openApiSdk";
