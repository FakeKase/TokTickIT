import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy server/.env.example to server/.env.");
}

// Prisma 7 connects through a driver adapter rather than reading the datasource
// URL itself, so the adapter is constructed explicitly here.
const adapter = new PrismaPg({ connectionString });

// A single shared client. Prisma opens a connection pool per instance, so
// creating one per request would exhaust PostgreSQL connections.
export const prisma = new PrismaClient({ adapter });
