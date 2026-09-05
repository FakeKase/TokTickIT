import "dotenv/config";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import express from "express";
import cors from "cors";
import multer from "multer";
import { createPrismaClient } from "./prisma.js";
import {
  formatTicketNumber,
  placeholderTicketNumber,
} from "./lib/ticket-number.js";
import { validateTicketInput } from "./lib/ticket-validation.js";
import { parseTicketQuery } from "./lib/ticket-query.js";
import {
  ALLOWED_TYPES_LABEL,
  MAX_ACTIVE_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  isAllowedAttachment,
} from "./lib/attachment-validation.js";

// Uploads live on local disk under server/uploads (BR-23 keeps files even for
// removed Attachments, so nothing here ever deletes on removal). The stored
// name is a random UUID: the original name is display-only metadata and must
// never influence a path.
const UPLOADS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "uploads",
);
mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) =>
      cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  // BR-20: multer aborts the stream at the limit, so an oversized file is
  // never fully written to storage.
  limits: { fileSize: MAX_ATTACHMENT_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedAttachment(file.originalname, file.mimetype)) {
      cb(new UnsupportedTypeError());
      return;
    }
    cb(null, true);
  },
});

class UnsupportedTypeError extends Error {}
class AttachmentLimitError extends Error {}

/** Best-effort removal of a file multer already wrote, for every path that
 *  ends up rejecting the request. Never throws: cleanup failing must not turn
 *  a clean 4xx into a 500. */
async function discardUpload(file: Express.Multer.File | undefined) {
  if (!file) return;
  await unlink(file.path).catch(() => {});
}

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

  // Active Development Requesters for the Lab 2 selector screen
  // (api-spec.md §1). BR-04: inactive Requesters are never returned, so the
  // selector cannot offer one. BR-03/BR-29: this is testing scaffolding, not
  // an identity provider — it deliberately exposes no credentials of any kind.
  app.get("/api/requesters", async (_req, res) => {
    try {
      const requesters = await prisma.requester.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, email: true },
      });
      res.json(requesters);
    } catch {
      // Safe error only: the client never sees the underlying failure.
      res.status(500).json({ error: "Unable to load Development Requesters" });
    }
  });

  // Reference data for the Create Ticket classification row (api-spec.md §3).
  app.get("/api/related-systems", async (_req, res) => {
    try {
      const relatedSystems = await prisma.relatedSystem.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      });
      res.json(relatedSystems);
    } catch {
      res.status(500).json({ error: "Unable to load Related Systems" });
    }
  });

  // api-spec.md §4. Validation is re-run here even though the UI blocks the
  // same cases: BR-16 makes the backend the source of truth.
  app.post("/api/tickets", async (req, res) => {
    const parsed = validateTicketInput(req.body);
    if (!parsed.ok) {
      return res
        .status(400)
        .json({ error: "Validation failed", fields: parsed.fields });
    }

    const input = parsed.value;

    // Reference checks are 404s, not 400s (api-spec.md §4): the shape was
    // valid, the row simply is not there.
    const requester = await prisma.requester.findUnique({
      where: { id: input.requesterId },
    });
    if (!requester?.isActive) {
      return res
        .status(404)
        .json({ error: "Selected Requester is no longer active" });
    }

    const [category, relatedSystem] = await Promise.all([
      prisma.category.findUnique({ where: { id: input.categoryId } }),
      prisma.relatedSystem.findUnique({ where: { id: input.relatedSystemId } }),
    ]);
    if (!category) {
      return res.status(404).json({ error: "Selected Category was not found" });
    }
    if (!relatedSystem) {
      return res
        .status(404)
        .json({ error: "Selected Related System was not found" });
    }

    try {
      // BR-01: the Ticket Number embeds the row's own id, which does not exist
      // until the insert. Both statements run in one transaction so a failure
      // can never leave a PENDING- placeholder visible (BR-18: nothing is
      // persisted when creation fails).
      const ticket = await prisma.$transaction(async (tx) => {
        const created = await tx.ticket.create({
          data: {
            ticketNumber: placeholderTicketNumber(randomUUID()),
            requesterId: input.requesterId,
            categoryId: input.categoryId,
            relatedSystemId: input.relatedSystemId,
            summary: input.summary,
            description: input.description,
            requestedPriority: input.requestedPriority,
            // currentStatus is deliberately not settable from the body (BR-02);
            // the schema default supplies NEW.
          },
        });

        return tx.ticket.update({
          where: { id: created.id },
          data: {
            ticketNumber: formatTicketNumber(
              created.id,
              created.createdAt.getFullYear(),
            ),
          },
        });
      });

      res.status(201).json(ticket);
    } catch {
      res.status(500).json({ error: "Unable to create the Ticket" });
    }
  });

  // api-spec.md §5. Ownership is a WHERE clause, never a post-filter: a
  // Ticket belonging to someone else is not fetched at all (BR-07/BR-08).
  app.get("/api/tickets", async (req, res) => {
    const requesterId = Number(
      Array.isArray(req.query.requesterId)
        ? req.query.requesterId[0]
        : req.query.requesterId,
    );
    if (!Number.isInteger(requesterId) || requesterId <= 0) {
      return res.status(400).json({ error: "A valid requesterId is required" });
    }

    const query = parseTicketQuery(req.query as Record<string, unknown>);

    const where = {
      requesterId,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.requestedPriority
        ? { requestedPriority: query.requestedPriority }
        : {}),
      // BR-09: matches Ticket Number or Summary. Nested under AND with
      // requesterId above, so the OR can never widen past the owner.
      ...(query.search
        ? {
            OR: [
              {
                ticketNumber: {
                  contains: query.search,
                  mode: "insensitive" as const,
                },
              },
              {
                summary: {
                  contains: query.search,
                  mode: "insensitive" as const,
                },
              },
            ],
          }
        : {}),
    };

    try {
      const [totalItems, rows] = await Promise.all([
        prisma.ticket.count({ where }),
        prisma.ticket.findMany({
          where,
          orderBy: [
            { [query.sortBy]: query.sortDir },
            // AC-16: ties on the chosen key break by Created Date descending.
            // Skipped when that IS the chosen key, where it would be a no-op.
            ...(query.sortBy === "createdAt"
              ? []
              : [{ createdAt: "desc" as const }]),
            // BR-11: id last as the stable key. Without it, rows sharing both
            // the sort key and createdAt can reorder between requests, and the
            // same Ticket can appear on two pages or none.
            { id: "desc" as const },
          ],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true,
            ticketNumber: true,
            summary: true,
            requestedPriority: true,
            currentStatus: true,
            createdAt: true,
            updatedAt: true,
            category: { select: { name: true } },
          },
        }),
      ]);

      res.json({
        data: rows.map(({ category, ...ticket }) => ({
          ...ticket,
          categoryName: category.name,
        })),
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / query.pageSize),
        },
        // BR-28: lets the client tell the Empty state from No-Results without
        // a second request.
        filtered: query.filtered,
      });
    } catch {
      res.status(500).json({ error: "Unable to load your Tickets" });
    }
  });

  // api-spec.md §6. BR-08: a Ticket owned by someone else is indistinguishable
  // from one that does not exist, so id enumeration reveals nothing.
  app.get("/api/tickets/:id", async (req, res) => {
    const requesterId = Number(
      Array.isArray(req.query.requesterId)
        ? req.query.requesterId[0]
        : req.query.requesterId,
    );
    if (!Number.isInteger(requesterId) || requesterId <= 0) {
      return res.status(400).json({ error: "A valid requesterId is required" });
    }

    const ticketId = Number(req.params.id);
    if (!Number.isInteger(ticketId) || ticketId <= 0) {
      // Same 404 as a well-formed id that is not theirs — a different status
      // here would tell a prober which ids are even plausible.
      return res.status(404).json({ error: "Ticket not found" });
    }

    try {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          ticketNumber: true,
          requesterId: true,
          summary: true,
          description: true,
          requestedPriority: true,
          currentStatus: true,
          createdAt: true,
          updatedAt: true,
          requester: { select: { id: true, name: true } },
          category: { select: { id: true, name: true } },
          relatedSystem: { select: { id: true, name: true } },
          attachments: {
            orderBy: { id: "asc" },
            select: {
              id: true,
              originalFilename: true,
              mimeType: true,
              sizeBytes: true,
              isRemoved: true,
              removedAt: true,
              removedReason: true,
              createdAt: true,
            },
          },
        },
      });

      if (!ticket || ticket.requesterId !== requesterId) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      // requesterId is dropped from the payload: the nested `requester` object
      // carries the same fact in the shape api-spec.md §6 documents.
      const { requesterId: _owner, ...detail } = ticket;
      res.json(detail);
    } catch {
      res.status(500).json({ error: "Unable to load the Ticket" });
    }
  });

  // api-spec.md §7. multer runs first so the multipart body is parsed, then
  // every rejection path discards the file it wrote.
  app.post(
    "/api/tickets/:id/attachments",
    (req, res, next) => {
      upload.single("file")(req, res, (err: unknown) => {
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
          // BR-20.
          return res
            .status(413)
            .json({ error: "Attachment exceeds the 5 MB limit" });
        }
        if (err instanceof UnsupportedTypeError) {
          // BR-19.
          return res
            .status(415)
            .json({ error: `Attachment type must be one of: ${ALLOWED_TYPES_LABEL}` });
        }
        if (err) return next(err);
        next();
      });
    },
    async (req, res) => {
      const requesterId = Number(req.body?.requesterId);
      if (!Number.isInteger(requesterId) || requesterId <= 0) {
        await discardUpload(req.file);
        return res.status(400).json({ error: "requesterId is required" });
      }

      const ticketId = Number(req.params.id);
      const ticket = Number.isInteger(ticketId)
        ? await prisma.ticket.findUnique({ where: { id: ticketId } })
        : null;

      // BR-08: a Ticket owned by someone else is indistinguishable from one
      // that does not exist.
      if (!ticket || ticket.requesterId !== requesterId) {
        await discardUpload(req.file);
        return res.status(404).json({ error: "Ticket not found" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "A file is required" });
      }

      try {
        const attachment = await prisma.$transaction(async (tx) => {
          // BR-21. A transaction alone does not make count-then-insert safe:
          // $transaction runs at Postgres's default READ COMMITTED, under
          // which two concurrent uploads can both read 4 and both insert,
          // landing 6 on a Ticket capped at 5.
          //
          // Locking the Ticket row first serializes uploads per Ticket, so the
          // second one blocks here and then counts the first one's row. Chosen
          // over Serializable because that aborts the loser with a
          // serialization failure, which would need retry handling to avoid
          // surfacing as a 500 on a request that should simply wait.
          await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id = ${ticket.id} FOR UPDATE`;

          const activeCount = await tx.attachment.count({
            where: { ticketId: ticket.id, isRemoved: false },
          });
          if (activeCount >= MAX_ACTIVE_ATTACHMENTS) {
            throw new AttachmentLimitError();
          }

          return tx.attachment.create({
            data: {
              ticketId: ticket.id,
              originalFilename: req.file!.originalname,
              storedFilename: req.file!.filename,
              mimeType: req.file!.mimetype,
              sizeBytes: req.file!.size,
            },
            // storedFilename is the on-disk name and has no client use; it is
            // left out of the response rather than handed out (api-spec.md §7).
            select: {
              id: true,
              ticketId: true,
              originalFilename: true,
              mimeType: true,
              sizeBytes: true,
              isRemoved: true,
              createdAt: true,
            },
          });
        });

        res.status(201).json(attachment);
      } catch (error) {
        await discardUpload(req.file);
        if (error instanceof AttachmentLimitError) {
          return res.status(409).json({
            error: `This Ticket already has the maximum of ${MAX_ACTIVE_ATTACHMENTS} attachments`,
          });
        }
        // BR-22: the Ticket itself is untouched by an attachment failure.
        res.status(500).json({ error: "Unable to store the attachment" });
      }
    },
  );

  return app;
}
