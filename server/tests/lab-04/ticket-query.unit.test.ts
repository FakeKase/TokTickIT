import { describe, expect, it } from "vitest";
import {
  ACTIVE_STATUSES,
  TICKET_STATUSES,
  parseStaffQueueQuery,
  parseTicketQuery,
  queryFromString,
  requesterTicketWhere,
  staffTicketWhere,
} from "../../src/lib/ticket-query.js";

// UNIT-04 (Lab 4 BR-22, FR-12, AC-39).

const ACTIVE = { currentStatus: { in: ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "REOPENED"] } };

describe("UNIT-04 status on My Tickets", () => {
  it("names exactly the five active statuses", () => {
    expect([...ACTIVE_STATUSES]).toEqual(ACTIVE.currentStatus.in);
  });

  it("expands ACTIVE to the five active statuses and marks the list filtered", () => {
    const query = parseTicketQuery({ status: "ACTIVE" });

    expect(query.status).toBe("ACTIVE");
    expect(query.filtered).toBe(true);
    expect(requesterTicketWhere(7, query)).toEqual({ requesterId: 7, ...ACTIVE });
  });

  it.each(TICKET_STATUSES)("filters to the single status %s", (status) => {
    const query = parseTicketQuery({ status });

    expect(query.filtered).toBe(true);
    expect(requesterTicketWhere(7, query)).toEqual({ requesterId: 7, currentStatus: status });
  });

  it.each(["BOGUS", "active", "", "RESOLVED,CLOSED"])(
    "drops the unknown status %j and does not mark the list filtered",
    (status) => {
      const query = parseTicketQuery({ status });

      expect(query.status).toBeUndefined();
      expect(query.filtered).toBe(false);
      expect(requesterTicketWhere(7, query)).toEqual({ requesterId: 7 });
    },
  );

  it("takes the first value when the parameter repeats", () => {
    expect(parseTicketQuery({ status: ["CLOSED", "NEW"] }).status).toBe("CLOSED");
  });

  it("accepts sortBy=updatedAt", () => {
    expect(parseTicketQuery({ sortBy: "updatedAt", sortDir: "asc" })).toMatchObject({
      sortBy: "updatedAt",
      sortDir: "asc",
    });
  });

  it("keeps the Lab 2 defaults", () => {
    expect(parseTicketQuery({})).toEqual({
      search: undefined,
      status: undefined,
      categoryId: undefined,
      requestedPriority: undefined,
      sortBy: "createdAt",
      sortDir: "desc",
      page: 1,
      pageSize: 10,
      filtered: false,
    });
  });

  it("keeps the Requester as a condition under every combination of filters", () => {
    const where = requesterTicketWhere(
      7,
      parseTicketQuery({ status: "ACTIVE", search: "printer", categoryId: "2", requestedPriority: "HIGH" }),
    );

    expect(where).toEqual({
      requesterId: 7,
      ...ACTIVE,
      categoryId: 2,
      requestedPriority: "HIGH",
      OR: [
        { ticketNumber: { contains: "printer", mode: "insensitive" } },
        { summary: { contains: "printer", mode: "insensitive" } },
      ],
    });
  });
});

describe("UNIT-04 status on the Ticket Queue", () => {
  it("expands ACTIVE and combines it with owner and IT Priority", () => {
    const unassigned = parseStaffQueueQuery(queryFromString("owner=unassigned&status=ACTIVE"));
    const mine = parseStaffQueueQuery(queryFromString("owner=me&status=ACTIVE"));
    const urgent = parseStaffQueueQuery(queryFromString("itPriority=URGENT&status=ACTIVE"));

    expect(unassigned.filtered).toBe(true);
    expect(staffTicketWhere(9, unassigned)).toEqual({ ...ACTIVE, ownerId: null });
    expect(staffTicketWhere(9, mine)).toEqual({ ...ACTIVE, ownerId: 9 });
    expect(staffTicketWhere(9, urgent)).toEqual({ ...ACTIVE, itPriority: "URGENT" });
  });

  it("still filters to a single status", () => {
    expect(staffTicketWhere(9, parseStaffQueueQuery({ status: "RESOLVED" }))).toEqual({
      currentStatus: "RESOLVED",
    });
  });

  it("drops an unknown status and does not mark the queue filtered", () => {
    const query = parseStaffQueueQuery({ status: "BOGUS" });

    expect(query.filtered).toBe(false);
    expect(staffTicketWhere(9, query)).toEqual({});
  });

  it("keeps the Lab 3 defaults", () => {
    expect(parseStaffQueueQuery({})).toEqual({
      search: undefined,
      status: undefined,
      itPriority: undefined,
      categoryId: undefined,
      owner: undefined,
      sortBy: "updatedAt",
      sortDir: "desc",
      page: 1,
      pageSize: 10,
      filtered: false,
    });
  });

  it("resolves a numeric owner to that user and not to the caller", () => {
    expect(staffTicketWhere(9, parseStaffQueueQuery({ owner: "12" }))).toEqual({ ownerId: 12 });
  });
});
