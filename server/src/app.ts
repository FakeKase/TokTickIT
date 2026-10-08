import "dotenv/config";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import multer from "multer";
import { createPrismaClient } from "./prisma.js";
import {
  type AuthenticatedRequest,
  requireAuth,
  requirePasswordChanged,
  requireRole,
  toIdentity,
} from "./middleware/auth.js";
import {
  hashPassword,
  validatePasswordChange,
  verifyPassword,
} from "./lib/password.js";
import {
  clearSessionCookie,
  createSession,
  deleteSessionByToken,
  deleteUserSessions,
  resolveSession,
  setSessionCookie,
  SESSION_COOKIE,
} from "./lib/session.js";
import {
  formatTicketNumber,
  placeholderTicketNumber,
} from "./lib/ticket-number.js";
import { validateTicketInput } from "./lib/ticket-validation.js";
import {
  IT_PRIORITIES,
  parseStaffQueueQuery,
  parseTicketQuery,
} from "./lib/ticket-query.js";
import {
  ROLES,
  initialPasswordProblem,
  validateUser,
} from "./lib/user-validation.js";
import {
  isTicketStatus,
  permittedTransitions,
  requiresOwner,
  transitionRefusal,
} from "./lib/status-transitions.js";
import { validateComment } from "./lib/comment-validation.js";
import {
  TICKET_NOT_FOUND,
  parseId,
  resolveTicketFor,
} from "./lib/ticket-access.js";
import { registerActionsTaken } from "./routes/actions-taken.js";
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

  // credentials: true is what lets the browser send the session cookie at all.
  // It also forbids a wildcard origin, which is the point: the allowlist is no
  // longer advisory once cookies are in play.
  app.use(cors({ origin: allowedOrigins(), credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.get("/", (_req, res) => {
    res.json({ service: "TokTickIT API" });
  });

  // Liveness probe for the frontend's [Check System] button. Deliberately does
  // not touch the database: it answers "is the API process up?", which is a
  // different question from "is PostgreSQL reachable?".
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "TokTickIT API" });
  });


  // A real bcrypt hash of a throwaway random value, compared against when the
  // email matches nothing. Without it an unknown address answers in under a
  // millisecond while a known one pays for bcrypt, and the difference is a
  // reliable oracle for which addresses exist - which BR-08's identical
  // response body would otherwise have hidden.
  const ABSENT_USER_HASH =
    "$2b$10$pG2INaystr.WUIBgNfy7yeOqWP5fJLljGki/bEzg2TgO9obRx/dPq";

  // api-spec.md §1.
  app.post("/api/auth/login", async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email : "";
    const password =
      typeof req.body?.password === "string" ? req.body.password : "";

    const fields: Record<string, string> = {};
    if (!email.trim()) fields.email = "Enter your email address";
    if (!password) fields.password = "Enter your password";
    if (Object.keys(fields).length > 0) {
      return res.status(400).json({ error: "Validation failed", fields });
    }

    try {
      const user = await prisma.user.findUnique({
        where: { email: email.trim().toLowerCase() },
      });

      // The password is verified before isActive is consulted, even though all
      // three failures return the same body (BR-08). Checking the cheap
      // condition first would answer faster for an inactive account than for a
      // wrong password, and re-open by timing exactly what the shared message
      // closes.
      const passwordOk = await verifyPassword(
        password,
        user?.passwordHash ?? ABSENT_USER_HASH,
      );

      if (!user || !passwordOk || !user.isActive) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const token = await createSession(prisma, user.id);
      setSessionCookie(res, token);
      res.json({ user: toIdentity(user) });
    } catch {
      res.status(500).json({ error: "Unable to sign in" });
    }
  });

  // api-spec.md §2. Idempotent on purpose: logging out twice, or with an
  // expired cookie, is not an error and must not report one - there is nothing
  // for the caller to do differently, and a 401 here would tell an anonymous
  // visitor whether the cookie they hold is live.
  app.post("/api/auth/logout", async (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE];

    try {
      // Deleted by token hash rather than by resolving the session first.
      // resolveSession answers null for a deactivated user, so going through it
      // would leave that user's row in place - and hand them a working session
      // again the moment an Administrator reactivated them inside the 8-hour
      // window. Logging out destroys the token you presented, whatever the
      // account behind it is doing.
      if (token) await deleteSessionByToken(prisma, token);
    } catch {
      // A 204 here would tell the caller they are signed out while the row is
      // still live and usable by anyone holding the token. The cookie is
      // deliberately left alone too: clearing it would hide a session the user
      // can no longer reach but an attacker still can.
      return res.status(500).json({ error: "Unable to sign out" });
    }

    clearSessionCookie(res);
    res.status(204).end();
  });

  // api-spec.md §3. Permitted while mustChangePassword is set (BR-14): the
  // client needs this response to know it must route to Change Password.
  app.get(
    "/api/auth/me",
    requireAuth(prisma),
    (req: AuthenticatedRequest, res) => {
      res.json({ user: toIdentity(req.auth!.user) });
    },
  );

  // api-spec.md §4.
  app.post(
    "/api/auth/change-password",
    requireAuth(prisma),
    async (req: AuthenticatedRequest, res) => {
      const parsed = validatePasswordChange(req.body ?? {});
      if (!parsed.ok) {
        return res
          .status(400)
          .json({ error: "Validation failed", fields: parsed.fields });
      }

      const { user } = req.auth!;
      if (!(await verifyPassword(parsed.value.currentPassword, user.passwordHash))) {
        // 401, not 400: the input was well-formed, the credential was wrong.
        // The body says so too - "Validation failed" beside a 401 would tell
        // the client two different stories about what happened.
        return res.status(401).json({
          error: "Current password is incorrect",
          fields: { currentPassword: "That is not your current password" },
        });
      }

      try {
        const passwordHash = await hashPassword(parsed.value.newPassword);

        // One transaction so a user can never end up with the new password and
        // the old sessions, or vice versa. The token is returned rather than
        // written to the response inside the transaction: a rolled-back commit
        // must not leave the client holding a cookie for a row that no longer
        // exists.
        const { updated, token } = await prisma.$transaction(async (tx) => {
          const updated = await tx.user.update({
            where: { id: user.id },
            data: { passwordHash, mustChangePassword: false },
          });
          await deleteUserSessions(tx, user.id);
          return { updated, token: await createSession(tx, user.id) };
        });

        setSessionCookie(res, token);
        res.json({ user: toIdentity(updated) });
      } catch {
        res.status(500).json({ error: "Unable to change the password" });
      }
    },
  );

  /**
   * Authenticated, past the first-login gate, and a Requester (§5.1).
   *
   * Spread onto every route Lab 2 scoped with a client-supplied `requesterId`.
   * The order matters and is the same everywhere: no session is 401 before
   * anything else is considered, an outstanding password change is 403 with a
   * code the client routes on, and only then does the role decide.
   */
  const asRequester = [
    requireAuth(prisma),
    requirePasswordChanged,
    requireRole("REQUESTER"),
  ];

  app.get("/api/categories", async (_req, res) => {
    const categories = await prisma.category.findMany({
      orderBy: { id: "asc" },
    });
    res.json(categories);
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
  app.post("/api/tickets", ...asRequester, async (req: AuthenticatedRequest, res) => {
    const requester = req.auth!.user;
    const parsed = validateTicketInput(req.body);
    if (!parsed.ok) {
      return res
        .status(400)
        .json({ error: "Validation failed", fields: parsed.fields });
    }

    const input = parsed.value;

    // The Requester is no longer looked up, because there is nothing left to
    // look up: requireAuth resolved an active user from the session and
    // requireRole proved the role. The check this replaces existed only to
    // validate an id the client chose, which is exactly what BR-03 removes.
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
            // BR-03: from the session, never from the request.
            requesterId: requester.id,
            categoryId: input.categoryId,
            relatedSystemId: input.relatedSystemId,
            summary: input.summary,
            description: input.description,
            requestedPriority: input.requestedPriority,
            // BR-21: IT Priority starts as a copy of what the Requester asked
            // for. It is a separate column from here on - only IT Staff move it,
            // and requestedPriority never changes again.
            itPriority: input.requestedPriority,
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
  app.get("/api/tickets", ...asRequester, async (req: AuthenticatedRequest, res) => {
    const requesterId = req.auth!.user.id;

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
  app.get("/api/tickets/:id", ...asRequester, async (req: AuthenticatedRequest, res) => {
    const requesterId = req.auth!.user.id;

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
          // BR-24: the Requester's "this looks fixed" signal, so the screen can
          // show it after a reload rather than only in the session that sent it.
          requesterResolvedAt: true,
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

  /**
   * Authenticated and past the first-login gate, with no role restriction.
   *
   * The comment endpoints serve all three roles, so the role decides what the
   * caller may see and write rather than whether they may knock at all
   * (BR-04). Spread where a route branches on role internally.
   */
  const asAnyUser = [requireAuth(prisma), requirePasswordChanged];

  /** The Ticket a comment route is about, or null when the caller gets a
   *  404. The rule itself is in lib/ticket-access.ts, shared with the Actions
   *  Taken routes. */
  const resolveCommentTicket = (
    user: { id: number; role: string },
    rawId: string | string[],
  ) => resolveTicketFor(prisma, user, rawId);

  /** The response shape for one comment (api-spec.md §6). */
  const toComment = (comment: {
    id: number;
    ticketId: number;
    visibility: string;
    body: string;
    createdAt: Date;
    author: { id: number; name: string; role: string };
  }) => ({
    id: comment.id,
    ticketId: comment.ticketId,
    visibility: comment.visibility,
    body: comment.body,
    author: comment.author,
    createdAt: comment.createdAt,
  });

  // api-spec.md §6.
  app.get(
    "/api/tickets/:id/comments",
    ...asAnyUser,
    async (req: AuthenticatedRequest, res) => {
      const user = req.auth!.user;

      if (user.role === "REQUESTER" && req.query.visibility === "INTERNAL") {
        // Asked for explicitly, so answered explicitly: 403 rather than an
        // empty list. A silent empty collection would read as "there are
        // none", which is a different and false statement.
        return res.status(403).json({
          error: "You do not have permission to perform this action",
        });
      }

      const ticket = await resolveCommentTicket(user, req.params.id);
      if (!ticket) return res.status(404).json({ error: "Ticket not found" });

      try {
        const comments = await prisma.ticketComment.findMany({
          // BR-04 applied as a WHERE clause, not a filter over the result: an
          // internal note is never read out of the database for a Requester,
          // so it cannot reach the response by being forgotten later.
          where: {
            ticketId: ticket.id,
            ...(user.role === "REQUESTER" ? { visibility: "PUBLIC" as const } : {}),
          },
          // id as a same-direction tie-break: two comments written in the
          // same millisecond would otherwise come back in either order, and a
          // conversation that reorders itself between loads is worse than one
          // that is a millisecond out.
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            ticketId: true,
            visibility: true,
            body: true,
            createdAt: true,
            author: { select: { id: true, name: true, role: true } },
          },
        });

        res.json(comments.map(toComment));
      } catch {
        res.status(500).json({ error: "Unable to load the comments" });
      }
    },
  );

  app.post(
    "/api/tickets/:id/comments",
    ...asAnyUser,
    async (req: AuthenticatedRequest, res) => {
      const user = req.auth!.user;

      // Ownership first, before the body is even looked at. The GET above
      // refuses to tell a Requester whether somebody else's Ticket exists, and
      // answering 400 or 403 here would answer a question 404 is meant to
      // leave open.
      const ticket = await resolveCommentTicket(user, req.params.id);
      if (!ticket) return res.status(404).json({ error: "Ticket not found" });

      const parsed = validateComment(req.body ?? {});
      if (!parsed.ok) {
        return res
          .status(400)
          .json({ error: "Validation failed", fields: parsed.fields });
      }

      if (parsed.value.visibility === "INTERNAL" && user.role === "REQUESTER") {
        return res.status(403).json({
          error: "You do not have permission to perform this action",
        });
      }

      try {
        const comment = await prisma.ticketComment.create({
          data: {
            ticketId: ticket.id,
            // BR-27: author and timestamp come from the session and the
            // database, never from the body. A client that sends either is
            // ignored rather than corrected.
            authorId: user.id,
            visibility: parsed.value.visibility,
            body: parsed.value.body,
          },
          select: {
            id: true,
            ticketId: true,
            visibility: true,
            body: true,
            createdAt: true,
            author: { select: { id: true, name: true, role: true } },
          },
        });

        res.status(201).json(toComment(comment));
      } catch {
        res.status(500).json({ error: "Unable to post the comment" });
      }
    },
  );

  // api-spec.md §7 (FR-12, BR-05, BR-24).
  app.post(
    "/api/tickets/:id/requester-resolved",
    ...asRequester,
    async (req: AuthenticatedRequest, res) => {
      const user = req.auth!.user;

      const ticket = await resolveCommentTicket(user, req.params.id);
      if (!ticket) return res.status(404).json({ error: "Ticket not found" });

      if (
        ticket.currentStatus === "RESOLVED" ||
        ticket.currentStatus === "CLOSED" ||
        ticket.currentStatus === "CANCELLED"
      ) {
        return res.status(409).json({
          error: "This Ticket can no longer be marked as resolved",
        });
      }

      try {
        // One transaction, both guarantees. The WHERE is the guard that
        // actually holds - already-signalled, or a status that moved to
        // Resolved, Closed or Cancelled in the meantime - and the comment is
        // written inside the same transaction, so there is no window where the
        // timestamp exists without it. An earlier version committed the
        // timestamp first and compensated on failure, which reintroduced
        // exactly the gap the transaction was there to close.
        const updated = await prisma.$transaction(async (tx) => {
          const claimed = await tx.ticket.updateMany({
            where: {
              id: ticket.id,
              requesterResolvedAt: null,
              currentStatus: { notIn: ["RESOLVED", "CLOSED", "CANCELLED"] },
            },
            data: { requesterResolvedAt: new Date() },
          });
          if (claimed.count === 0) return null;

          await tx.ticketComment.create({
            data: {
              ticketId: ticket.id,
              authorId: user.id,
              visibility: "PUBLIC",
              body: "The Requester reported that this problem appears resolved.",
            },
          });

          return tx.ticket.findUniqueOrThrow({
            where: { id: ticket.id },
            select: {
              id: true,
              // BR-24: never written by this route. Only IT Staff resolve or
              // close a Ticket (BR-05); this is the Requester saying it looks
              // fixed from where they are sitting.
              currentStatus: true,
              requesterResolvedAt: true,
            },
          });
        });

        if (!updated) {
          return res
            .status(409)
            .json({ error: "This Ticket can no longer be marked as resolved" });
        }

        res.json(updated);
      } catch {
        res
          .status(500)
          .json({ error: "Unable to record that the problem appears resolved" });
      }
    },
  );

  /**
   * IT Staff and Administrators, past the first-login gate.
   *
   * An Administrator is included on every staff route (specification.md §5.1):
   * they can do what IT Staff can, plus manage users.
   */
  const asStaff = [
    requireAuth(prisma),
    requirePasswordChanged,
    requireRole("IT_STAFF", "ADMINISTRATOR"),
  ];

  // Lab 4: Actions Taken, in their own file (docs/lab-04/api-spec.md §1 to §3).
  registerActionsTaken(app, { prisma, asAnyUser, asStaff });

  // api-spec.md §8 (FR-13, BR-30, BR-31). Every Ticket in the system: there is
  // no ownership clause here, which is exactly why the role guard above is the
  // whole of the access control and a Requester must never reach this handler
  // (AC-14).
  app.get(
    "/api/staff/tickets",
    ...asStaff,
    async (req: AuthenticatedRequest, res) => {
      const query = parseStaffQueueQuery(req.query as Record<string, unknown>);

      const where = {
        ...(query.status ? { currentStatus: query.status } : {}),
        ...(query.itPriority ? { itPriority: query.itPriority } : {}),
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        // `me` is resolved from the session, never from the query string: the
        // filter means "mine" for whoever is asking.
        ...(query.owner === "me"
          ? { ownerId: req.auth!.user.id }
          : query.owner === "unassigned"
            ? { ownerId: null }
            : query.owner !== undefined
              ? { ownerId: query.owner }
              : {}),
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
        // Counted first, not alongside, because the page depends on it. A
        // queue changes under the reader - Tickets leave a filter as their
        // status moves - so "page 4" can stop existing between two clicks.
        // Serving it as zero rows would look like an empty queue; the last
        // real page is the nearest valid bound (AC-26).
        const totalItems = await prisma.ticket.count({ where });
        const totalPages = Math.ceil(totalItems / query.pageSize);
        const page = Math.min(query.page, Math.max(totalPages, 1));

        const rows = await prisma.ticket.findMany({
          where,
          orderBy: [
            { [query.sortBy]: query.sortDir },
            // AC-25: ties on the chosen key break by Last Updated descending.
            // Skipped when that IS the chosen key.
            ...(query.sortBy === "updatedAt"
              ? []
              : [{ updatedAt: "desc" as const }]),
            // BR-31: id last, so two Tickets touched in the same instant
            // cannot swap places between requests and appear on two pages or
            // neither.
            { id: "desc" as const },
          ],
          skip: (page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true,
            ticketNumber: true,
            summary: true,
            requestedPriority: true,
            itPriority: true,
            currentStatus: true,
            requesterResolvedAt: true,
            createdAt: true,
            updatedAt: true,
            category: { select: { id: true, name: true } },
            // Name and id only. The queue is read by staff, but an email
            // address is not something a list needs to carry for every row.
            requester: { select: { id: true, name: true } },
            owner: { select: { id: true, name: true } },
          },
        });

        res.json({
          data: rows,
          pagination: { page, pageSize: query.pageSize, totalItems, totalPages },
          filtered: query.filtered,
        });
      } catch {
        res.status(500).json({ error: "Unable to load the Ticket Queue" });
      }
    },
  );

  /** Everything the IT Staff Ticket Detail screen shows (api-spec.md §9). */
  const staffTicketSelect = {
    id: true,
    ticketNumber: true,
    summary: true,
    description: true,
    requestedPriority: true,
    itPriority: true,
    currentStatus: true,
    requesterResolvedAt: true,
    createdAt: true,
    updatedAt: true,
    category: { select: { id: true, name: true } },
    relatedSystem: { select: { id: true, name: true } },
    requester: { select: { id: true, name: true } },
    owner: { select: { id: true, name: true } },
    attachments: {
      orderBy: { id: "asc" as const },
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
  };

  /**
   * The staff view of a Ticket, plus where it may go next.
   *
   * `transitions` is the §5.2 matrix read for this Ticket's current status.
   * It travels with the Ticket so the screen offers what the server will
   * accept without keeping a second copy of the matrix that could fall out of
   * step with this one.
   */
  const toStaffTicket = <T extends { currentStatus: string }>(ticket: T) => ({
    ...ticket,
    transitions: isTicketStatus(ticket.currentStatus)
      ? permittedTransitions(ticket.currentStatus)
      : [],
    // True while the Ticket's status is one that must keep its owner
    // (BR-23), so the screen can explain a disabled Unassign instead of
    // offering one the owner route will always refuse.
    ownerRequired:
      isTicketStatus(ticket.currentStatus) && requiresOwner(ticket.currentStatus),
  });

  /** Somebody else changed the Ticket between this request reading it and
   *  writing to it. Not a validation problem and not a server fault: the
   *  screen is out of date, and reloading is the fix. */
  const TICKET_MOVED = {
    error: "This Ticket was changed by someone else. Reload it and try again.",
  };

  // api-spec.md §9 (FR-14).
  app.get(
    "/api/staff/tickets/:id",
    ...asStaff,
    async (req: AuthenticatedRequest, res) => {
      const id = parseId(req.params.id);
      if (!id) return res.status(404).json(TICKET_NOT_FOUND);

      try {
        const ticket = await prisma.ticket.findUnique({
          where: { id },
          select: staffTicketSelect,
        });
        if (!ticket) return res.status(404).json(TICKET_NOT_FOUND);

        res.json(toStaffTicket(ticket));
      } catch {
        res.status(500).json({ error: "Unable to load the Ticket" });
      }
    },
  );

  // api-spec.md §13 (FR-15, BR-19). Who the reassign control may offer.
  app.get(
    "/api/staff/assignable-users",
    ...asStaff,
    async (_req: AuthenticatedRequest, res) => {
      try {
        const users = await prisma.user.findMany({
          where: {
            isActive: true,
            role: { in: ["IT_STAFF", "ADMINISTRATOR"] },
          },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          select: { id: true, name: true, role: true },
        });
        res.json(users);
      } catch {
        res.status(500).json({ error: "Unable to load the assignable users" });
      }
    },
  );

  // api-spec.md §10 (FR-15, BR-19, BR-20). Claim, reassign, or unassign.
  app.patch(
    "/api/staff/tickets/:id/owner",
    ...asStaff,
    async (req: AuthenticatedRequest, res) => {
      const id = parseId(req.params.id);
      if (!id) return res.status(404).json(TICKET_NOT_FOUND);

      const ownerId: unknown = (req.body ?? {}).ownerId;
      const valid =
        ownerId === null ||
        (typeof ownerId === "number" && Number.isInteger(ownerId) && ownerId > 0);
      if (!valid) {
        return res.status(400).json({
          error: "Validation failed",
          fields: { ownerId: "Ticket Owner must be a user id, or null to unassign" },
        });
      }
      const nextOwnerId = ownerId as number | null;

      try {
        // The rule spans two tables: the Ticket being written and the User
        // who must still be active staff when it is (BR-19). A plain check
        // followed by a write would let the account be deactivated in between
        // and still receive the Ticket. So the check takes a lock on the
        // User's row (see below) and holds it until this transaction ends.
        const outcome = await prisma.$transaction(async (tx) => {
          const ticket = await tx.ticket.findUnique({
            where: { id },
            select: { ownerId: true, currentStatus: true },
          });
          if (!ticket) return { status: 404, body: TICKET_NOT_FOUND };

          if (nextOwnerId === null) {
            // BR-23 read forwards: a Ticket may not become Resolved or Closed
            // without an owner, so it may not be left without one after.
            // Otherwise the rule is one unassign away from meaning nothing.
            if (
              isTicketStatus(ticket.currentStatus) &&
              requiresOwner(ticket.currentStatus)
            ) {
              return {
                status: 409,
                body: {
                  error: "A Resolved or Closed Ticket must keep its Ticket Owner",
                },
              };
            }
          } else {
            // FOR SHARE: this row cannot be changed until we commit, and if
            // somebody is changing it right now we wait and then read what
            // they wrote. Deactivation updates this same row before it hands
            // the user's Tickets back, so whichever of the two comes second
            // sees the other's result. It works at the default isolation
            // level, so no other route has to remember anything for it to hold.
            const [target] = await tx.$queryRaw<
              { isActive: boolean; role: string }[]
            >`SELECT "isActive", "role"::text AS "role" FROM "User" WHERE "id" = ${nextOwnerId} FOR SHARE`;
            // One message for all three failures. Telling them apart would
            // let the caller probe which ids are accounts and which of those
            // are inactive.
            if (!target || !target.isActive || target.role === "REQUESTER") {
              return {
                status: 409,
                body: {
                  error: "Ticket Owner must be an active IT Staff or Administrator",
                },
              };
            }
          }

          // Assigning the owner a Ticket already has changes nothing, so it
          // writes nothing. An update would still advance `updatedAt`, and the
          // queue sorts by it: a no-op would float the Ticket to the top as
          // though something had happened to it.
          if (ticket.ownerId === nextOwnerId) {
            return {
              status: 200,
              body: toStaffTicket(
                await tx.ticket.findUniqueOrThrow({
                  where: { id },
                  select: staffTicketSelect,
                }),
              ),
            };
          }

          const updated = await tx.ticket.update({
            where: { id },
            data: { ownerId: nextOwnerId },
            select: staffTicketSelect,
          });
          return { status: 200, body: toStaffTicket(updated) };
        });

        res.status(outcome.status).json(outcome.body);
      } catch {
        res.status(500).json({ error: "Unable to change the Ticket Owner" });
      }
    },
  );

  // api-spec.md §11 (FR-16, BR-21).
  app.patch(
    "/api/staff/tickets/:id/it-priority",
    ...asStaff,
    async (req: AuthenticatedRequest, res) => {
      const id = parseId(req.params.id);
      if (!id) return res.status(404).json(TICKET_NOT_FOUND);

      const itPriority: unknown = (req.body ?? {}).itPriority;
      const known = IT_PRIORITIES.find((value) => value === itPriority);
      if (!known) {
        return res.status(400).json({
          error: "Validation failed",
          fields: { itPriority: "IT Priority must be Low, Medium, High or Urgent" },
        });
      }

      try {
        const ticket = await prisma.ticket.findUnique({
          where: { id },
          select: { itPriority: true },
        });
        if (!ticket) return res.status(404).json(TICKET_NOT_FOUND);

        // Only `itPriority` is ever written here. `requestedPriority` is what
        // the Requester asked for and stays as they left it (BR-21).
        const updated =
          ticket.itPriority === known
            ? await prisma.ticket.findUniqueOrThrow({
                where: { id },
                select: staffTicketSelect,
              })
            : await prisma.ticket.update({
                where: { id },
                data: { itPriority: known },
                select: staffTicketSelect,
              });

        res.json(toStaffTicket(updated));
      } catch {
        res.status(500).json({ error: "Unable to change the IT Priority" });
      }
    },
  );

  // api-spec.md §12 (FR-17, BR-22, BR-23).
  app.patch(
    "/api/staff/tickets/:id/status",
    ...asStaff,
    async (req: AuthenticatedRequest, res) => {
      const id = parseId(req.params.id);
      if (!id) return res.status(404).json(TICKET_NOT_FOUND);

      const target: unknown = (req.body ?? {}).currentStatus;
      if (!isTicketStatus(target)) {
        return res.status(400).json({
          error: "Validation failed",
          fields: { currentStatus: "Status is not one this system knows" },
        });
      }

      try {
        const ticket = await prisma.ticket.findUnique({
          where: { id },
          select: { currentStatus: true, ownerId: true },
        });
        if (!ticket) return res.status(404).json(TICKET_NOT_FOUND);

        // Judged from the status the database holds, never from what the
        // screen believed: the body carries only where to go, not where from.
        const from = ticket.currentStatus;
        const refusal = isTicketStatus(from)
          ? transitionRefusal(from, target, ticket.ownerId !== null)
          : "This Ticket's status cannot be changed";
        if (refusal) return res.status(409).json({ error: refusal });

        // The check above read the row; this writes it only if it is still
        // what was read. Both conditions the decision rested on are in the
        // WHERE, so a colleague moving the status, or unassigning the Ticket,
        // in between leaves zero rows matched instead of an illegal state.
        const moved = await prisma.ticket.updateMany({
          where: {
            id,
            currentStatus: from,
            ...(requiresOwner(target) ? { ownerId: { not: null } } : {}),
          },
          data: {
            currentStatus: target,
            // A reopened Ticket is live again, so the Requester's "this looks
            // fixed" no longer describes it. Cleared, they can say it again
            // when it is true again; the first time stays in the thread as
            // the comment that was posted with it.
            ...(target === "REOPENED" ? { requesterResolvedAt: null } : {}),
          },
        });
        if (moved.count === 0) return res.status(409).json(TICKET_MOVED);

        const updated = await prisma.ticket.findUniqueOrThrow({
          where: { id },
          select: staffTicketSelect,
        });
        res.json(toStaffTicket(updated));
      } catch {
        res.status(500).json({ error: "Unable to change the status" });
      }
    },
  );

  // ---------------------------------------------------------------------
  // Administrator user management (api-spec.md §14 to §17).

  /** Administrators only. Unlike `asStaff`, IT Staff are refused here: nothing
   *  outside this block lists people or changes what they may do (BR-16). */
  const asAdmin = [
    requireAuth(prisma),
    requirePasswordChanged,
    requireRole("ADMINISTRATOR"),
  ];

  const USER_NOT_FOUND = { error: "User not found" };
  const EMAIL_TAKEN = { error: "That email address is already in use" };
  const LAST_ADMINISTRATOR = {
    error: "The system must keep at least one active Administrator",
  };

  /** Prisma's code for a unique-constraint violation. The unique index on
   *  `User.email` is the rule that actually holds (BR-34); catching this is
   *  how it becomes a 409 instead of a 500. */
  const isUniqueViolation = (error: unknown) =>
    (error as { code?: unknown } | null)?.code === "P2002";

  /** Statuses where a Ticket is still somebody's work in progress. A user who
   *  stops being eligible to own Tickets hands these back; the ones they
   *  finished stay theirs, as the record of who finished them. */
  const LIVE_STATUSES = [
    "NEW",
    "OPEN",
    "IN_PROGRESS",
    "WAITING_FOR_REQUESTER",
    "REOPENED",
  ] as const;

  // api-spec.md §14 (FR-20, FR-21, BR-38).
  app.get("/api/users", ...asAdmin, async (req: AuthenticatedRequest, res) => {
    const rawSearch = req.query.search;
    const search = typeof rawSearch === "string" ? rawSearch.trim() : "";
    const role = ROLES.find((candidate) => candidate === req.query.role);

    try {
      const [users, activeAdministrators] = await Promise.all([
        prisma.user.findMany({
          where: {
            ...(role ? { role } : {}),
            ...(search
              ? {
                  OR: [
                    { name: { contains: search, mode: "insensitive" as const } },
                    { email: { contains: search, mode: "insensitive" as const } },
                  ],
                }
              : {}),
          },
          orderBy: [{ name: "asc" }, { id: "asc" }],
        }),
        // Counted over every user, not over the filtered list: whether
        // someone is the last Administrator does not depend on what the
        // caller happened to search for.
        prisma.user.count({ where: { role: "ADMINISTRATOR", isActive: true } }),
      ]);

      res.json(
        users.map((user) => ({
          ...toIdentity(user),
          // So the screen can disable the controls BR-33 would refuse and say
          // why, without counting Administrators in a list that may be
          // filtered. The PATCH below is what actually enforces the rule.
          isLastActiveAdministrator:
            user.role === "ADMINISTRATOR" && user.isActive && activeAdministrators <= 1,
        })),
      );
    } catch {
      res.status(500).json({ error: "Unable to load the users" });
    }
  });

  // api-spec.md §15 (FR-22, BR-06, BR-13, BR-34, BR-37).
  app.post("/api/users", ...asAdmin, async (req: AuthenticatedRequest, res) => {
    const body = req.body ?? {};
    const parsed = validateUser(body, false);
    const passwordProblem = initialPasswordProblem(body.initialPassword);

    if (!parsed.ok || passwordProblem) {
      return res.status(400).json({
        error: "Validation failed",
        fields: {
          ...(parsed.ok ? {} : parsed.fields),
          ...(passwordProblem ? { initialPassword: passwordProblem } : {}),
        },
      });
    }

    try {
      const created = await prisma.user.create({
        data: {
          name: parsed.value.name!,
          email: parsed.value.email!,
          role: parsed.value.role!,
          isActive: parsed.value.isActive ?? true,
          passwordHash: await hashPassword(body.initialPassword as string),
          // Always true, whatever the body says: the password was chosen by
          // an Administrator, so the account's owner has not chosen one yet.
          mustChangePassword: true,
        },
      });

      res.status(201).json(toIdentity(created));
    } catch (error) {
      if (isUniqueViolation(error)) return res.status(409).json(EMAIL_TAKEN);
      res.status(500).json({ error: "Unable to create the user" });
    }
  });

  // api-spec.md §16 (FR-23, BR-32 to BR-35).
  app.patch("/api/users/:id", ...asAdmin, async (req: AuthenticatedRequest, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json(USER_NOT_FOUND);

    const parsed = validateUser(req.body ?? {}, true);
    if (!parsed.ok) {
      return res.status(400).json({ error: "Validation failed", fields: parsed.fields });
    }
    const changes = parsed.value;
    const actingUserId = req.auth!.user.id;

    try {
      const outcome = await prisma.$transaction(async (tx) => {
        // One statement locks the user being edited and every active
        // Administrator, in id order.
        //
        // The target is locked so that a Ticket being assigned to them at
        // this moment either finishes first, and is handed back below, or
        // waits and then sees them deactivated (see the owner route).
        //
        // The Administrators are locked so that "is this the last one?" is
        // answered about rows that cannot change underneath the answer. Two
        // Administrators demoting each other at once would otherwise each
        // count two, each be allowed, and leave none.
        //
        // And one statement in a fixed order, so two edits can never each
        // hold a row the other is waiting for.
        //
        // FOR NO KEY UPDATE rather than FOR UPDATE. Postgres checks a foreign
        // key by taking FOR KEY SHARE on the row it points at, which FOR
        // UPDATE blocks: every comment, Ticket or session written for a
        // locked user would wait for this edit, and a route that locked a
        // Ticket before inserting such a row could deadlock against it. This
        // strength says "the key is not changing", which is true, and still
        // conflicts with itself and with the owner route's FOR SHARE.
        const locked = await tx.$queryRaw<
          { id: number; role: string; isActive: boolean }[]
        >`SELECT "id", "role"::text AS "role", "isActive" FROM "User"
          WHERE "id" = ${id} OR ("role" = 'ADMINISTRATOR' AND "isActive")
          ORDER BY "id" FOR NO KEY UPDATE`;

        const target = locked.find((user) => user.id === id);
        if (!target) return { status: 404, body: USER_NOT_FOUND };

        const nextActive = changes.isActive ?? target.isActive;
        const nextRole = changes.role ?? target.role;

        // Decided from the session, never from the body (BR-32). Checked
        // before the last-Administrator rule so that the clearer of the two
        // messages wins when both apply.
        if (target.id === actingUserId && target.isActive && !nextActive) {
          return {
            status: 409,
            body: { error: "You cannot deactivate your own account" },
          };
        }

        const isActiveAdmin = target.isActive && target.role === "ADMINISTRATOR";
        const staysActiveAdmin = nextActive && nextRole === "ADMINISTRATOR";
        if (isActiveAdmin && !staysActiveAdmin) {
          const activeAdministrators = locked.filter(
            (user) => user.isActive && user.role === "ADMINISTRATOR",
          ).length;
          if (activeAdministrators <= 1) {
            return { status: 409, body: LAST_ADMINISTRATOR };
          }
        }

        const updated =
          Object.keys(changes).length === 0
            ? await tx.user.findUniqueOrThrow({ where: { id } })
            : await tx.user.update({ where: { id }, data: changes });

        // BR-12: deactivation ends access now, not at the session's expiry.
        if (target.isActive && !updated.isActive) {
          await deleteUserSessions(tx, id);
        }

        // BR-19 as something that stays true, not only a check at the moment
        // of assignment: a user who can no longer own Tickets does not go on
        // owning live ones. They return to the queue unassigned.
        if (!updated.isActive || updated.role === "REQUESTER") {
          await tx.ticket.updateMany({
            where: { ownerId: id, currentStatus: { in: [...LIVE_STATUSES] } },
            data: { ownerId: null },
          });
        }

        return { status: 200, body: toIdentity(updated) };
      });

      res.status(outcome.status).json(outcome.body);
    } catch (error) {
      if (isUniqueViolation(error)) return res.status(409).json(EMAIL_TAKEN);
      res.status(500).json({ error: "Unable to update the user" });
    }
  });

  // api-spec.md §17 (FR-24, BR-13, BR-36).
  app.post(
    "/api/users/:id/initial-password",
    ...asAdmin,
    async (req: AuthenticatedRequest, res) => {
      const id = parseId(req.params.id);
      if (!id) return res.status(404).json(USER_NOT_FOUND);

      const initialPassword: unknown = (req.body ?? {}).initialPassword;
      const problem = initialPasswordProblem(initialPassword);
      if (problem) {
        return res.status(400).json({
          error: "Validation failed",
          fields: { initialPassword: problem },
        });
      }

      try {
        const exists = await prisma.user.count({ where: { id } });
        if (!exists) return res.status(404).json(USER_NOT_FOUND);

        // Hashed before the transaction opens: bcrypt takes tens of
        // milliseconds, and there is no reason to hold a transaction open
        // across it.
        const passwordHash = await hashPassword(initialPassword as string);

        const user = await prisma.$transaction(async (tx) => {
          const updated = await tx.user.update({
            where: { id },
            data: { passwordHash, mustChangePassword: true },
          });
          // BR-36: anyone signed in with the old password is signed out, in
          // the same transaction, so there is no moment where the password
          // has changed and an old session still works.
          await deleteUserSessions(tx, id);
          return updated;
        });

        res.json({ user: toIdentity(user) });
      } catch {
        res.status(500).json({ error: "Unable to set the initial password" });
      }
    },
  );

  // api-spec.md §7. The auth chain runs first, so an anonymous or wrong-role
  // caller is turned away before multer writes anything; multer then parses the
  // multipart body, and every rejection path after it discards the file it
  // wrote.
  app.post(
    "/api/tickets/:id/attachments",
    ...asRequester,
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
      const requesterId = (req as AuthenticatedRequest).auth!.user.id;

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

  /**
   * Resolves an Attachment the caller owns, or null.
   *
   * BR-08/BR-25/AC-34: not-owned and nonexistent are the same answer, so every
   * caller below turns null into an identical 404 — metadata, download and
   * removal included. Ownership runs through the parent Ticket, since that is
   * where it lives.
   */
  async function findOwnedAttachment(rawId: unknown, requesterId: number) {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) return null;

    const attachment = await prisma.attachment.findUnique({
      where: { id },
      select: {
        id: true,
        ticketId: true,
        originalFilename: true,
        storedFilename: true,
        mimeType: true,
        sizeBytes: true,
        isRemoved: true,
        removedAt: true,
        removedReason: true,
        createdAt: true,
        ticket: { select: { requesterId: true } },
      },
    });

    if (!attachment || attachment.ticket.requesterId !== requesterId) return null;
    return attachment;
  }

  /**
   * An Attachment the caller may read (specification.md §5.1, AC-45).
   *
   * A Requester reads their own Ticket's; IT Staff and Administrators read
   * any Ticket's. Reading is the only thing that widens: upload and removal
   * stay with the owning Requester and go through `findOwnedAttachment`.
   */
  async function findReadableAttachment(
    rawId: unknown,
    user: { id: number; role: string },
  ) {
    if (user.role === "REQUESTER") return findOwnedAttachment(rawId, user.id);

    const id = parseId(rawId);
    if (!id) return null;
    return prisma.attachment.findUnique({
      where: { id },
      select: {
        id: true,
        ticketId: true,
        originalFilename: true,
        storedFilename: true,
        mimeType: true,
        sizeBytes: true,
        isRemoved: true,
        removedAt: true,
        removedReason: true,
        createdAt: true,
        ticket: { select: { requesterId: true } },
      },
    });
  }

  /** The metadata shape api-spec.md §8 documents — never the stored filename. */
  function attachmentPayload(
    attachment: Awaited<ReturnType<typeof findOwnedAttachment>>,
  ) {
    if (!attachment) return null;
    const { storedFilename: _stored, ticket: _ticket, ...payload } = attachment;
    return payload;
  }


  // api-spec.md §8: one Attachment's metadata, active or removed.
  app.get("/api/attachments/:id", ...asAnyUser, async (req: AuthenticatedRequest, res) => {
    const attachment = await findReadableAttachment(
      req.params.id,
      req.auth!.user,
    );
    if (!attachment) {
      return res.status(404).json({ error: "Attachment not found" });
    }

    res.json(attachmentPayload(attachment));
  });

  // api-spec.md §9: the file itself.
  app.get("/api/attachments/:id/download", ...asAnyUser, async (req: AuthenticatedRequest, res) => {
    const attachment = await findReadableAttachment(
      req.params.id,
      req.auth!.user,
    );

    // BR-26/AC-21: a removed Attachment answers exactly as a nonexistent one
    // does. Deliberately not 410 — a distinct status would confirm to anyone
    // probing the URL that the file was once there.
    if (!attachment || attachment.isRemoved) {
      return res.status(404).json({ error: "Attachment not found" });
    }

    res.type(attachment.mimeType);
    res.setHeader(
      "Content-Disposition",
      // The original name is client-supplied, so quotes and control characters
      // are stripped before it reaches a header.
      `attachment; filename="${attachment.originalFilename.replace(/[\r\n"\\]/g, "")}"`,
    );
    res.sendFile(path.join(UPLOADS_DIR, attachment.storedFilename), (error) => {
      // The row can outlive its file (BR-23 keeps rows forever). Answer 404
      // rather than leaking a stack trace through the default handler.
      if (error && !res.headersSent) {
        res.status(404).json({ error: "Attachment not found" });
      }
    });
  });

  // api-spec.md §10: soft removal (BR-23/BR-24/BR-25).
  app.delete("/api/attachments/:id", ...asRequester, async (req: AuthenticatedRequest, res) => {
    const requesterId = req.auth!.user.id;

    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    // BR-25. Checked before the lookup so a bad reason cannot be used to probe
    // which Attachment ids exist.
    if (reason.length < 3) {
      return res.status(400).json({
        error: "Validation failed",
        fields: { reason: "A removal reason of at least 3 characters is required." },
      });
    }

    const attachment = await findOwnedAttachment(req.params.id, requesterId);
    if (!attachment) {
      return res.status(404).json({ error: "Attachment not found" });
    }

    // BR-23: the owner already knows this one exists, so 409 reveals nothing
    // new — unlike the ownership 404s above. This early exit is only a fast
    // path; the authoritative check is the guarded update below, because the
    // read above and the write are otherwise two statements a concurrent
    // request can interleave between.
    if (attachment.isRemoved) {
      return res.status(409).json({ error: "This Attachment was already removed" });
    }

    try {
      // `isRemoved: false` in the WHERE makes the check and the write one
      // atomic statement: a second concurrent removal matches zero rows and
      // is told so, instead of both callers succeeding and the later reason
      // silently overwriting the earlier one.
      const { count } = await prisma.attachment.updateMany({
        where: { id: attachment.id, isRemoved: false },
        data: { isRemoved: true, removedAt: new Date(), removedReason: reason },
      });

      if (count === 0) {
        return res.status(409).json({ error: "This Attachment was already removed" });
      }

      // Safe to re-read: removal is one-way, so nothing can change this row
      // again, and any concurrent caller took the 409 branch above.
      const removed = await prisma.attachment.findUniqueOrThrow({
        where: { id: attachment.id },
        select: {
          id: true,
          ticketId: true,
          originalFilename: true,
          mimeType: true,
          sizeBytes: true,
          isRemoved: true,
          removedAt: true,
          removedReason: true,
          createdAt: true,
        },
      });

      // BR-23 is explicit that the file stays on disk in Lab 2; nothing here
      // unlinks it.
      res.json(removed);
    } catch {
      res.status(500).json({ error: "Unable to remove the Attachment" });
    }
  });

  // Last, deliberately: Express picks the error handler by arity, and it only
  // sees what the routes above did not catch. Without it, an async handler that
  // rejects - a dropped database connection inside requireAuth, a bcrypt
  // failure in change-password - reaches Express's own handler, which renders
  // the stack trace and absolute file paths as HTML whenever NODE_ENV is not
  // production. AC-44 and BR-17 both forbid exactly that.
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      // Already streaming: hand it back to Express, whose default handler
      // destroys the socket. Returning quietly instead would leave a response
      // that failed mid-body hanging open until the client gave up.
      if (res.headersSent) return _next(error);

      // Not every error reaching here is a server fault. express.json() rejects
      // malformed JSON with status 400 and an oversized body with 413, and
      // reporting those as 500 sends somebody hunting a server outage over a
      // stray brace. The status is honoured; the message stays generic either
      // way, so nothing about the parser's internals is echoed back.
      const status = Number(
        (error as { status?: unknown; statusCode?: unknown })?.status ??
          (error as { statusCode?: unknown })?.statusCode,
      );
      if (Number.isInteger(status) && status >= 400 && status < 500) {
        return res.status(status).json({
          error:
            status === 413
              ? "Request body is too large"
              : "The request could not be read",
        });
      }

      // The detail belongs in the server log, where the operator can read it,
      // and nowhere near the response.
      console.error("Unhandled error:", error);
      res.status(500).json({ error: "Something went wrong. Please try again." });
    },
  );

  return app;
}
