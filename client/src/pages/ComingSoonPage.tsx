import { Card } from '../components/Card'
import './ComingSoonPage.css'

/**
 * A placeholder for a screen a later Issue builds, mounted behind the real
 * route and the real role guard.
 *
 * It exists so the shell is honest now: `landingPathFor` sends Administrators
 * to /admin/users and the nav links there. Without a route behind it that
 * would fall through to the catch-all redirect — an app that looks broken,
 * caused by a screen that simply has not been written yet.
 *
 * Replaced by the real screen in its own Issue; the route and guard around it
 * do not change when that happens.
 */
export function ComingSoonPage({ title, issue }: { title: string; issue: string }) {
  return (
    <div className="ttk-coming-soon">
      <h1 className="ttk-coming-soon__title">{title}</h1>
      <Card>
        <p>
          This screen is being built in {issue}. Your account can reach it — the route and its
          role check are already in place.
        </p>
      </Card>
    </div>
  )
}
