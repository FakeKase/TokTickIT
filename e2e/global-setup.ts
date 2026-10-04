import { runCleanup } from './cleanup'

/**
 * Clears fixtures before the suite as well as after it.
 *
 * The teardown only runs when a run finishes. One that was interrupted leaves
 * its Tickets and users behind, and without this they would be in the next
 * run's screenshots.
 */
export default function globalSetup() {
  runCleanup()
}
