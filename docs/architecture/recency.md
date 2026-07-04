# Recency

Recency markers come from an append-only in-memory activity event log (the seam for a future persistence layer). They decay silently: fresh under 5s, recent under 30s. `.` jumps to the latest activity. A scope switch is not activity.
