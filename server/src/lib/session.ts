import { createHash, randomBytes } from "node:crypto";
import type { CookieOptions, Response } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { UserModel } from "../generated/prisma/models.js";

/** api-spec.md "Session mechanism". */
export const SESSION_COOKIE = "tt_session";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // BR-09: 8h absolute, no sliding renewal

/** Anything that can run a query: the real client, or a transaction client. */
type Db = Pick<PrismaClient, "session" | "user">;

/** sha256, not bcrypt. Every authenticated request looks a session up by exact
 *  value, and a deliberately slow hash cannot be looked up — only compared,
 *  one row at a time. There is also nothing here to brute-force: the token is
 *  32 bytes of CSPRNG output, not a password someone chose. */
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export const sessionCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
});

/**
 * Creates the row and returns the raw token, which is the only place it ever
 * exists outside the cookie. Deliberately does **not** touch the response: a
 * caller inside a transaction must not hand the client a cookie for a row that
 * can still roll back, so setting it is a separate, post-commit step.
 */
export async function createSession(db: Db, userId: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return token;
}

export const setSessionCookie = (res: Response, token: string) =>
  res.cookie(SESSION_COOKIE, token, {
    ...sessionCookieOptions(),
    maxAge: SESSION_TTL_MS,
  });

export const clearSessionCookie = (res: Response) =>
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions());

/**
 * Resolves a token to its user, or null.
 *
 * Three separate reasons produce null, and the caller is told none of them
 * (BR-10, BR-11, BR-12): no row, an expired row, or a row whose user has since
 * been deactivated. An expired row is deleted on the way past — the cheapest
 * possible cleanup, on a path that has already paid for the lookup.
 */
export async function resolveSession(
  db: Db,
  token: string | undefined,
): Promise<{ user: UserModel; sessionId: number } | null> {
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session) return null;

  if (session.expiresAt <= new Date()) {
    // deleteMany, not delete: a concurrent request may have collected this row
    // already, and that is not an error. It still throws if the database itself
    // is failing, which is.
    await db.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  if (!session.user.isActive) return null;

  return { user: session.user, sessionId: session.id };
}

/**
 * Destroys the session a token belongs to, whether or not that session would
 * currently resolve: an expired row, or one whose user has been deactivated,
 * still gets collected.
 *
 * deleteMany so logging out twice is a no-op rather than an exception, while a
 * genuine database failure still surfaces - swallowing that would let logout
 * answer 204 with the session still alive.
 */
export const deleteSessionByToken = (db: Db, token: string) =>
  db.session.deleteMany({ where: { tokenHash: hashToken(token) } });

/** BR-36: used when an Administrator issues a new initial password, and by a
 *  password change, so a token captured before the change dies with it. */
export const deleteUserSessions = (db: Db, userId: number) =>
  db.session.deleteMany({ where: { userId } });
