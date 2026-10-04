import bcrypt from "bcryptjs";

/** specification.md §11: bcryptjs at cost 10, the same value the seed and the
 *  migration use, so a hash written by any of the three verifies against the
 *  others. */
const COST = 10;

/** BR-13. The upper bound is bcrypt's, not a policy choice: bcrypt truncates
 *  its input at 72 **bytes**, so a longer password would silently have its tail
 *  ignored and two different passwords could both unlock the account.
 *
 *  Bytes, not characters, and the distinction is not academic: 72 Thai
 *  characters are 216 bytes, and `"ก".repeat(72).length` is 72. Measuring in
 *  `.length` would wave through exactly the input the limit exists to stop. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX_BYTES = 72;

export const passwordBytes = (password: string) => Buffer.byteLength(password, "utf8");

export const hashPassword = (plain: string) => bcrypt.hash(plain, COST);

export const verifyPassword = (plain: string, hash: string) =>
  bcrypt.compare(plain, hash);

export interface PasswordChangeInput {
  currentPassword?: unknown;
  newPassword?: unknown;
  confirmPassword?: unknown;
}

export type PasswordChangeResult =
  | { ok: true; value: { currentPassword: string; newPassword: string } }
  | { ok: false; fields: Record<string, string> };

/** BR-13, validated before anything is hashed. Field-level messages so the UI
 *  can attach each one to the control that caused it (ui-spec.md §1.2): the
 *  confirmation mismatch belongs on the confirmation field, not on the new
 *  password the user probably typed correctly. */
export function validatePasswordChange(
  input: PasswordChangeInput,
): PasswordChangeResult {
  const fields: Record<string, string> = {};
  const currentPassword =
    typeof input.currentPassword === "string" ? input.currentPassword : "";
  const newPassword =
    typeof input.newPassword === "string" ? input.newPassword : "";
  const confirmPassword =
    typeof input.confirmPassword === "string" ? input.confirmPassword : "";

  if (!currentPassword) fields.currentPassword = "Enter your current password";

  if (!newPassword) {
    fields.newPassword = "Enter a new password";
  } else if (newPassword.length < PASSWORD_MIN) {
    fields.newPassword = `Must be at least ${PASSWORD_MIN} characters`;
  } else if (passwordBytes(newPassword) > PASSWORD_MAX_BYTES) {
    fields.newPassword = `Must be at most ${PASSWORD_MAX_BYTES} bytes — about ${PASSWORD_MAX_BYTES} letters, fewer in scripts that use multi-byte characters`;
  } else if (newPassword === currentPassword) {
    // The point of the first-login change is to stop using the password
    // somebody else chose. Re-entering it would satisfy the flag and defeat
    // the rule, so this is checked even though the pair is otherwise valid.
    fields.newPassword = "Choose a password different from your current one";
  }

  if (!confirmPassword) {
    fields.confirmPassword = "Re-enter the new password";
  } else if (newPassword && confirmPassword !== newPassword) {
    fields.confirmPassword = "This does not match the new password";
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: { currentPassword, newPassword } };
}
