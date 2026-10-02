import request from "supertest";
import type { Response } from "supertest";
import type { Express } from "express";
import { SESSION_COOKIE } from "../../src/lib/session.js";
import { FIXTURE_PASSWORD } from "./users.js";

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

/**
 * Signs a fixture user in and returns the cookie header for later requests.
 *
 * Through the real login endpoint rather than by inserting a Session row: the
 * tests that use this are proving ownership rules, and a session built by hand
 * would prove them against a session shape no browser ever gets.
 */
export async function signInAs(
  app: Express,
  email: string,
  password: string = FIXTURE_PASSWORD,
): Promise<string> {
  const response = await request(app)
    .post("/api/auth/login")
    .send({ email, password });

  if (response.status !== 200) {
    throw new Error(
      `could not sign in as ${email}: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
  return requireSessionCookie(response);
}
