import "dotenv/config";
import express from "express";
import cors from "cors";
import { createPrismaClient } from "./prisma.js";

// The app is built by a factory (rather than created at import time) so that
// Supertest can mount it without starting a real listener.
// CLIENT_ORIGIN holds one origin or a comma-separated list, so a second Vite
// instance on another port can be allowed without editing code.
function allowedOrigins() {
  return (process.env.CLIENT_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function createApp(prisma = createPrismaClient()) {
  const app = express();

  app.use(cors({ origin: allowedOrigins() }));
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.json({ service: "TokTickIT API" });
  });

  // Liveness probe for the frontend's [Check System] button. Deliberately does
  // not touch the database: it answers "is the API process up?", which is a
  // different question from "is PostgreSQL reachable?".
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "TokTickIT API" });
  });

  app.get("/api/categories", async (_req, res) => {
    const categories = await prisma.category.findMany({
      orderBy: { id: "asc" },
    });
    res.json(categories);
  });

  return app;
}
