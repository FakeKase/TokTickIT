import type { NextFunction, Request, Response } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { Role } from "../generated/prisma/enums.js";
import type { UserModel } from "../generated/prisma/models.js";
import { SESSION_COOKIE, resolveSession } from "../lib/session.js";

/** What every protected route reads instead of trusting the request body
 *  (BR-03). Populated only by requireAuth. */
export interface AuthenticatedRequest extends Request {
  auth?: { user: UserModel; sessionId: number };
}

type Db = Pick<PrismaClient, "session" | "user">;

export const UNAUTHENTICATED = { error: "Authentication required" };
export const FORBIDDEN = {
  error: "You do not have permission to perform this action",
};

/**
 * The single "who is asking?" seam. No route reads the cookie or looks up a
 * session itself, so there is exactly one place where "authenticated" is
 * defined and exactly one place to change it.
 */
export function requireAuth(db: Db) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) => {
    const auth = await resolveSession(db, req.cookies?.[SESSION_COOKIE]);
    if (!auth) return res.status(401).json(UNAUTHENTICATED);
    req.auth = auth;
    next();
  };
}

/**
 * BR-14. A user holding an initial password is authenticated but may reach
 * nothing except the three endpoints that let them fix that, so this sits
 * between requireAuth and everything else.
 *
 * The response carries a `code` because the client has to branch on it: a
 * plain 403 is a dead end, while PASSWORD_CHANGE_REQUIRED means "send them to
 * Change Password", which is a different screen from "you are not allowed
 * here".
 */
export function requirePasswordChanged(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  if (req.auth?.user.mustChangePassword) {
    return res.status(403).json({
      // Wording fixed by api-spec.md's Conventions section, which is what a
      // client is coded against.
      error: "Password change required",
      code: "PASSWORD_CHANGE_REQUIRED",
    });
  }
  next();
}

/**
 * specification.md §5.1. Roles are checked against a list rather than a single
 * value because the matrix grants several operations to both IT Staff and
 * Administrators.
 *
 * 403, never 404: the caller is known and the resource's existence is not the
 * secret being kept. Ownership is the opposite case and is handled per route
 * with a 404 (BR-18) — the two are deliberately different, and conflating them
 * would either leak ownership or hide a role mistake from the person who could
 * fix it.
 */
export function requireRole(...roles: Role[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json(UNAUTHENTICATED);
    if (!roles.includes(req.auth.user.role)) {
      return res.status(403).json(FORBIDDEN);
    }
    next();
  };
}

/** The response shape for a User, everywhere (api-spec.md "Conventions").
 *  One function so `passwordHash` cannot leak by being forgotten in a route
 *  that spreads the row. */
export const toIdentity = (user: UserModel) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  isActive: user.isActive,
  mustChangePassword: user.mustChangePassword,
  createdAt: user.createdAt,
});
