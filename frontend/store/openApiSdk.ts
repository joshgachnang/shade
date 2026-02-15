// THIS FILE IS AUTO-GENERATED. DO NOT EDIT.
// Run "bun run sdk" to regenerate this file from the backend OpenAPI spec.

import {emptySplitApi as api} from "@terreno/rtk";
export const addTagTypes = ["Users", "Auth"] as const;
const injectedRtkApi = api
  .enhanceEndpoints({
    addTagTypes,
  })
  .injectEndpoints({
    endpoints: (build) => ({
      emailLogin: build.mutation<EmailLoginRes, EmailLoginArgs>({
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/auth/login`,
        }),
      }),
      emailSignUp: build.mutation<EmailSignUpRes, EmailSignUpArgs>({
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/auth/signup`,
        }),
      }),
    }),
    overrideExisting: false,
  });
export {injectedRtkApi as openapi};
export type EmailLoginArgs = {
  email: string;
  password: string;
};
export type EmailLoginRes = {
  token: string;
  refreshToken: string;
  userId: string;
};
export type EmailSignUpArgs = {
  email: string;
  password: string;
  name: string;
};
export type EmailSignUpRes = {
  token: string;
  refreshToken: string;
  userId: string;
};
export const {useEmailLoginMutation, useEmailSignUpMutation} = injectedRtkApi;
