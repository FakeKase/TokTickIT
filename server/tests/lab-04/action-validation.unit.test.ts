import { describe, expect, it } from "vitest";
import {
  ACTION_DESCRIPTION_MAX,
  ACTION_RESULT_MAX,
  ATTACHMENT_NOTES_MAX,
  FOLLOW_UP_NOTE_MAX,
  isRequestKey,
  validateAction,
} from "../../src/lib/action-validation.js";

// UNIT-01 (BR-05, BR-06, BR-07, AC-07, AC-08, AC-09).
//
// The clock and the Ticket's creation time are passed in, so every boundary
// below is an exact instant rather than "roughly now".

const TICKET_CREATED = new Date("2026-10-06T03:00:30.000Z");
const NOW = new Date("2026-10-06T05:00:00.000Z");
const context = { ticketCreatedAt: TICKET_CREATED, now: NOW };

const valid = (overrides: Record<string, unknown> = {}) => ({
  actionAt: "2026-10-06T04:00:00.000Z",
  description: "Replaced the projector lamp.",
  result: "Projector powers on.",
  followUpRequired: false,
  ...overrides,
});

const fieldsOf = (input: Record<string, unknown>) => {
  const result = validateAction(input, context);
  return result.ok ? {} : result.fields;
};

describe("a valid Action Taken", () => {
  it("is accepted, trimmed, with the optional fields null", () => {
    const result = validateAction(
      valid({ description: "  Replaced the lamp.  ", result: "\tWorks.\n" }),
      context,
    );

    expect(result).toEqual({
      ok: true,
      value: {
        actionAt: new Date("2026-10-06T04:00:00.000Z"),
        description: "Replaced the lamp.",
        result: "Works.",
        followUpRequired: false,
        followUpNote: null,
        attachmentNotes: null,
      },
    });
  });
});

describe("Action Description and Result (BR-06)", () => {
  it.each([
    ["description", ACTION_DESCRIPTION_MAX],
    ["result", ACTION_RESULT_MAX],
  ])("%s is required, and limited to %i characters after trimming", (field, max) => {
    expect(fieldsOf(valid({ [field]: undefined }))).toHaveProperty(field);
    expect(fieldsOf(valid({ [field]: "" }))).toHaveProperty(field);
    expect(fieldsOf(valid({ [field]: "   \n\t " }))).toHaveProperty(field);
    expect(fieldsOf(valid({ [field]: 42 }))).toHaveProperty(field);

    // Both ends of the range are inside it.
    expect(fieldsOf(valid({ [field]: "x" }))).toEqual({});
    expect(fieldsOf(valid({ [field]: "x".repeat(max) }))).toEqual({});
    expect(fieldsOf(valid({ [field]: "x".repeat(max + 1) }))).toHaveProperty(field);
    // Measured after trimming: padding does not count against the limit.
    expect(fieldsOf(valid({ [field]: `  ${"x".repeat(max)}  ` }))).toEqual({});
  });
});

describe("Follow-up (BR-07)", () => {
  it("requires a note when follow-up is required", () => {
    expect(fieldsOf(valid({ followUpRequired: true }))).toHaveProperty("followUpNote");
    expect(fieldsOf(valid({ followUpRequired: true, followUpNote: "" }))).toHaveProperty("followUpNote");
    expect(fieldsOf(valid({ followUpRequired: true, followUpNote: "   " }))).toHaveProperty("followUpNote");
    expect(
      fieldsOf(valid({ followUpRequired: true, followUpNote: "x".repeat(FOLLOW_UP_NOTE_MAX + 1) })),
    ).toHaveProperty("followUpNote");
  });

  it("keeps a note of 1 to 1000 characters, trimmed", () => {
    const result = validateAction(
      valid({ followUpRequired: true, followUpNote: `  ${"x".repeat(FOLLOW_UP_NOTE_MAX)}  ` }),
      context,
    );

    expect(result.ok && result.value.followUpNote).toBe("x".repeat(FOLLOW_UP_NOTE_MAX));
    expect(result.ok && result.value.followUpRequired).toBe(true);
  });

  it("stores no note when follow-up is not required, whatever was sent", () => {
    const result = validateAction(
      valid({ followUpRequired: false, followUpNote: "typed, then un-ticked" }),
      context,
    );

    expect(result.ok && result.value.followUpNote).toBeNull();
    // Not even an over-long one is an error: it is not being kept.
    expect(fieldsOf(valid({ followUpNote: "x".repeat(FOLLOW_UP_NOTE_MAX + 1) }))).toEqual({});
  });

  it("requires a real yes or no", () => {
    for (const value of [undefined, null, "true", 1, 0]) {
      expect(fieldsOf(valid({ followUpRequired: value }))).toHaveProperty("followUpRequired");
    }
  });
});

describe("Attachment Notes (BR-06)", () => {
  it("is optional, and empty is stored as null", () => {
    for (const value of [undefined, null, "", "   "]) {
      const result = validateAction(valid({ attachmentNotes: value }), context);
      expect(result.ok && result.value.attachmentNotes).toBeNull();
    }
  });

  it("is trimmed and limited to 500 characters", () => {
    const kept = validateAction(valid({ attachmentNotes: `  ${"x".repeat(ATTACHMENT_NOTES_MAX)} ` }), context);
    expect(kept.ok && kept.value.attachmentNotes).toBe("x".repeat(ATTACHMENT_NOTES_MAX));

    expect(fieldsOf(valid({ attachmentNotes: "x".repeat(ATTACHMENT_NOTES_MAX + 1) }))).toHaveProperty("attachmentNotes");
    expect(fieldsOf(valid({ attachmentNotes: 7 }))).toHaveProperty("attachmentNotes");
  });
});

describe("Action Date/Time (BR-05)", () => {
  it.each([
    [undefined],
    [null],
    [""],
    ["yesterday"],
    ["2026-10-06"],
    // No zone: the same text would be a different instant on another server.
    ["2026-10-06T04:00:00"],
    ["2026-13-45T04:00:00.000Z"],
    [1791172800000],
  ])("rejects %j", (value) => {
    expect(fieldsOf(valid({ actionAt: value }))).toHaveProperty("actionAt");
  });

  it("accepts a zone written as Z or as an offset, with or without seconds", () => {
    for (const value of [
      "2026-10-06T04:00:00.000Z",
      "2026-10-06T04:00:00Z",
      "2026-10-06T04:00Z",
      "2026-10-06T11:00:00+07:00",
    ]) {
      const result = validateAction(valid({ actionAt: value }), context);
      expect(result.ok && result.value.actionAt.toISOString()).toBe("2026-10-06T04:00:00.000Z");
    }
  });

  it("compares with the Ticket's creation to the minute", () => {
    // The Ticket was created at 03:00:30. A form holds minutes only, so the
    // earliest time it can offer for that minute is 03:00:00, and that has to
    // be accepted even though it is 30 seconds before the Ticket existed.
    expect(fieldsOf(valid({ actionAt: "2026-10-06T03:00:00.000Z" }))).toEqual({});
    expect(fieldsOf(valid({ actionAt: "2026-10-06T03:00:30.000Z" }))).toEqual({});
    expect(fieldsOf(valid({ actionAt: "2026-10-06T02:59:59.999Z" }))).toHaveProperty("actionAt");
    expect(fieldsOf(valid({ actionAt: "2026-10-05T04:00:00.000Z" }))).toHaveProperty("actionAt");
  });

  it("allows up to 5 minutes ahead of the server clock and no more", () => {
    expect(fieldsOf(valid({ actionAt: "2026-10-06T05:00:00.000Z" }))).toEqual({});
    expect(fieldsOf(valid({ actionAt: "2026-10-06T05:05:00.000Z" }))).toEqual({});
    expect(fieldsOf(valid({ actionAt: "2026-10-06T05:05:00.001Z" }))).toHaveProperty("actionAt");
    expect(fieldsOf(valid({ actionAt: "2026-10-07T05:00:00.000Z" }))).toHaveProperty("actionAt");
  });
});

describe("several things wrong at once", () => {
  it("reports every failing field together", () => {
    expect(
      Object.keys(
        fieldsOf({ actionAt: "nope", description: " ", result: "", followUpRequired: true, attachmentNotes: 3 }),
      ).sort(),
    ).toEqual(["actionAt", "attachmentNotes", "description", "followUpNote", "result"]);
  });

  it("does not throw on an empty body", () => {
    expect(Object.keys(fieldsOf({})).sort()).toEqual([
      "actionAt",
      "description",
      "followUpRequired",
      "result",
    ]);
  });
});

describe("request key (BR-20)", () => {
  it("accepts a UUID and the seed's own form", () => {
    expect(isRequestKey("0f8b5c1e-6a0e-4d55-9a53-0e1c7b2a4d10")).toBe(true);
    expect(isRequestKey("seed:800002:1")).toBe(true);
    expect(isRequestKey("a".repeat(8))).toBe(true);
    expect(isRequestKey("a".repeat(64))).toBe(true);
  });

  it("rejects anything else", () => {
    for (const value of [undefined, null, 12345678, "", "a".repeat(7), "a".repeat(65), "has space 1", "semi;colon1", "ไทยไทยไทยไทย"]) {
      expect(isRequestKey(value)).toBe(false);
    }
  });
});
