import { describe, expect, it } from "vitest";
import { parseStaffQueueQuery } from "../../src/lib/ticket-query.js";

// UNIT-05 (BR-30, BR-31, AC-26). The parser's whole contract is that nothing
// it is handed can fail a request: every case below ends in a usable query.

describe("UNIT-05 queue query parser", () => {
  it("defaults to Last Updated descending, page 1, ten per page (BR-31)", () => {
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

  it("keeps every valid parameter", () => {
    expect(
      parseStaffQueueQuery({
        search: "  printer  ",
        status: "IN_PROGRESS",
        itPriority: "URGENT",
        categoryId: "3",
        owner: "me",
        sortBy: "itPriority",
        sortDir: "asc",
        page: "2",
        pageSize: "25",
      }),
    ).toEqual({
      search: "printer",
      status: "IN_PROGRESS",
      itPriority: "URGENT",
      categoryId: 3,
      owner: "me",
      sortBy: "itPriority",
      sortDir: "asc",
      page: 2,
      pageSize: 25,
      filtered: true,
    });
  });

  it("clamps page and pageSize to the nearest bound (AC-26)", () => {
    const parse = (page: string, pageSize: string) => {
      const parsed = parseStaffQueueQuery({ page, pageSize });
      return [parsed.page, parsed.pageSize];
    };

    expect(parse("0", "0")).toEqual([1, 1]);
    expect(parse("-4", "-4")).toEqual([1, 1]);
    expect(parse("3", "51")).toEqual([3, 50]);
    expect(parse("3", "50")).toEqual([3, 50]);
    expect(parse("2.9", "7.9")).toEqual([2, 7]);
  });

  it("falls back to the default for values that are not numbers at all", () => {
    for (const junk of ["abc", "", " ", "NaN", "Infinity"]) {
      const parsed = parseStaffQueueQuery({ page: junk, pageSize: junk });
      expect([junk, parsed.page]).toEqual([junk, 1]);
      // Infinity is a number, just not a usable one, and takes the default
      // rather than the 50 ceiling: nobody asking for "all of them" by
      // accident should get the largest page the API allows.
      expect([junk, parsed.pageSize]).toEqual([junk, 10]);
    }
  });

  it("drops an unknown sort key, status, priority or direction", () => {
    const parsed = parseStaffQueueQuery({
      sortBy: "passwordHash",
      sortDir: "sideways",
      status: "ARCHIVED",
      itPriority: "CRITICAL",
    });

    expect(parsed.sortBy).toBe("updatedAt");
    expect(parsed.sortDir).toBe("desc");
    expect(parsed.status).toBeUndefined();
    expect(parsed.itPriority).toBeUndefined();
  });

  it("is case-sensitive about enum values, as the contract spells them", () => {
    expect(parseStaffQueueQuery({ status: "new" }).status).toBeUndefined();
    expect(parseStaffQueueQuery({ itPriority: "high" }).itPriority).toBeUndefined();
  });

  it("does not take requestedPriority as a queue sort key", () => {
    // Valid on My Tickets, not here: the queue sorts on the priority IT Staff
    // set. Sharing a parser file must not mean sharing a sort list.
    expect(parseStaffQueueQuery({ sortBy: "requestedPriority" }).sortBy).toBe(
      "updatedAt",
    );
  });

  it("reads owner as me, unassigned, or a user id, and nothing else", () => {
    const owner = (raw: string) => parseStaffQueueQuery({ owner: raw }).owner;

    expect(owner("me")).toBe("me");
    expect(owner("unassigned")).toBe("unassigned");
    expect(owner("17")).toBe(17);
    for (const junk of ["0", "-1", "1.5", "ME", "nobody", ""]) {
      expect([junk, owner(junk)]).toEqual([junk, undefined]);
    }
  });

  it("takes the first value when a parameter repeats", () => {
    const parsed = parseStaffQueueQuery({
      page: ["2", "9"],
      status: ["OPEN", "CLOSED"],
    });

    expect(parsed.page).toBe(2);
    expect(parsed.status).toBe("OPEN");
  });

  it("counts a filter as applied only if it survived parsing (AC-23)", () => {
    // Each of these narrows nothing, so an empty result under them is an
    // empty queue, not "no Tickets match these filters".
    expect(parseStaffQueueQuery({ status: "BOGUS" }).filtered).toBe(false);
    expect(parseStaffQueueQuery({ owner: "nobody" }).filtered).toBe(false);
    expect(parseStaffQueueQuery({ search: "   " }).filtered).toBe(false);
    expect(parseStaffQueueQuery({ categoryId: "abc" }).filtered).toBe(false);
    // Sorting and paging present the same set differently.
    expect(
      parseStaffQueueQuery({ sortBy: "itPriority", page: "3", pageSize: "5" })
        .filtered,
    ).toBe(false);

    for (const one of [
      { search: "x" },
      { status: "NEW" },
      { itPriority: "LOW" },
      { categoryId: "1" },
      { owner: "unassigned" },
      { owner: "4" },
    ]) {
      expect([one, parseStaffQueueQuery(one).filtered]).toEqual([one, true]);
    }
  });
});
