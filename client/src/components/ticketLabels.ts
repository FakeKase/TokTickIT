import type { ItPriority, TicketStatus } from '../api'

/**
 * The words for a status and an IT Priority, shared by the badges and by the
 * filter controls that offer the same values. Kept apart from the badge
 * components so a file that exports components exports only components.
 */

export const STATUS_LABEL: Record<TicketStatus, string> = {
  NEW: 'New',
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  WAITING_FOR_REQUESTER: 'Waiting for Requester',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  REOPENED: 'Reopened',
  CANCELLED: 'Cancelled',
}

export const IT_PRIORITY_LABEL: Record<ItPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
}
