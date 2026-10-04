import type { Role } from "../../src/generated/prisma/enums.js";

/**
 * Fixture credentials shared by every test that needs a User row.
 *
 * The hash is a constant rather than a `bcrypt.hashSync` call: hashing at cost
 * 10 costs ~60ms, and a suite that creates dozens of fixture users would spend
 * seconds proving nothing. It is a real cost-10 hash of FIXTURE_PASSWORD, so
 * the authentication tests can still log in with it.
 */
export const FIXTURE_PASSWORD = "Fixture123!";
export const FIXTURE_HASH =
  "$2b$10$o7hqjIKYAYTeqvgXYHN.K.jSYOREfdUMFN415SeAEstuEDY9bbp4q";

export interface FixtureUserOverrides {
  name: string;
  email: string;
  role?: Role;
  isActive?: boolean;
  mustChangePassword?: boolean;
}

/**
 * The `data` block for a fixture User. Defaults to an onboarded Requester,
 * because that is the identity almost every Lab 2 regression test is asserting
 * about; a test that cares about the first-login gate sets the flag itself.
 */
export function fixtureUser(overrides: FixtureUserOverrides) {
  return {
    name: overrides.name,
    email: overrides.email,
    passwordHash: FIXTURE_HASH,
    role: overrides.role ?? ("REQUESTER" as Role),
    isActive: overrides.isActive ?? true,
    mustChangePassword: overrides.mustChangePassword ?? false,
  };
}
