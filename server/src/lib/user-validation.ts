// BR-06, BR-13, BR-37: what an Administrator may write into a User
// (api-spec.md §15, §16).
//
// Create and edit share these rules and differ only in what is required, so
// one function serves both: `partial` means "validate what was sent" rather
// than "everything must be here".

import { PASSWORD_MAX_BYTES, PASSWORD_MIN, passwordBytes } from "./password.js";

export const NAME_MIN = 2;
export const NAME_MAX = 80;
export const EMAIL_MAX = 120;

export const ROLES = ["REQUESTER", "IT_STAFF", "ADMINISTRATOR"] as const;
export type RoleValue = (typeof ROLES)[number];

/** One `@`, something either side, a dot in the domain, no whitespace. This
 *  is "syntactically valid" (BR-37) and deliberately nothing more: whether the
 *  address receives mail is not something a pattern can know. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface UserInput {
  name?: unknown;
  email?: unknown;
  role?: unknown;
  isActive?: unknown;
  initialPassword?: unknown;
}

export interface UserFields {
  name?: string;
  email?: string;
  role?: RoleValue;
  isActive?: boolean;
}

export type UserValidation =
  | { ok: true; value: UserFields }
  | { ok: false; fields: Record<string, string> };

/** BR-13's two bounds, shared by create and by "set a new initial password".
 *  Returns the message, or null when the password is acceptable. */
export function initialPasswordProblem(raw: unknown): string | null {
  if (typeof raw !== "string" || raw === "") return "Enter an initial password";
  if (raw.length < PASSWORD_MIN) return `Must be at least ${PASSWORD_MIN} characters`;
  if (passwordBytes(raw) > PASSWORD_MAX_BYTES) {
    return `Must be at most ${PASSWORD_MAX_BYTES} bytes — about ${PASSWORD_MAX_BYTES} letters, fewer in scripts that use multi-byte characters`;
  }
  return null;
}

/**
 * Validates and normalises the editable fields of a User.
 *
 * With `partial` false every field is required (create). With it true only
 * the fields present are checked (edit), and one that is present must still
 * be valid: sending `name: ""` is an attempt to blank the name, not a request
 * to leave it alone.
 *
 * The email comes back trimmed and lower-cased (BR-06). Login lower-cases
 * what it is given before looking a user up, so an address stored in any
 * other case would belong to an account nobody could sign in to.
 */
export function validateUser(input: UserInput, partial: boolean): UserValidation {
  const fields: Record<string, string> = {};
  const value: UserFields = {};
  const sent = (key: keyof UserInput) => !partial || input[key] !== undefined;

  if (sent("name")) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) fields.name = "Enter a name";
    else if (name.length < NAME_MIN) fields.name = `Must be at least ${NAME_MIN} characters`;
    else if (name.length > NAME_MAX) fields.name = `Must be at most ${NAME_MAX} characters`;
    else value.name = name;
  }

  if (sent("email")) {
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    if (!email) fields.email = "Enter an email address";
    else if (email.length > EMAIL_MAX) fields.email = `Must be at most ${EMAIL_MAX} characters`;
    else if (!EMAIL_SHAPE.test(email)) fields.email = "Enter a valid email address";
    else value.email = email;
  }

  if (sent("role")) {
    const role = ROLES.find((candidate) => candidate === input.role);
    if (!role) fields.role = "Choose a role";
    else value.role = role;
  }

  // Optional even on create, where it defaults to active. But if it is sent
  // it must be a real boolean: "false" is a truthy string, and treating it as
  // one would activate the account the caller meant to switch off.
  if (input.isActive !== undefined) {
    if (typeof input.isActive !== "boolean") fields.isActive = "Active must be true or false";
    else value.isActive = input.isActive;
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value };
}
