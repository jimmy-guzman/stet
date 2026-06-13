import { Atom } from "effect/unstable/reactivity"
import { emptyActivityLog, lastChangedAt, latestActivity, RECENT_MS } from "../activity"

export const activityLogAtom = Atom.make(emptyActivityLog).pipe(Atom.keepAlive)

export const recencyByPathAtom = Atom.make((get) => lastChangedAt(get(activityLogAtom)))

// Mirrors the old useActivity clock: ticks "Ns ago" labels once a second while
// Activity is recent, then stays quiescent so an idle session does not re-render.
export const nowAtom = Atom.make((get) => {
  const latest = latestActivity(get(activityLogAtom))
  const now = Date.now()

  if (latest !== undefined && now - latest.at < RECENT_MS) {
    const id = setInterval(() => {
      const tick = Date.now()
      get.setSelf(tick)
      if (tick - latest.at >= RECENT_MS) {
        clearInterval(id)
      }
    }, 1000)
    get.addFinalizer(() => clearInterval(id))
  }

  return now
}).pipe(Atom.keepAlive)
