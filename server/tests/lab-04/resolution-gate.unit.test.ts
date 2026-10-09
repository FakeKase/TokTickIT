import { describe, expect, it } from "vitest";
import {
  GATE_FOLLOW_UP,
  GATE_NO_ACTION,
  type GateFacts,
  blockedReason,
  offeredTransitions,
  resolutionGateRefusal,
  workflowRefusal,
} from "../../src/lib/status-transitions.js";
import { TICKET_STATUSES, type TicketStatusValue } from "../../src/lib/ticket-query.js";

// UNIT-02 (Lab 4 BR-12, BR-13, BR-14; AC-18, AC-19, AC-20, AC-22).
//
// The matrix below is written out by hand from specification.md §5.2, not
// read from the helper: a test that derived its expectations from the code
// under test would agree with it whatever it said.

const MET: GateFacts = { hasOwner: true, actionCount: 1, latestRequiresFollowUp: false };
const NO_OWNER = "A Ticket needs a Ticket Owner before it can be Resolved";

const PERMITTED: Record<TicketStatusValue, TicketStatusValue[]> = {
  NEW: ["OPEN", "IN_PROGRESS", "CANCELLED"],
  OPEN: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "CANCELLED"],
  IN_PROGRESS: ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  WAITING_FOR_REQUESTER: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
  RESOLVED: ["CLOSED", "REOPENED"],
  CLOSED: ["REOPENED"],
  REOPENED: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "CANCELLED"],
  CANCELLED: [],
};

describe("the final transition matrix (BR-12, AC-18)", () => {
  it("has 18 permitted moves, and nothing leads back to New or out of Cancelled", () => {
    expect(Object.values(PERMITTED).flat()).toHaveLength(18);
    expect(Object.values(PERMITTED).flat()).not.toContain("NEW");
    expect(PERMITTED.CANCELLED).toEqual([]);
  });

  it("accepts exactly the permitted cells when every precondition is met", () => {
    for (const from of TICKET_STATUSES) {
      for (const to of TICKET_STATUSES) {
        const refusal = workflowRefusal(from, to, MET);
        expect([from, to, refusal === null]).toEqual([from, to, PERMITTED[from].includes(to)]);
      }
    }
  });

  it("refuses a move outside the matrix without a code, naming both statuses", () => {
    expect(workflowRefusal("IN_PROGRESS", "CLOSED", MET)).toEqual({
      error: "Cannot move a Ticket from In Progress to Closed",
    });
    expect(workflowRefusal("OPEN", "OPEN", MET)).toEqual({ error: "This Ticket is already Open" });
  });

  it("offers the moves of the matrix row, in its order", () => {
    for (const from of TICKET_STATUSES) {
      expect(offeredTransitions(from, MET).map((move) => move.to)).toEqual(PERMITTED[from]);
    }
  });
});

describe("the resolution gate (BR-13, AC-19, AC-20, AC-22)", () => {
  it("is met with an owner, at least one Action Taken, and no follow-up on the latest", () => {
    expect(resolutionGateRefusal(MET)).toBeNull();
    expect(resolutionGateRefusal({ ...MET, actionCount: 7 })).toBeNull();
  });

  it("gives each unmet condition its own documented sentence", () => {
    expect(resolutionGateRefusal({ ...MET, hasOwner: false })).toBe(NO_OWNER);
    expect(resolutionGateRefusal({ ...MET, actionCount: 0 })).toBe(GATE_NO_ACTION);
    expect(resolutionGateRefusal({ ...MET, latestRequiresFollowUp: true })).toBe(GATE_FOLLOW_UP);
    // The exact words are part of the API contract (api-spec.md §4).
    expect(GATE_NO_ACTION).toBe("Record an Action Taken before resolving this Ticket");
    expect(GATE_FOLLOW_UP).toBe("The latest Action Taken still requires follow-up");
  });

  it("reports one reason, in the order: owner, then an action, then follow-up", () => {
    const nothing = { hasOwner: false, actionCount: 0, latestRequiresFollowUp: true };

    expect(resolutionGateRefusal(nothing)).toBe(NO_OWNER);
    expect(resolutionGateRefusal({ ...nothing, hasOwner: true })).toBe(GATE_NO_ACTION);
    expect(resolutionGateRefusal({ ...nothing, hasOwner: true, actionCount: 2 })).toBe(GATE_FOLLOW_UP);
  });

  it("refuses the move to Resolved with the code RESOLUTION_GATE, from both statuses that reach it", () => {
    for (const from of ["IN_PROGRESS", "WAITING_FOR_REQUESTER"] as const) {
      expect(workflowRefusal(from, "RESOLVED", { ...MET, actionCount: 0 })).toEqual({
        error: GATE_NO_ACTION,
        code: "RESOLUTION_GATE",
      });
      expect(workflowRefusal(from, "RESOLVED", { ...MET, hasOwner: false })).toEqual({
        error: NO_OWNER,
        code: "RESOLUTION_GATE",
      });
      expect(workflowRefusal(from, "RESOLVED", MET)).toBeNull();
    }
  });

  it("reports the matrix before the gate when a move fails both", () => {
    const refusal = workflowRefusal("NEW", "RESOLVED", { hasOwner: false, actionCount: 0, latestRequiresFollowUp: false });

    expect(refusal).toEqual({ error: "Cannot move a Ticket from New to Resolved" });
  });

  it("is not asked for any other move", () => {
    const unmet = { hasOwner: true, actionCount: 0, latestRequiresFollowUp: true };

    for (const from of TICKET_STATUSES) {
      for (const to of PERMITTED[from]) {
        if (to === "RESOLVED") continue;
        expect([from, to, workflowRefusal(from, to, unmet)]).toEqual([from, to, null]);
      }
    }
  });
});

describe("Closed needs an owner and not the gate (BR-14, AC-23)", () => {
  it("closes a Resolved Ticket that has an owner and no Action Taken", () => {
    expect(workflowRefusal("RESOLVED", "CLOSED", { hasOwner: true, actionCount: 0, latestRequiresFollowUp: false })).toBeNull();
  });

  it("refuses to close one with no owner, in the Lab 3 words and with no code", () => {
    expect(workflowRefusal("RESOLVED", "CLOSED", { ...MET, hasOwner: false })).toEqual({
      error: "A Ticket needs a Ticket Owner before it can be Closed",
    });
  });
});

describe("blockedReason on an offered move (FR-08, AC-27)", () => {
  it("is null exactly when the status route would accept the move", () => {
    const situations: GateFacts[] = [
      MET,
      { ...MET, hasOwner: false },
      { ...MET, actionCount: 0 },
      { ...MET, latestRequiresFollowUp: true },
      { hasOwner: false, actionCount: 0, latestRequiresFollowUp: true },
    ];

    for (const facts of situations) {
      for (const from of TICKET_STATUSES) {
        for (const move of offeredTransitions(from, facts)) {
          const refusal = workflowRefusal(from, move.to, facts);
          // The sentence shown beside a disabled option is the sentence the
          // route refuses with. They cannot disagree.
          expect([from, move.to, move.blockedReason]).toEqual([from, move.to, refusal?.error ?? null]);
        }
      }
    }
  });

  it("keeps requiresOwner as Lab 3 defined it", () => {
    expect(offeredTransitions("IN_PROGRESS", MET)).toEqual([
      { to: "WAITING_FOR_REQUESTER", requiresOwner: false, blockedReason: null },
      { to: "RESOLVED", requiresOwner: true, blockedReason: null },
      { to: "CANCELLED", requiresOwner: false, blockedReason: null },
    ]);
  });

  it("blocks only Resolved while work is missing, and both owner-bound moves while the owner is", () => {
    expect(blockedReason("RESOLVED", { ...MET, actionCount: 0 })).toBe(GATE_NO_ACTION);
    expect(blockedReason("CLOSED", { ...MET, actionCount: 0 })).toBeNull();
    expect(blockedReason("CANCELLED", { hasOwner: false, actionCount: 0, latestRequiresFollowUp: true })).toBeNull();
    expect(blockedReason("CLOSED", { ...MET, hasOwner: false })).toMatch(/Ticket Owner/);
  });
});
