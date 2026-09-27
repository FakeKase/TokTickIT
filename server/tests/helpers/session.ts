import type { Response } from "supertest";
import { SESSION_COOKIE } from "../../src/lib/session.js";

/**
 * The session cookie from a response, as a `name=value` string ready to hand
 * back via `.set("Cookie", ...)`, or undefined when none was sent.
 *
 * Supertest types `headers` as a loose record, and `set-cookie` is the one
 * header that is an array, so the cast lives here once instead of in every
 * test that needs a cookie.
 */
export function sessionCookie(response: Response): string | undefined {
  return setCookieHeader(response)?.split(";")[0];
}

/** The whole Set-Cookie header, attributes included — what a test asserting
 *  HttpOnly or SameSite needs, and what `sessionCookie` deliberately trims. */
export function setCookieHeader(response: Response): string | undefined {
  const raw = response.headers["set-cookie"] as unknown as string[] | undefined;
  return raw?.find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
}

/** The same, for a test that needs the cookie to exist to be meaningful. */
export function requireSessionCookie(response: Response): string {
  const cookie = sessionCookie(response);
  if (!cookie) throw new Error("expected a session cookie, got none");
  return cookie;
}

/** The raw token inside the cookie — what a browser holds, and what the
 *  database must never contain. */
export const tokenFrom = (cookie: string) => cookie.split("=")[1];
