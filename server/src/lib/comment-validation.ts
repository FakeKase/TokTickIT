import type { CommentVisibility } from "../generated/prisma/enums.js";

/** BR-25. 2000 characters is the same ceiling Ticket descriptions use: a
 *  comment that needs more than a page of prose is a document, and belongs in
 *  an Attachment where it can be read and downloaded. */
export const COMMENT_MAX = 2000;

export interface CommentInput {
  body?: unknown;
  visibility?: unknown;
}

export type CommentResult =
  | { ok: true; value: { body: string; visibility: CommentVisibility } }
  | { ok: false; fields: Record<string, string> };

/**
 * Validates a comment before anything is written.
 *
 * `visibility` defaults to PUBLIC rather than being required: every Requester
 * only ever posts public, and a required field they can only set one way is a
 * field the client will eventually get wrong. A caller who means INTERNAL says
 * so, and the route decides whether their role may.
 */
export function validateComment(input: CommentInput): CommentResult {
  const fields: Record<string, string> = {};

  const raw = typeof input.body === "string" ? input.body : "";
  const body = raw.trim();
  if (!body) {
    // Whitespace-only lands here too, which is the point of trimming first:
    // a comment of three spaces is empty to every reader of it.
    fields.body = "Enter a comment";
  } else if (body.length > COMMENT_MAX) {
    fields.body = `Must be at most ${COMMENT_MAX} characters`;
  }

  const visibility =
    input.visibility === undefined ? "PUBLIC" : input.visibility;
  if (visibility !== "PUBLIC" && visibility !== "INTERNAL") {
    fields.visibility = "Must be PUBLIC or INTERNAL";
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return {
    ok: true,
    value: { body, visibility: visibility as CommentVisibility },
  };
}
