import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  hashPassword,
  validatePasswordChange,
  verifyPassword,
} from "../../src/lib/password.js";

// UNIT-01 (BR-07) and UNIT-04 (BR-13).

describe("UNIT-01 password hashing", () => {
  it("never stores the plaintext, and verifies only the right password", async () => {
    const hash = await hashPassword("Fixture123!");

    expect(hash).not.toContain("Fixture123!");
    expect(hash).toMatch(/^\$2[aby]\$10\$/); // bcrypt, cost 10
    expect(await verifyPassword("Fixture123!", hash)).toBe(true);
    expect(await verifyPassword("fixture123!", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("salts, so the same password hashed twice gives two different hashes", async () => {
    const [a, b] = await Promise.all([
      hashPassword("Fixture123!"),
      hashPassword("Fixture123!"),
    ]);

    expect(a).not.toBe(b);
    // Both still verify: the salt lives in the hash, not beside it.
    expect(await verifyPassword("Fixture123!", a)).toBe(true);
    expect(await verifyPassword("Fixture123!", b)).toBe(true);
  });
});

describe("UNIT-04 validatePasswordChange (BR-13)", () => {
  const valid = {
    currentPassword: "Fixture123!",
    newPassword: "Replacement1!",
    confirmPassword: "Replacement1!",
  };

  it("accepts a valid change", () => {
    const result = validatePasswordChange(valid);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.newPassword).toBe("Replacement1!");
    }
  });

  it("requires every field", () => {
    const result = validatePasswordChange({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.fields).sort()).toEqual([
        "confirmPassword",
        "currentPassword",
        "newPassword",
      ]);
    }
  });

  it(`enforces the ${PASSWORD_MIN}-${PASSWORD_MAX} character bounds`, () => {
    const short = "A".repeat(PASSWORD_MIN - 1);
    const long = "A".repeat(PASSWORD_MAX + 1);

    for (const newPassword of [short, long]) {
      const result = validatePasswordChange({
        ...valid,
        newPassword,
        confirmPassword: newPassword,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fields.newPassword).toBeTruthy();
    }

    // The bounds themselves are allowed, not just the inside of the range.
    for (const length of [PASSWORD_MIN, PASSWORD_MAX]) {
      const newPassword = "A".repeat(length);
      const result = validatePasswordChange({
        ...valid,
        newPassword,
        confirmPassword: newPassword,
      });
      expect(result.ok).toBe(true);
    }
  });

  it("attaches a confirmation mismatch to the confirmation field", () => {
    const result = validatePasswordChange({
      ...valid,
      confirmPassword: "Replacement2!",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields.confirmPassword).toBeTruthy();
      // Not on newPassword: the user probably typed that one correctly, and
      // marking it would send them to re-type the wrong field (ui-spec §1.2).
      expect(result.fields.newPassword).toBeUndefined();
    }
  });

  it("rejects re-entering the current password, even though it is otherwise valid", () => {
    const result = validatePasswordChange({
      currentPassword: "Fixture123!",
      newPassword: "Fixture123!",
      confirmPassword: "Fixture123!",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fields.newPassword).toBeTruthy();
  });
});
