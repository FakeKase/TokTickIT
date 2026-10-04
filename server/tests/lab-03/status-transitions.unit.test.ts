import { describe, expect, it } from "vitest";
import {
  isTicketStatus,
  permittedTransitions,
  requiresOwner,
  transitionRefusal,
} from "../../src/lib/status-transitions.js";
import { TICKET_STATUSES } from "../../src/lib/ticket-query.js";

// UNIT-03 (BR-22, BR-23; AC-31, AC-32, AC-33).
//
// The table below is specification.md §5.2 written out a second time, by
// hand, in the spec's own row and column order. It is deliberately not built
// from the helper's matrix: a test that derived its expectations from the code
// under test would agree with it whatever the code said.

const COLUMNS = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_FOR_REQUESTER",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
  "CANCELLED",
] as const;

const Y = true;
const N = false;

//                         OPEN  IN_PR  WAIT  RESOL  CLOSE  REOPN  CANCL
const SPEC: Record<(typeof TICKET_STATUSES)[number], boolean[]> = {
  NEW:                   [ Y,    Y,     N,    N,     N,     N,     Y ],
  OPEN:                  [ N,    Y,     Y,    N,     N,     N,     Y ],
  IN_PROGRESS:           [ N,    N,     Y,    Y,     N,     N,     Y ],
  WAITING_FOR_REQUESTER: [ N,    Y,     N,    Y,     N,     N,     Y ],
  RESOLVED:              [ N,    N,     N,    N,     Y,     Y,     N ],
  CLOSED:                [ N,    N,     N,    N,     N,     Y,     N ],
  REOPENED:              [ N,    Y,     Y,    N,     N,     N,     Y ],
  CANCELLED:             [ N,    N,     N,    N,     N,     N,     N ],
};

describe("UNIT-03 the status transition matrix (BR-22)", () => {
  it("permits exactly the cells §5.2 marks Yes, with an owner in place", () => {
    for (const from of TICKET_STATUSES) {
      COLUMNS.forEach((to, column) => {
        const allowed = transitionRefusal(from, to, true) === null;
        expect([from, to, allowed]).toEqual([from, to, SPEC[from][column]]);
      });
    }
  });

  it("lets nothing move back to New", () => {
    for (const from of TICKET_STATUSES) {
      expect([from, transitionRefusal(from, "NEW", true)]).not.toEqual([from, null]);
    }
  });

  it("refuses a move to the status the Ticket already has", () => {
    for (const status of TICKET_STATUSES) {
      expect(transitionRefusal(status, status, true)).toMatch(/already/);
    }
  });

  it("treats Cancelled as terminal and Closed as terminal except for a reopen", () => {
    expect(permittedTransitions("CANCELLED")).toEqual([]);
    expect(permittedTransitions("CLOSED").map((move) => move.to)).toEqual(["REOPENED"]);
  });

  it("offers the same moves it would accept", () => {
    // The list the screen is given and the check the route runs are the same
    // table read two ways; this is what keeps them from disagreeing.
    for (const from of TICKET_STATUSES) {
      const offered = permittedTransitions(from).map((move) => move.to);
      const accepted = TICKET_STATUSES.filter(
        (to) => transitionRefusal(from, to, true) === null,
      );
      expect([from, [...offered].sort()]).toEqual([from, [...accepted].sort()]);
    }
  });
});

describe("UNIT-03 Resolved and Closed need a Ticket Owner (BR-23)", () => {
  it("refuses both without an owner and allows both with one (AC-32, AC-33)", () => {
    expect(transitionRefusal("IN_PROGRESS", "RESOLVED", false)).toMatch(/Ticket Owner/);
    expect(transitionRefusal("IN_PROGRESS", "RESOLVED", true)).toBeNull();
    expect(transitionRefusal("RESOLVED", "CLOSED", false)).toMatch(/Ticket Owner/);
    expect(transitionRefusal("RESOLVED", "CLOSED", true)).toBeNull();
  });

  it("asks for an owner on those two statuses and no others", () => {
    expect(TICKET_STATUSES.filter(requiresOwner)).toEqual(["RESOLVED", "CLOSED"]);
  });

  it("does not ask for an owner to cancel, reopen, or keep working", () => {
    expect(transitionRefusal("NEW", "CANCELLED", false)).toBeNull();
    expect(transitionRefusal("CLOSED", "REOPENED", false)).toBeNull();
    expect(transitionRefusal("NEW", "IN_PROGRESS", false)).toBeNull();
  });

  it("flags the owner requirement on the offered move, so the screen can explain it", () => {
    expect(permittedTransitions("IN_PROGRESS")).toEqual([
      { to: "WAITING_FOR_REQUESTER", requiresOwner: false },
      { to: "RESOLVED", requiresOwner: true },
      { to: "CANCELLED", requiresOwner: false },
    ]);
  });

  it("reports the matrix before the owner, when a move fails both", () => {
    // In Progress to Closed is not in the matrix at all. Saying "needs an
    // owner" would send someone to assign one and then be refused again.
    expect(transitionRefusal("IN_PROGRESS", "CLOSED", false)).toBe(
      "Cannot move a Ticket from In Progress to Closed",
    );
  });
});

describe("UNIT-03 recognising a status", () => {
  it("accepts the eight values as spelled and nothing else", () => {
    for (const status of TICKET_STATUSES) expect(isTicketStatus(status)).toBe(true);
    for (const junk of ["resolved", "DONE", "", null, undefined, 4, ["OPEN"]]) {
      expect([junk, isTicketStatus(junk)]).toEqual([junk, false]);
    }
  });
});
