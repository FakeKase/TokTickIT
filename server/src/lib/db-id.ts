// Every id in the schema is a 32-bit integer column. A number past its range
// is still an integer to JavaScript, so the usual "is it a positive integer"
// check lets it through, and the database then refuses the query outright:
// what should have been "no such Ticket" came back as a 500. No row can have
// such an id, so it is treated here as what it is, an id that names nothing.

/** The largest id a row can have. */
export const MAX_DB_ID = 2_147_483_647;

/** Whether a value could be the id of a row. */
export const isDbId = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_DB_ID;
