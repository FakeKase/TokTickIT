import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX_BYTES,
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

  const check = (newPassword: string) =>
    validatePasswordChange({ ...valid, newPassword, confirmPassword: newPassword });

  it(`enforces ${PASSWORD_MIN} characters minimum and ${PASSWORD_MAX_BYTES} bytes maximum`, () => {
    expect(check("A".repeat(PASSWORD_MIN - 1)).ok).toBe(false);
    expect(check("A".repeat(PASSWORD_MAX_BYTES + 1)).ok).toBe(false);

    // The bounds themselves are allowed, not just the inside of the range.
    expect(check("A".repeat(PASSWORD_MIN)).ok).toBe(true);
    expect(check("A".repeat(PASSWORD_MAX_BYTES)).ok).toBe(true);
  });

  it("measures the maximum in bytes, because bcrypt truncates in bytes", () => {
    // 72 Thai characters are 216 bytes. Counted with `.length` this passes a
    // 72-"character" limit, bcrypt silently keeps the first 72 bytes, and two
    // different passwords can then unlock the same account.
    const thai = "ก".repeat(PASSWORD_MAX_BYTES);
    expect(thai.length).toBe(PASSWORD_MAX_BYTES);
    expect(Buffer.byteLength(thai, "utf8")).toBeGreaterThan(PASSWORD_MAX_BYTES);
    expect(check(thai).ok).toBe(false);

    // 24 of them is exactly 72 bytes, and allowed.
    const atTheLimit = "ก".repeat(PASSWORD_MAX_BYTES / 3);
    expect(Buffer.byteLength(atTheLimit, "utf8")).toBe(PASSWORD_MAX_BYTES);
    expect(check(atTheLimit).ok).toBe(true);

    // An emoji is the same trap from the other direction: `.length` counts the
    // surrogate pair as 2 while bcrypt sees 4 bytes.
    const emoji = "🔒".repeat(19); // 76 bytes, 38 UTF-16 units
    expect(emoji.length).toBeLessThan(PASSWORD_MAX_BYTES);
    expect(check(emoji).ok).toBe(false);
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
