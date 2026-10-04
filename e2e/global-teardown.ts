import { runCleanup } from './cleanup'

/** Removes what the suite created, once it has finished. */
export default function globalTeardown() {
  runCleanup()
}
