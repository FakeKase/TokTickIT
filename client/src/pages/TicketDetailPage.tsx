import { useParams } from 'react-router-dom'
import { Card } from '../components/Card'

/**
 * Requester Ticket Detail stub (ui-spec.md §6.4). The read-only header card
 * and attachment management panel land in a later Lab 2 issue.
 */
export function TicketDetailPage() {
  const { id } = useParams<{ id: string }>()

  return (
    <div className="ttk-page-stub">
      <Card>
        <h2>Ticket Detail</h2>
        <p>This screen arrives in a later Lab 2 issue.{id ? ` (Ticket #${id})` : ''}</p>
      </Card>
    </div>
  )
}
