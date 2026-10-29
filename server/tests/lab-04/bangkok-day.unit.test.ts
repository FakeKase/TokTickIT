import { afterEach, describe, expect, it } from "vitest";
import {
  bangkokDayStart,
  bangkokLastDaysStart,
  bangkokToday,
} from "../../src/lib/bangkok-day.js";

// UNIT-03 (Lab 4 BR-25, AC-34, AC-38).

const at = (iso: string) => new Date(iso);

describe("UNIT-03 Bangkok day boundaries (BR-25)", () => {
  const machineZone = process.env.TZ;
  afterEach(() => {
    process.env.TZ = machineZone;
  });

  it("starts the day at 17:00Z of the previous UTC day", () => {
    expect(bangkokDayStart(at("2026-10-06T04:00:00.000Z"))).toEqual(at("2026-10-05T17:00:00.000Z"));
  });

  it("keeps the last millisecond before 17:00Z in the day that began 24 hours earlier", () => {
    expect(bangkokDayStart(at("2026-10-06T16:59:59.999Z"))).toEqual(at("2026-10-05T17:00:00.000Z"));
  });

  it("starts a new day exactly at 17:00:00.000Z", () => {
    expect(bangkokDayStart(at("2026-10-06T17:00:00.000Z"))).toEqual(at("2026-10-06T17:00:00.000Z"));
  });

  it("gives today as a half-open range of exactly 24 hours", () => {
    const today = bangkokToday(at("2026-10-06T04:00:00.000Z"));

    expect(today.from).toEqual(at("2026-10-05T17:00:00.000Z"));
    expect(today.to).toEqual(at("2026-10-06T17:00:00.000Z"));
  });

  it("starts the last 7 days six Bangkok days before today", () => {
    // 6 October in Bangkok. Seven days counting today are 30 September to 6 October.
    expect(bangkokLastDaysStart(at("2026-10-06T04:00:00.000Z"), 7)).toEqual(
      at("2026-09-29T17:00:00.000Z"),
    );
    expect(bangkokLastDaysStart(at("2026-10-06T04:00:00.000Z"), 1)).toEqual(
      at("2026-10-05T17:00:00.000Z"),
    );
  });

  it("crosses a month and a year end without drifting", () => {
    expect(bangkokDayStart(at("2026-12-31T18:30:00.000Z"))).toEqual(at("2026-12-31T17:00:00.000Z"));
    expect(bangkokLastDaysStart(at("2027-01-02T03:00:00.000Z"), 7)).toEqual(
      at("2026-12-26T17:00:00.000Z"),
    );
  });

  it.each(["UTC", "America/Los_Angeles", "Asia/Bangkok", "Pacific/Kiritimati"])(
    "does not depend on the machine's time zone (%s)",
    (zone) => {
      process.env.TZ = zone;

      expect(bangkokDayStart(at("2026-10-06T16:59:59.999Z"))).toEqual(at("2026-10-05T17:00:00.000Z"));
      expect(bangkokDayStart(at("2026-10-06T17:00:00.000Z"))).toEqual(at("2026-10-06T17:00:00.000Z"));
    },
  );
});
