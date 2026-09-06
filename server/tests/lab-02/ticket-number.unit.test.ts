import { describe, expect, it } from "vitest";
import {
  formatTicketNumber,
  placeholderTicketNumber,
} from "../../src/lib/ticket-number.js";

// UNIT-01 (BR-01, AC-01): the Ticket Number format. Uniqueness is a property
// of the id, so the helper only has to be a faithful, collision-free encoding
// of it — which is what these assertions pin down.
describe("UNIT-01 formatTicketNumber", () => {
  it("renders TKT-{year}-{6-digit zero-padded id}", () => {
    expect(formatTicketNumber(42, 2026)).toBe("TKT-2026-000042");
  });

  it("zero-pads the smallest id and stops padding at six digits", () => {
    expect(formatTicketNumber(1, 2026)).toBe("TKT-2026-000001");
    expect(formatTicketNumber(999999, 2026)).toBe("TKT-2026-999999");
  });

  it("does not truncate an id that outgrows six digits", () => {
    // Padding is a minimum width, not a cap — truncating here would start
    // producing duplicate Ticket Numbers, breaking BR-01.
    expect(formatTicketNumber(1000000, 2026)).toBe("TKT-2026-1000000");
  });

  it("uses the creation year it is given", () => {
    expect(formatTicketNumber(7, 2025)).toBe("TKT-2025-000007");
    expect(formatTicketNumber(7, 2027)).toBe("TKT-2027-000007");
  });

  it("is injective across ids within a year", () => {
    const numbers = new Set(
      Array.from({ length: 500 }, (_, i) => formatTicketNumber(i + 1, 2026)),
    );

    expect(numbers.size).toBe(500);
  });

  it("marks placeholders distinctly so they can never look official", () => {
    const placeholder = placeholderTicketNumber("abc");

    expect(placeholder).toBe("PENDING-abc");
    expect(placeholder).not.toMatch(/^TKT-/);
  });
});
