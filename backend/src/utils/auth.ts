import {APIError} from "@terreno/api";
import type {Request} from "express";
import type {UserDocument} from "../types";

/**
 * Returns the authenticated user on the request, or throws 401.
 *
 * Use after `authenticateMiddleware()` to narrow `req.user` to `UserDocument`
 * and eliminate the repeated cast + null-check boilerplate.
 */
export const requireUser = (req: Request): UserDocument => {
  const user = req.user as UserDocument | undefined;
  if (!user) {
    throw new APIError({status: 401, title: "Authentication required"});
  }
  return user;
};
