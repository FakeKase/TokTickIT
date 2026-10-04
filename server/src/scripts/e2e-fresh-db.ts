import "dotenv/config";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPrismaClient } from "../prisma.js";

/**
 * Creates a clean, migrated, seeded database for the Playwright suite, and
 * prints its URL.
 *
 * The suite's evidence screenshots show whatever is in the database, and the
 * development database holds whatever its owner has done to it: Tickets made
 * by hand, a password changed during a demo. A database built fresh for each
 * run shows the seed and nothing else, and leaves the development one alone.
 *
 * It sits beside the development database, on the same server, with `_e2e`
 * added to its name. It is dropped and rebuilt every time, so nothing in it
 * is worth keeping.
 */

const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

async function main() {
  const source = process.env.DATABASE_URL;
  if (!source) throw new Error("DATABASE_URL is not set");

  const url = new URL(source);
  const name = `${url.pathname.replace(/^\//, "")}_e2e`;
  // The name goes into DROP DATABASE unquoted-safe only if it is this plain.
  // It comes from our own .env, but a statement that drops a database is not
  // the place to trust that without looking.
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`refusing to rebuild a database named "${name}"`);
  }

  const admin = createPrismaClient();
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  await admin.$disconnect();

  url.pathname = `/${name}`;
  const env = { ...process.env, DATABASE_URL: url.toString() };
  const run = (command: string, args: string[]) =>
    execFileSync(command, args, { cwd: SERVER_DIR, env, stdio: ["ignore", "ignore", "inherit"] });

  run("npx", ["prisma", "migrate", "deploy"]);
  run("npx", ["tsx", "prisma/seed.ts"]);

  // The one line of output, read by e2e/run-fresh.mjs.
  console.log(url.toString());
}

main().catch((error) => {
  console.error("could not build the e2e database:", error);
  process.exit(1);
});
