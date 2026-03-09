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
