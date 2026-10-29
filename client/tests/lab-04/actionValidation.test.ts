import { describe, expect, it } from 'vitest'
import {
  ACTION_DESCRIPTION_MAX,
  ACTION_RESULT_MAX,
  ATTACHMENT_NOTES_MAX,
  FOLLOW_UP_NOTE_MAX,
  actionFormFrom,
  emptyActionForm,
  fromLocalInput,
  toActionInput,
  toLocalInput,
  validateActionForm,
} from '../../src/pages/actionValidation'
import type { ActionFormValues } from '../../src/pages/actionValidation'

// UNIT-05 (BR-05, BR-06, BR-07; AC-07, AC-09). The form's own copy of the
// rules, for feedback before a request is sent. The server's copy is tested
// in server/tests/lab-04/action-validation.unit.test.ts with the same bounds.

// Built from local parts, so the test reads the same in any time zone.
const NOW = new Date(2026, 9, 6, 12, 0, 0)
const TICKET_CREATED = new Date(2026, 9, 6, 10, 0, 30).toISOString()
const context = { ticketCreatedAt: TICKET_CREATED, now: NOW }

const valid = (overrides: Partial<ActionFormValues> = {}): ActionFormValues => ({
  actionAt: '2026-10-06T11:00',
  description: 'Replaced the projector lamp.',
  result: 'Projector powers on.',
  followUpRequired: false,
  followUpNote: '',
  attachmentNotes: '',
  ...overrides,
})

const errorsOf = (overrides: Partial<ActionFormValues>) => validateActionForm(valid(overrides), context)

describe('the datetime-local value', () => {
  it('is local wall-clock time to the minute, and reads back as the same moment', () => {
    const moment = new Date(2026, 9, 6, 9, 5, 42)

    expect(toLocalInput(moment)).toBe('2026-10-06T09:05')
    expect(fromLocalInput('2026-10-06T09:05')).toEqual(new Date(2026, 9, 6, 9, 5, 0))
  })

  it('is not a moment when it is empty or malformed', () => {
    for (const value of ['', 'tomorrow', '2026-10-06', '2026-13-40T99:99']) {
      expect(fromLocalInput(value)).toBeNull()
    }
  })

  it('starts a new form at the current minute, which is always valid', () => {
    const form = emptyActionForm(NOW)

    expect(form.actionAt).toBe('2026-10-06T12:00')
    expect(form.followUpRequired).toBe(false)
    // Everything except the two fields nobody has typed in yet.
    expect(Object.keys(validateActionForm(form, context)).sort()).toEqual(['description', 'result'])
  })
})

describe('Action Date/Time (BR-05)', () => {
  it('is required', () => {
    expect(errorsOf({ actionAt: '' })).toHaveProperty('actionAt')
  })

  it('accepts the minute the Ticket was created in, and nothing earlier', () => {
    // The Ticket was created at 10:00:30. The form cannot say 10:00:30, so
    // 10:00 has to pass even though it is 30 seconds too early.
    expect(errorsOf({ actionAt: '2026-10-06T10:00' })).toEqual({})
    expect(errorsOf({ actionAt: '2026-10-06T09:59' })).toHaveProperty('actionAt')
  })

  it('accepts the prefilled time on a Ticket created earlier in the same minute', () => {
    const justNow = new Date(2026, 9, 6, 12, 0, 45)
    const form = { ...valid(), actionAt: emptyActionForm(justNow).actionAt }

    expect(
      validateActionForm(form, { ticketCreatedAt: new Date(2026, 9, 6, 12, 0, 20).toISOString(), now: justNow }),
    ).toEqual({})
  })

  it('accepts up to 5 minutes ahead and nothing later', () => {
    expect(errorsOf({ actionAt: '2026-10-06T12:05' })).toEqual({})
    expect(errorsOf({ actionAt: '2026-10-06T12:06' })).toHaveProperty('actionAt')
  })
})

describe('the text fields (BR-06)', () => {
  it.each([
    ['description', ACTION_DESCRIPTION_MAX],
    ['result', ACTION_RESULT_MAX],
  ] as const)('%s is required and limited to %i after trimming', (field, max) => {
    expect(errorsOf({ [field]: '' })).toHaveProperty(field)
    expect(errorsOf({ [field]: '   ' })).toHaveProperty(field)
    expect(errorsOf({ [field]: 'x'.repeat(max) })).toEqual({})
    expect(errorsOf({ [field]: ` ${'x'.repeat(max)} ` })).toEqual({})
    expect(errorsOf({ [field]: 'x'.repeat(max + 1) })).toHaveProperty(field)
  })

  it('Attachment Notes is optional and limited to 500', () => {
    expect(errorsOf({ attachmentNotes: '' })).toEqual({})
    expect(errorsOf({ attachmentNotes: 'x'.repeat(ATTACHMENT_NOTES_MAX) })).toEqual({})
    expect(errorsOf({ attachmentNotes: 'x'.repeat(ATTACHMENT_NOTES_MAX + 1) })).toHaveProperty('attachmentNotes')
  })
})

describe('Follow-up Note (BR-07)', () => {
  it('is required while follow-up is ticked, on its own field', () => {
    expect(errorsOf({ followUpRequired: true })).toEqual({ followUpNote: 'Say what follow-up is needed.' })
    expect(errorsOf({ followUpRequired: true, followUpNote: '  ' })).toHaveProperty('followUpNote')
    expect(errorsOf({ followUpRequired: true, followUpNote: 'x'.repeat(FOLLOW_UP_NOTE_MAX + 1) })).toHaveProperty(
      'followUpNote',
    )
    expect(errorsOf({ followUpRequired: true, followUpNote: 'Come back Friday.' })).toEqual({})
  })

  it('is neither checked nor sent while the field is hidden', () => {
    const hidden = valid({ followUpRequired: false, followUpNote: 'x'.repeat(FOLLOW_UP_NOTE_MAX + 1) })

    expect(validateActionForm(hidden, context)).toEqual({})
    expect(toActionInput(hidden).followUpNote).toBeNull()
  })
})

describe('what is sent', () => {
  it('is trimmed, with the time as an instant and empty options as null', () => {
    const input = toActionInput(
      valid({ description: '  Replaced the lamp.  ', result: ' Works. ', attachmentNotes: '   ' }),
    )

    expect(input).toEqual({
      actionAt: new Date(2026, 9, 6, 11, 0, 0).toISOString(),
      description: 'Replaced the lamp.',
      result: 'Works.',
      followUpRequired: false,
      followUpNote: null,
      attachmentNotes: null,
    })
    expect(Object.keys(input)).not.toContain('performedBy')
  })

  it('round-trips an existing Action Taken into the form and back', () => {
    const form = actionFormFrom({
      id: 1,
      ticketId: 42,
      actionAt: new Date(2026, 9, 6, 11, 0, 0).toISOString(),
      description: 'Replaced the lamp.',
      result: 'Works.',
      followUpRequired: true,
      followUpNote: 'Order a spare.',
      attachmentNotes: null,
      performedBy: { id: 9, name: 'Sarah Chen' },
      createdAt: '2026-10-06T04:10:00.000Z',
      editedBy: null,
      editedAt: null,
      version: 3,
    })

    expect(form).toEqual({
      actionAt: '2026-10-06T11:00',
      description: 'Replaced the lamp.',
      result: 'Works.',
      followUpRequired: true,
      followUpNote: 'Order a spare.',
      attachmentNotes: '',
    })
    expect(toActionInput(form)).toMatchObject({ followUpNote: 'Order a spare.', attachmentNotes: null })
  })
})
