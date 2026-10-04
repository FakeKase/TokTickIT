import type { Role } from '../api'

// BR-13, BR-37 on the client. The server holds the same rules and is the one
// that counts (api-spec.md §15); these exist so a mistake is pointed out
// beside the field before a request is spent on it.

export const NAME_MIN = 2
export const NAME_MAX = 80
export const EMAIL_MAX = 120
export const PASSWORD_MIN = 8
export const PASSWORD_MAX_BYTES = 72

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface UserForm {
  name: string
  email: string
  role: Role | ''
  isActive: boolean
  initialPassword: string
}

export type UserFormErrors = Partial<Record<keyof UserForm, string>>

/** Bytes, not characters: bcrypt's limit is 72 bytes, and a Thai character is
 *  three of them. */
export function initialPasswordProblem(password: string): string | undefined {
  if (!password) return 'Enter an initial password'
  if (password.length < PASSWORD_MIN) return `Must be at least ${PASSWORD_MIN} characters`
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return `Must be at most ${PASSWORD_MAX_BYTES} bytes, which is about ${PASSWORD_MAX_BYTES} letters and fewer in scripts that use multi-byte characters`
  }
  return undefined
}

export function validateUserForm(form: UserForm, creating: boolean): UserFormErrors {
  const errors: UserFormErrors = {}
  const name = form.name.trim()
  const email = form.email.trim()

  if (!name) errors.name = 'Enter a name'
  else if (name.length < NAME_MIN) errors.name = `Must be at least ${NAME_MIN} characters`
  else if (name.length > NAME_MAX) errors.name = `Must be at most ${NAME_MAX} characters`

  if (!email) errors.email = 'Enter an email address'
  else if (email.length > EMAIL_MAX) errors.email = `Must be at most ${EMAIL_MAX} characters`
  else if (!EMAIL_SHAPE.test(email)) errors.email = 'Enter a valid email address'

  if (!form.role) errors.role = 'Choose a role'

  if (creating) {
    const problem = initialPasswordProblem(form.initialPassword)
    if (problem) errors.initialPassword = problem
  }

  return errors
}
