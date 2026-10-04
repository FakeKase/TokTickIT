import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, createUser, fetchUsers, setInitialPassword, updateUser } from '../api'
import type { ManagedUser, Role, UserChanges } from '../api'
import { landingPathFor } from '../auth/landing'
import { useAuth } from '../auth/useAuth'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Field } from '../components/Field'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { initialPasswordProblem, validateUserForm } from './userValidation'
import type { UserForm, UserFormErrors } from './userValidation'
import './UserManagementPage.css'

const ROLES: { value: Role; label: string }[] = [
  { value: 'REQUESTER', label: 'Requester' },
  { value: 'IT_STAFF', label: 'IT Staff' },
  { value: 'ADMINISTRATOR', label: 'Administrator' },
]

const ROLE_LABEL = Object.fromEntries(ROLES.map((role) => [role.value, role.label])) as Record<
  Role,
  string
>

const SELF_REASON = 'You cannot deactivate your own account.'
const LAST_ADMIN_REASON =
  'This is the last active Administrator. Promote another Administrator first.'

type Load = 'loading' | 'ready' | 'forbidden' | 'failed'
type Editing = { mode: 'create' } | { mode: 'edit'; user: ManagedUser }

const BLANK: UserForm = { name: '', email: '', role: '', isActive: true, initialPassword: '' }

/**
 * The create and edit dialog (ui-spec.md §7).
 *
 * The two safety rules are shown as disabled controls with the reason beside
 * them, so an Administrator sees why rather than finding a control missing.
 * They are a courtesy: the server refuses the same changes whatever this
 * dialog allows (BR-32, BR-33), and a refusal from it is shown here too.
 */
function UserDialog({
  editing,
  currentUserId,
  onClose,
  onSaved,
}: {
  editing: Editing
  currentUserId: number
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const target = editing.mode === 'edit' ? editing.user : null
  const creating = !target

  const [form, setForm] = useState<UserForm>(
    target
      ? { name: target.name, email: target.email, role: target.role, isActive: target.isActive, initialPassword: '' }
      : BLANK,
  )
  const [errors, setErrors] = useState<UserFormErrors>({})
  const [conflict, setConflict] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // "Set new initial password" is its own small flow inside the edit dialog.
  const [resetting, setResetting] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [resetError, setResetError] = useState<string | null>(null)

  const isSelf = target?.id === currentUserId
  const isLastAdmin = Boolean(target?.isLastActiveAdministrator)
  const activeLocked = isSelf || isLastAdmin
  const activeReason = isSelf ? SELF_REASON : isLastAdmin ? LAST_ADMIN_REASON : null

  const set = <K extends keyof UserForm>(key: K, value: UserForm[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }))
    setErrors((previous) => ({ ...previous, [key]: undefined }))
  }

  /** Field-level problems from a 400, a duplicate email from a 409, or the
   *  server's own sentence for any other refusal. Nothing from a 500. */
  function showFailure(failure: unknown, fallback: string) {
    if (failure instanceof ApiError && failure.status === 400 && Object.keys(failure.fields).length) {
      setErrors(failure.fields as UserFormErrors)
    } else if (failure instanceof ApiError && failure.status === 409) {
      // A duplicate address is a problem with one field, so it is reported
      // on that field. The other two 409s are about the account as a whole.
      if (/email/i.test(failure.message)) setErrors({ email: failure.message })
      else setConflict(failure.message)
    } else {
      setConflict(fallback)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return

    const problems = validateUserForm(form, creating)
    setErrors(problems)
    setConflict(null)
    if (Object.keys(problems).length > 0) return

    const name = form.name.trim()
    const email = form.email.trim()
    const role = form.role as Role

    setSaving(true)
    try {
      if (creating) {
        await createUser({ name, email, role, isActive: form.isActive, initialPassword: form.initialPassword })
        onSaved(`${name} was created. They must change their password when they first sign in.`)
        return
      }

      // Only what changed is sent. An untouched email is then never
      // re-validated against itself, and an untouched Active box never trips
      // a rule it was not trying to break.
      const changes: UserChanges = {}
      if (name !== target.name) changes.name = name
      if (email.toLowerCase() !== target.email) changes.email = email
      if (role !== target.role) changes.role = role
      if (form.isActive !== target.isActive) changes.isActive = form.isActive

      if (Object.keys(changes).length > 0) await updateUser(target.id, changes)
      onSaved(`${name} was updated.`)
    } catch (failure) {
      showFailure(failure, 'The user could not be saved. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    if (!target || saving) return
    const problem = initialPasswordProblem(newPassword)
    setResetError(problem ?? null)
    if (problem) return

    setSaving(true)
    try {
      await setInitialPassword(target.id, newPassword)
      onSaved(
        `A new initial password was set for ${target.name}. They are signed out and must change it when they next sign in.`,
      )
    } catch (failure) {
      setResetError(
        failure instanceof ApiError && failure.fields.initialPassword
          ? failure.fields.initialPassword
          : 'The password could not be set. Please try again.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      title={creating ? 'New user' : `Edit ${target.name}`}
      // Not while a request is out. Cancel is disabled then, and Esc must not
      // be a way round it: if the dialog closed and the save then failed, the
      // failure would have nowhere to appear and the change would look made.
      onClose={() => {
        if (!saving) onClose()
      }}
    >
      <form className="ttk-user-form" onSubmit={handleSubmit} noValidate>
        {conflict && (
          <p className="ttk-field__error" role="alert">
            {conflict}
          </p>
        )}

        <Field id="user-name" label="Name" required error={errors.name}>
          {(attrs) => (
            <input
              {...attrs}
              type="text"
              autoComplete="off"
              value={form.name}
              onChange={(event) => set('name', event.target.value)}
            />
          )}
        </Field>

        <Field id="user-email" label="Email" required error={errors.email}>
          {(attrs) => (
            <input
              {...attrs}
              type="email"
              autoComplete="off"
              value={form.email}
              onChange={(event) => set('email', event.target.value)}
            />
          )}
        </Field>

        {/* A radio group, not a select: three options do not need a dropdown,
            and all three are visible at once. */}
        <fieldset
          className="ttk-user-form__group"
          aria-describedby={[isLastAdmin ? 'role-reason' : '', errors.role ? 'role-error' : '']
            .filter(Boolean)
            .join(' ') || undefined}
        >
          <legend className="ttk-field__label">Role</legend>
          {ROLES.map((role) => (
            <label key={role.value} className="ttk-user-form__choice">
              <input
                type="radio"
                name="user-role"
                value={role.value}
                checked={form.role === role.value}
                disabled={isLastAdmin}
                onChange={() => set('role', role.value)}
              />
              {role.label}
            </label>
          ))}
          {isLastAdmin && (
            <p id="role-reason" className="ttk-user-form__reason">
              {LAST_ADMIN_REASON}
            </p>
          )}
          {errors.role && (
            <p id="role-error" className="ttk-field__error" role="alert">
              {errors.role}
            </p>
          )}
        </fieldset>

        <div className="ttk-user-form__group">
          <label className="ttk-user-form__choice">
            <input
              type="checkbox"
              checked={form.isActive}
              disabled={activeLocked}
              aria-describedby={activeReason ? 'active-reason' : undefined}
              onChange={(event) => set('isActive', event.target.checked)}
            />
            Active
          </label>
          {activeReason && (
            <p id="active-reason" className="ttk-user-form__reason">
              {activeReason}
            </p>
          )}
        </div>

        {creating && (
          <Field
            id="user-initial-password"
            label="Initial password"
            required
            hint="At least 8 characters. The user must replace it when they first sign in."
            error={errors.initialPassword}
          >
            {(attrs) => (
              <input
                {...attrs}
                type="password"
                autoComplete="new-password"
                value={form.initialPassword}
                onChange={(event) => set('initialPassword', event.target.value)}
              />
            )}
          </Field>
        )}

        <div className="ttk-user-form__actions">
          <Button type="submit" busy={saving && !resetting} busyLabel="Saving…" disabled={saving}>
            {creating ? 'Create user' : 'Save changes'}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
        </div>
      </form>

      {target && (
        <div className="ttk-user-form__reset">
          {isSelf ? (
            // Setting your own would sign you out mid-task and then make you
            // change the password you had just chosen. There is a direct way.
            <p className="ttk-user-form__reason">
              To change your own password, use <Link to="/change-password">Change password</Link>.
              Setting an initial password here is for other people's accounts.
            </p>
          ) : !resetting ? (
            <Button variant="secondary" onClick={() => setResetting(true)} disabled={saving}>
              Set new initial password
            </Button>
          ) : (
            <>
              <Field
                id="user-new-password"
                label={`New initial password for ${target.name}`}
                hint="This signs them out everywhere. They must change it when they next sign in."
                error={resetError ?? undefined}
              >
                {(attrs) => (
                  <input
                    {...attrs}
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => {
                      setNewPassword(event.target.value)
                      setResetError(null)
                    }}
                  />
                )}
              </Field>
              <div className="ttk-user-form__actions">
                <Button busy={saving} busyLabel="Setting…" onClick={() => void handleReset()}>
                  Confirm new password
                </Button>
                <Button
                  variant="secondary"
                  disabled={saving}
                  onClick={() => {
                    setResetting(false)
                    setNewPassword('')
                    setResetError(null)
                  }}
                >
                  Keep current password
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Dialog>
  )
}

/**
 * Administrator User Management (ui-spec.md §7; FR-20 to FR-25).
 *
 * One screen, deliberately the plainest in the application: a list, a search,
 * a role filter, and one dialog. No pagination, no bulk actions, no delete
 * (BR-35, BR-38).
 */
export function UserManagementPage() {
  const { user, refresh } = useAuth()

  const [users, setUsers] = useState<ManagedUser[]>([])
  const [load, setLoad] = useState<Load>('loading')
  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('')
  const [role, setRole] = useState<Role | ''>('')
  const [editing, setEditing] = useState<Editing | null>(null)
  const [message, setMessage] = useState('')

  const loadUsers = useCallback(
    async (isCurrent: () => boolean = () => true, quiet = false) => {
      if (!quiet) setLoad('loading')
      try {
        const listed = await fetchUsers({ search: search || undefined, role: role || undefined })
        if (!isCurrent()) return
        setUsers(listed)
        setLoad('ready')
      } catch (failure) {
        if (!isCurrent()) return
        setLoad(failure instanceof ApiError && failure.status === 403 ? 'forbidden' : 'failed')
      }
    },
    [search, role],
  )

  useEffect(() => {
    let current = true
    void loadUsers(() => current)
    return () => {
      current = false
    }
  }, [loadUsers])

  if (!user) return null

  const filtered = Boolean(search || role)

  function clearFilters() {
    setSearchText('')
    setSearch('')
    setRole('')
  }

  return (
    <div className="ttk-users">
      <div className="ttk-users__head">
        <h2>User Management</h2>
        <Button
          onClick={() => {
            setMessage('')
            setEditing({ mode: 'create' })
          }}
        >
          New user
        </Button>
      </div>

      {/* After the dialog closes, on the list it changed. A polite region, so
          it is announced without taking focus from where it returned to. */}
      <p className={message ? 'ttk-users__message' : 'ttk-visually-hidden'} role="status">
        {message}
      </p>

      {load !== 'forbidden' && (
        <form
          className="ttk-users__controls"
          role="search"
          onSubmit={(event) => {
            event.preventDefault()
            setSearch(searchText.trim())
          }}
        >
          <Field id="user-search" label="Search" className="ttk-users__search">
            {(attrs) => (
              <input
                {...attrs}
                type="search"
                placeholder="Name or email"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
              />
            )}
          </Field>

          <Field id="user-role-filter" label="Role">
            {(attrs) => (
              <select
                {...attrs}
                value={role}
                onChange={(event) => {
                  // Whatever is typed in the box goes with it, so the box
                  // never shows a term the list does not reflect.
                  setSearch(searchText.trim())
                  setRole(event.target.value as Role | '')
                }}
              >
                <option value="">All roles</option>
                {ROLES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <div className="ttk-users__actions">
            <Button type="submit">Search</Button>
            {filtered && (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        </form>
      )}

      {load === 'loading' && <LoadingSpinner label="Loading users…" />}

      {load === 'forbidden' && (
        <ErrorState
          title="You do not have permission to view this page"
          message="Your account does not have access to User Management."
          actionLabel="Go to your home page"
          actionTo={landingPathFor(user.role)}
        />
      )}

      {load === 'failed' && (
        <ErrorState
          title="Unable to load the users"
          message="The user list could not be loaded. Check that the TokTickIT API is running, then try again."
          onRetry={() => void loadUsers()}
        />
      )}

      {load === 'ready' && users.length === 0 && !filtered && <EmptyState title="No users yet." />}

      {load === 'ready' && users.length === 0 && filtered && (
        <EmptyState
          title="No users match this search."
          action={
            <Button variant="secondary" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      )}

      {load === 'ready' && users.length > 0 && (
        <>
          <div className="ttk-users__table-wrap">
            <table className="ttk-users__table">
              <caption className="ttk-visually-hidden">Users</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="ttk-visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((listed) => (
                  <tr key={listed.id}>
                    <td>
                      {listed.name}
                      {listed.id === user.id && <span className="ttk-users__you"> (you)</span>}
                    </td>
                    <td className="ttk-users__email">{listed.email}</td>
                    <td>
                      <Badge className="ttk-users__role">{ROLE_LABEL[listed.role]}</Badge>
                    </td>
                    <td>
                      <Badge tone={listed.isActive ? 'pale' : 'neutral'}>
                        {listed.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="ttk-users__edit">
                      <Button
                        variant="secondary"
                        aria-label={`Edit ${listed.name}`}
                        onClick={() => {
                          setMessage('')
                          setEditing({ mode: 'edit', user: listed })
                        }}
                      >
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="ttk-users__cards">
            {users.map((listed) => (
              <li key={listed.id} className="ttk-users__card">
                <p className="ttk-users__card-name">
                  {listed.name}
                  {listed.id === user.id && <span className="ttk-users__you"> (you)</span>}
                </p>
                <p className="ttk-users__email">{listed.email}</p>
                <p className="ttk-users__card-badges">
                  <Badge className="ttk-users__role">{ROLE_LABEL[listed.role]}</Badge>{' '}
                  <Badge tone={listed.isActive ? 'pale' : 'neutral'}>
                    {listed.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </p>
                <Button
                  variant="secondary"
                  aria-label={`Edit ${listed.name}`}
                  onClick={() => {
                    setMessage('')
                    setEditing({ mode: 'edit', user: listed })
                  }}
                >
                  Edit
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}

      {editing && (
        <UserDialog
          editing={editing}
          currentUserId={user.id}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            // An Administrator who edited their own account is, to the rest
            // of the app, still who they were when they signed in. Re-read
            // the session so the header, the nav and the route guard catch
            // up: after a self-demotion that is the difference between a
            // Forbidden page under an "Administrator" badge and one that
            // makes sense.
            if (editing.mode === 'edit' && editing.user.id === user.id) void refresh()
            setEditing(null)
            setMessage(saved)
            // Reloaded rather than patched: who the last Administrator is can
            // change with any edit, and only the server knows.
            void loadUsers(undefined, true)
          }}
        />
      )}
    </div>
  )
}
