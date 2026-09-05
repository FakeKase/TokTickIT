// BR-19/BR-20/BR-21: attachment constraints, all fixed by the handout §4.5.

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ACTIVE_ATTACHMENTS = 5;

// BR-19 is explicit that the check is on the declared MIME type, "not
// filename extension alone" — so this map is keyed by MIME. The extension is
// cross-checked as a secondary signal, which catches a .exe renamed to .png
// that also lies about its Content-Type only if the two disagree.
export const ALLOWED_MIME_TYPES: Record<string, readonly string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
};

export const ALLOWED_TYPES_LABEL = "JPG, JPEG, PNG, WEBP, PDF";

export function isAllowedAttachment(
  originalFilename: string,
  mimeType: string,
): boolean {
  const extensions = ALLOWED_MIME_TYPES[mimeType];
  if (!extensions) return false;

  // A path separator means this is not a bare filename. Reject rather than
  // let it reach anything that builds a storage path.
  if (originalFilename.includes("/") || originalFilename.includes("\\")) {
    return false;
  }

  const lastDot = originalFilename.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === originalFilename.length - 1) return false;

  const extension = originalFilename.slice(lastDot + 1).toLowerCase();
  return extensions.includes(extension);
}
