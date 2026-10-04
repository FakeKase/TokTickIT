import { describe, expect, it } from "vitest";
import {
  initialPasswordProblem,
  validateUser,
} from "../../src/lib/user-validation.js";

// UNIT-06 (BR-06, BR-13, BR-37).

const VALID = {
  name: "Jane Doe",
  email: "jane.doe@toktickit.test",
  role: "IT_STAFF",
};

const problems = (input: Record<string, unknown>, partial = false) => {
  const result = validateUser(input, partial);
  return result.ok ? {} : result.fields;
};

describe("UNIT-06 name (BR-37)", () => {
  it("accepts 2 to 80 characters after trimming, both ends inclusive", () => {
    for (const name of ["Jo", "x".repeat(80), "  Jo  ", ` ${"x".repeat(80)} `]) {
      expect([name.length, problems({ ...VALID, name }).name]).toEqual([name.length, undefined]);
    }
  });

  it("rejects one character, 81, empty, and whitespace alone", () => {
    for (const name of ["J", "x".repeat(81), "", "   ", " J "]) {
      expect([name, typeof problems({ ...VALID, name }).name]).toEqual([name, "string"]);
    }
  });

  it("stores the trimmed name", () => {
    const result = validateUser({ ...VALID, name: "  Jane Doe  " }, false);
    expect(result.ok && result.value.name).toBe("Jane Doe");
  });

  it("rejects a name that is not a string", () => {
    for (const name of [null, 42, ["Jane"], { first: "Jane" }]) {
      expect(typeof problems({ ...VALID, name }).name).toBe("string");
    }
  });
});

describe("UNIT-06 email (BR-06, BR-37)", () => {
  it("accepts an ordinary address and one of exactly 120 characters", () => {
    const longest = `${"a".repeat(120 - "@toktickit.test".length)}@toktickit.test`;
    expect(longest).toHaveLength(120);

    expect(problems({ ...VALID, email: "a@b.co" }).email).toBeUndefined();
    expect(problems({ ...VALID, email: longest }).email).toBeUndefined();
  });

  it("rejects 121 characters", () => {
    const tooLong = `${"a".repeat(121 - "@toktickit.test".length)}@toktickit.test`;
    expect(tooLong).toHaveLength(121);
    expect(problems({ ...VALID, email: tooLong }).email).toMatch(/at most 120/);
  });

  it("rejects what is not shaped like an address", () => {
    for (const email of ["", "   ", "jane", "jane@", "@toktickit.test", "jane@toktickit", "jane doe@toktickit.test", "jane@@toktickit.test", "jane@tok tickit.test"]) {
      expect([email, typeof problems({ ...VALID, email }).email]).toEqual([email, "string"]);
    }
  });

  it("lower-cases and trims what it stores, so the address login looks up is the one held", () => {
    const result = validateUser({ ...VALID, email: "  Jane.DOE@TokTickIT.Test " }, false);
    expect(result.ok && result.value.email).toBe("jane.doe@toktickit.test");
  });
});

describe("UNIT-06 role and active", () => {
  it("accepts the three roles as spelled and nothing else", () => {
    for (const role of ["REQUESTER", "IT_STAFF", "ADMINISTRATOR"]) {
      expect(problems({ ...VALID, role }).role).toBeUndefined();
    }
    for (const role of ["", "admin", "Administrator", "SUPERUSER", null, 1, ["IT_STAFF"]]) {
      expect([role, typeof problems({ ...VALID, role }).role]).toEqual([role, "string"]);
    }
  });

  it("leaves active out when it is not sent, and insists on a boolean when it is", () => {
    const omitted = validateUser(VALID, false);
    expect(omitted.ok && "isActive" in omitted.value).toBe(false);

    const off = validateUser({ ...VALID, isActive: false }, false);
    expect(off.ok && off.value.isActive).toBe(false);

    // "false" is a truthy string: read loosely it would switch the account on.
    for (const isActive of ["false", "true", 0, 1, null]) {
      expect([isActive, typeof problems({ ...VALID, isActive }).isActive]).toEqual([isActive, "string"]);
    }
  });
});

describe("UNIT-06 create needs everything, edit only what is sent", () => {
  it("reports every missing field at once on create", () => {
    expect(Object.keys(problems({})).sort()).toEqual(["email", "name", "role"]);
  });

  it("accepts an empty edit, and an edit of one field", () => {
    expect(validateUser({}, true)).toEqual({ ok: true, value: {} });
    expect(validateUser({ name: "New Name" }, true)).toEqual({ ok: true, value: { name: "New Name" } });
  });

  it("still validates a field that an edit does send", () => {
    // Sending an empty name is an attempt to blank it, not to leave it alone.
    expect(typeof problems({ name: "" }, true).name).toBe("string");
    expect(typeof problems({ email: "nope" }, true).email).toBe("string");
    expect(typeof problems({ role: "ROOT" }, true).role).toBe("string");
  });

  it("never passes through a field it does not know", () => {
    const sneaky: Record<string, unknown> = { ...VALID, passwordHash: "x", id: 1, mustChangePassword: false };
    const result = validateUser(sneaky, false);
    expect(result.ok && Object.keys(result.value).sort()).toEqual(["email", "name", "role"]);
  });
});

describe("UNIT-06 initial password (BR-13)", () => {
  it("accepts 8 characters and 72 bytes, both inclusive", () => {
    expect(initialPasswordProblem("a".repeat(8))).toBeNull();
    expect(initialPasswordProblem("a".repeat(72))).toBeNull();
  });

  it("rejects 7 characters, 73 bytes, empty, and anything that is not a string", () => {
    expect(initialPasswordProblem("a".repeat(7))).toMatch(/at least 8/);
    expect(initialPasswordProblem("a".repeat(73))).toMatch(/at most 72 bytes/);
    for (const junk of ["", undefined, null, 12345678, ["password1"]]) {
      expect([junk, typeof initialPasswordProblem(junk)]).toEqual([junk, "string"]);
    }
  });

  it("counts bytes, not characters, at the ceiling", () => {
    // 24 Thai characters are exactly 72 bytes; 25 are 75. Both are far under
    // 72 by `.length`, which is the mistake the rule exists to prevent.
    expect(initialPasswordProblem("ก".repeat(24))).toBeNull();
    expect(initialPasswordProblem("ก".repeat(25))).toMatch(/at most 72 bytes/);
  });
});
