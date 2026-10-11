import type { RequesterDashboard, StaffDashboard } from '../../src/api'

/** A staff dashboard with something in every part. */
export function staffDashboard(overrides: Partial<StaffDashboard> = {}): StaffDashboard {
  return {
    generatedAt: '2026-10-06T04:00:00.000Z',
    timeZone: 'Asia/Bangkok',
    metrics: [
      { key: 'unassigned', value: 2, query: 'owner=unassigned&status=ACTIVE' },
      { key: 'myTickets', value: 4, query: 'owner=me&status=ACTIVE' },
      { key: 'urgent', value: 1, query: 'itPriority=URGENT&status=ACTIVE' },
      { key: 'myActionsToday', value: 3, query: null },
    ],
    byStatus: [
      { status: 'NEW', value: 5, query: 'status=NEW' },
      { status: 'OPEN', value: 0, query: 'status=OPEN' },
      { status: 'IN_PROGRESS', value: 7, query: 'status=IN_PROGRESS' },
      { status: 'WAITING_FOR_REQUESTER', value: 1, query: 'status=WAITING_FOR_REQUESTER' },
      { status: 'RESOLVED', value: 2, query: 'status=RESOLVED' },
      { status: 'CLOSED', value: 9, query: 'status=CLOSED' },
      { status: 'REOPENED', value: 0, query: 'status=REOPENED' },
      { status: 'CANCELLED', value: 1, query: 'status=CANCELLED' },
    ],
    recentlyUpdated: [
      {
        id: 42,
        ticketNumber: 'TKT-2026-000042',
        summary: 'Projector in LX-204 will not power on',
        currentStatus: 'IN_PROGRESS',
        itPriority: 'URGENT',
        owner: { id: 9, name: 'Sarah Chen' },
        updatedAt: '2026-10-06T03:00:00.000Z',
      },
      {
        id: 43,
        ticketNumber: 'TKT-2026-000043',
        summary: 'Cannot print from the library',
        currentStatus: 'NEW',
        itPriority: 'MEDIUM',
        owner: null,
        updatedAt: '2026-10-06T02:00:00.000Z',
      },
    ],
    myRecentActions: [
      {
        id: 12,
        ticketId: 42,
        ticketNumber: 'TKT-2026-000042',
        ticketSummary: 'Projector in LX-204 will not power on',
        actionAt: '2026-10-06T03:00:00.000Z',
        descriptionPreview: 'Replaced the projector lamp in LX-204.',
        followUpRequired: true,
      },
      {
        id: 11,
        ticketId: 40,
        ticketNumber: 'TKT-2026-000040',
        ticketSummary: 'Laptop battery',
        actionAt: '2026-10-05T03:00:00.000Z',
        descriptionPreview: 'Ordered a replacement battery.',
        followUpRequired: false,
      },
    ],
    ...overrides,
  }
}

export function requesterDashboard(
  overrides: Partial<RequesterDashboard> = {},
): RequesterDashboard {
  return {
    generatedAt: '2026-10-06T04:00:00.000Z',
    timeZone: 'Asia/Bangkok',
    metrics: [
      { key: 'openTickets', value: 3, query: 'status=ACTIVE' },
      { key: 'waitingForYou', value: 1, query: 'status=WAITING_FOR_REQUESTER' },
      { key: 'resolved', value: 0, query: 'status=RESOLVED' },
      { key: 'closed', value: 4, query: 'status=CLOSED' },
    ],
    needsAttention: [
      {
        id: 42,
        ticketNumber: 'TKT-2026-000042',
        summary: 'Projector in LX-204 will not power on',
        currentStatus: 'WAITING_FOR_REQUESTER',
        updatedAt: '2026-10-05T03:00:00.000Z',
      },
    ],
    recentlyUpdated: [
      {
        id: 44,
        ticketNumber: 'TKT-2026-000044',
        summary: 'New keyboard',
        currentStatus: 'OPEN',
        updatedAt: '2026-10-06T03:00:00.000Z',
      },
      {
        id: 42,
        ticketNumber: 'TKT-2026-000042',
        summary: 'Projector in LX-204 will not power on',
        currentStatus: 'WAITING_FOR_REQUESTER',
        updatedAt: '2026-10-05T03:00:00.000Z',
      },
    ],
    recentlyResolved: [
      {
        id: 40,
        ticketNumber: 'TKT-2026-000040',
        summary: 'Laptop battery',
        currentStatus: 'CLOSED',
        updatedAt: '2026-10-04T03:00:00.000Z',
        resolvedAt: '2026-10-03T03:00:00.000Z',
      },
    ],
    ...overrides,
  }
}

export const emptyRequesterDashboard = (): RequesterDashboard =>
  requesterDashboard({
    metrics: [
      { key: 'openTickets', value: 0, query: 'status=ACTIVE' },
      { key: 'waitingForYou', value: 0, query: 'status=WAITING_FOR_REQUESTER' },
      { key: 'resolved', value: 0, query: 'status=RESOLVED' },
      { key: 'closed', value: 0, query: 'status=CLOSED' },
    ],
    needsAttention: [],
    recentlyUpdated: [],
    recentlyResolved: [],
  })

/** `/path?query#hash` of a link, as the router wrote it. */
export const hrefOf = (element: HTMLElement) => element.getAttribute('href')
