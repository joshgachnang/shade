import {generateTags} from "@terreno/rtk";
import startCase from "lodash/startCase";

import {addTagTypes, openapi} from "./openApiSdk";

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
    }),
  })
  .enhanceEndpoints({
    addTagTypes: ["profile"],
    endpoints: {
      ...generateTags(openapi, [...addTagTypes]),
    },
  });

export const {useEmailLoginMutation, useEmailSignUpMutation, useGetMeQuery, usePatchMeMutation} =
  terrenoApi;
export * from "./openApiSdk";

interface OpenApiEndpoints extends Record<string, unknown> {}

export const getSdkHook = ({
  modelName,
  type,
}: {
  modelName: string;
  type: "list" | "read" | "create" | "update" | "remove";
}): Record<string, unknown> => {
  const modelPath = startCase(modelName).replace(/\s/g, "");
  const endpoints = openapi.endpoints as OpenApiEndpoints;
  switch (type) {
    case "list":
      return endpoints[`get${modelPath}`] as Record<string, unknown>;
    case "read":
      return endpoints[`get${modelPath}ById`] as Record<string, unknown>;
    case "create":
      return endpoints[`post${modelPath}`] as Record<string, unknown>;
    case "update":
      return endpoints[`patch${modelPath}ById`] as Record<string, unknown>;
    case "remove":
      return endpoints[`delete${modelPath}ById`] as Record<string, unknown>;
    default:
      throw new Error(`Invalid SDK hook: ${modelName}/${type}`);
  }
};
