import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createAction, fetchActions, updateAction } from '../../src/api'
import type { ActionTaken, ActionTakenInput } from '../../src/api'

// The client side of Lab 4 api-spec.md §1 to §3: what is sent, and what a
// refusal looks like to the screen that has to act on it. The screens
// themselves arrive with Issue #68.

const ACTION: ActionTaken = {
  id: 12,
  ticketId: 42,
  actionAt: '2026-10-06T03:15:00.000Z',
  description: 'Replaced the projector lamp.',
  result: 'Projector powers on.',
  followUpRequired: false,
  followUpNote: null,
  attachmentNotes: null,
  performedBy: { id: 9, name: 'Sarah Chen' },
  createdAt: '2026-10-06T03:20:11.000Z',
  editedBy: null,
  editedAt: null,
  version: 1,
}

const INPUT: ActionTakenInput = {
  actionAt: ACTION.actionAt,
  description: ACTION.description,
  result: ACTION.result,
  followUpRequired: false,
  followUpNote: null,
  attachmentNotes: null,
}

function answer(status: number, body: unknown) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(Response.json(body, { status }))
}

const sent = (spy: ReturnType<typeof answer>) => {
  const [url, init] = spy.mock.calls[0] as [string, RequestInit]
  return { url, init, body: JSON.parse(String(init.body ?? 'null')) as Record<string, unknown> }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchActions', () => {
  it('reads the Actions Taken of one Ticket, with the session cookie', async () => {
    const spy = answer(200, [ACTION])

    expect(await fetchActions(42)).toEqual([ACTION])
    expect(sent(spy).url).toMatch(/\/api\/tickets\/42\/actions$/)
    expect(sent(spy).init.credentials).toBe('include')
  })
})

describe('createAction', () => {
  it('sends the request key and the six entered fields, and no performer', async () => {
    const spy = answer(201, ACTION)

    await createAction(42, 'key-12345678', INPUT)

    const { url, init, body } = sent(spy)
    expect(url).toMatch(/\/api\/tickets\/42\/actions$/)
    expect(init.method).toBe('POST')
    expect(body).toEqual({ requestKey: 'key-12345678', ...INPUT })
    expect(Object.keys(body).some((key) => key.toLowerCase().includes('performed'))).toBe(false)
  })

  it('carries field messages and the conflict code to the caller', async () => {
    answer(400, { error: 'Validation failed', fields: { followUpNote: 'Say what follow-up is needed' } })
    const invalid = await createAction(42, 'key-12345678', INPUT).catch((error: unknown) => error)
    expect(invalid).toBeInstanceOf(ApiError)
    expect((invalid as ApiError).fields).toEqual({ followUpNote: 'Say what follow-up is needed' })
    expect((invalid as ApiError).code).toBeUndefined()

    vi.restoreAllMocks()
    answer(409, { error: 'This Ticket is Resolved. Reopen it to record more work.', code: 'TICKET_NOT_ACTIVE' })
    const frozen = (await createAction(42, 'key-12345678', INPUT).catch((error: unknown) => error)) as ApiError
    expect(frozen.status).toBe(409)
    expect(frozen.code).toBe('TICKET_NOT_ACTIVE')
    expect(frozen.message).toMatch(/Resolved/)
  })
})

describe('updateAction', () => {
  it('sends the version the edit was based on', async () => {
    const spy = answer(200, { ...ACTION, version: 2 })

    await updateAction(42, 12, 1, INPUT)

    const { url, init, body } = sent(spy)
    expect(url).toMatch(/\/api\/tickets\/42\/actions\/12$/)
    expect(init.method).toBe('PATCH')
    expect(body).toEqual({ expectedVersion: 1, ...INPUT })
  })

  it('hands a stale edit the row as it now stands', async () => {
    const current = { ...ACTION, description: 'Edited by a colleague.', version: 2 }
    answer(409, { error: 'This Action Taken was changed by someone else.', code: 'STALE_ACTION', current })

    const stale = (await updateAction(42, 12, 1, INPUT).catch((error: unknown) => error)) as ApiError

    expect(stale.code).toBe('STALE_ACTION')
    expect(stale.body.current).toEqual(current)
  })

  it('still reports the status when the error body is not JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }))

    const failure = (await updateAction(42, 12, 1, INPUT).catch((error: unknown) => error)) as ApiError

    expect(failure.status).toBe(502)
    expect(failure.code).toBeUndefined()
    expect(failure.body).toEqual({})
    expect(failure.message).toBe('Unable to save the Action Taken')
  })
})
