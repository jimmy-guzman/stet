# Performance

- Performance is part of the design. A slow interface is an ugly interface.
- Budget the critical path. The first interaction should feel immediate; the git-backed tree renders before any checker resolves.
- Stay within the frame budget or do not animate. Drop the effect before you ship jank.
- Reserve space for async content. No layout shift.
- Render only what is visible plus a small overscan; window long content rather than building every row.
- Debounce and throttle expensive handlers. Input must never feel laggy.
