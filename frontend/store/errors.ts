import type {Middleware} from "@reduxjs/toolkit";

const IGNORED_ERRORS = [
  "Password or username is incorrect",
  "Token refresh failed with 401",
  "Failed to refresh token",
];

export const rtkQueryErrorMiddleware: Middleware = () => (next) => (action: any) => {
  if (action?.error && action?.payload) {
    const errorMessage =
      action.payload?.data?.title ??
      action.payload?.data?.message ??
      action.payload?.error ??
      JSON.stringify(action.payload);

    let endpointInfo = "unknown endpoint";
    if (action.meta?.baseQueryMeta?.request?.method && action.meta?.baseQueryMeta?.request?.url) {
      endpointInfo = `${action.meta.baseQueryMeta.request.url} ${action.meta.baseQueryMeta.request.method}`;
    } else if (action.meta?.arg?.endpointName) {
      endpointInfo = `${action.meta.arg.endpointName} rejected ${action.meta.arg.type || ""}`;
    }

    const message = `${endpointInfo.trim()}: ${errorMessage}`;
    console.debug(message);

    if (action.payload.status === 404 || action.payload.status === 401) {
      return next(action);
    }

    const shouldIgnore = IGNORED_ERRORS.some((err) => errorMessage.includes(err));
    if (!shouldIgnore) {
      console.warn(message);
    }
  }

  return next(action);
};
