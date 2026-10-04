// Runs a transaction at SERIALIZABLE and retries it when Postgres aborts it.
//
// Used where a rule spans two rows that a single UPDATE's WHERE cannot cover,
// such as "the new Ticket Owner is still an active staff user at the moment
// they are assigned" (BR-19). At this level Postgres does not block the two
// transactions; it lets both run and aborts one at commit if their reads and
// writes could not have happened in any serial order. That abort is the
// mechanism working, not a failure, so the transaction is simply run again
// against the state the winner left behind.
//
// It protects only against other SERIALIZABLE transactions. A write made at
// the default level is invisible to the conflict check, so every route that
// takes part in the same rule has to come through here.

interface TransactionRunner<Tx> {
  $transaction<R>(
    fn: (tx: Tx) => Promise<R>,
    options?: { isolationLevel?: "Serializable" },
  ): Promise<R>;
}

const MAX_ATTEMPTS = 4;

/** P2034 is Prisma's code for a write conflict or serialization failure;
 *  40001 is the SQLSTATE underneath it, which the pg adapter can surface
 *  directly. */
function isSerializationFailure(error: unknown): boolean {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  return (
    code === "P2034" ||
    code === "40001" ||
    (typeof message === "string" && message.includes("could not serialize access"))
  );
}

export async function serializable<Tx, R>(
  db: TransactionRunner<Tx>,
  fn: (tx: Tx) => Promise<R>,
): Promise<R> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.$transaction(fn, { isolationLevel: "Serializable" });
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !isSerializationFailure(error)) throw error;
    }
  }
}
