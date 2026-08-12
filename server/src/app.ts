import "dotenv/config";
import express from "express";
import cors from "cors";

// The app is built by a factory (rather than created at import time) so that
// Supertest can mount it without starting a real listener.
export function createApp() {
  const app = express();

  app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173" }));
  app.use(express.json());

  // Routes for the health check and the category list are added in Issues 2 and 4.
  app.get("/", (_req, res) => {
    res.json({ service: "TokTickIT API" });
  });

  return app;
}
