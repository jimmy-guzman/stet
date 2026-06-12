import { useEffect, useMemo, useState } from "react"
import { emptyActivityLog, lastChangedAt, latestActivity, RECENT_MS } from "../activity"

// Owns the activity log and the recency clock that keeps "Ns ago" labels ticking
export function useActivity() {
  const [activityLog, setActivityLog] = useState(emptyActivityLog)
  const [now, setNow] = useState(() => Date.now())
  const recencyByPath = useMemo(() => lastChangedAt(activityLog), [activityLog])

  useEffect(() => {
    const latest = latestActivity(activityLog)
    if (latest === undefined || now - latest.at >= RECENT_MS) {
      return
    }

    const id = setTimeout(() => setNow(Date.now()), 1000)
    return () => clearTimeout(id)
  }, [activityLog, now])

  return { activityLog, now, recencyByPath, setActivityLog }
}
