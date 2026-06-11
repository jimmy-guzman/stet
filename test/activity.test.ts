import { describe, expect, test } from "bun:test"
import { emptyActivityLog, FRESH_MS, lastChangedAt, latestActivity, recencyLevel, recordActivity, RECENT_MS } from "../src/activity"

describe("recordActivity", () => {
  test("returns the same log when nothing changed", () => {
    expect(recordActivity(emptyActivityLog, [], 1_000)).toBe(emptyActivityLog)
  })

  test("appends events with the injected clock", () => {
    const log = recordActivity(emptyActivityLog, [{ path: "a.ts", kind: "changed" }], 1_000)
    expect(log.events).toEqual([{ path: "a.ts", kind: "changed", at: 1_000 }])
  })

  test("caps the log at the most recent events", () => {
    let log = emptyActivityLog
    for (let index = 0; index < 1_200; index += 1) {
      log = recordActivity(log, [{ path: `f${index}.ts`, kind: "changed" }], index)
    }

    expect(log.events.length).toBe(1_000)
    expect(log.events[0]?.path).toBe("f200.ts")
  })
})

describe("derived views", () => {
  test("lastChangedAt keeps the latest timestamp per path", () => {
    let log = recordActivity(emptyActivityLog, [{ path: "a.ts", kind: "appeared" }], 1_000)
    log = recordActivity(
      log,
      [
        { path: "a.ts", kind: "changed" },
        { path: "b.ts", kind: "changed" },
      ],
      2_000,
    )

    expect(lastChangedAt(log).get("a.ts")).toBe(2_000)
    expect(lastChangedAt(log).get("b.ts")).toBe(2_000)
  })

  test("latestActivity returns the newest event", () => {
    let log = recordActivity(emptyActivityLog, [{ path: "a.ts", kind: "changed" }], 1_000)
    log = recordActivity(log, [{ path: "b.ts", kind: "removed" }], 2_000)

    expect(latestActivity(log)).toEqual({ path: "b.ts", kind: "removed", at: 2_000 })
  })
})

describe("recencyLevel", () => {
  test("decays from fresh to recent to none", () => {
    expect(recencyLevel(1_000, 1_000)).toBe("fresh")
    expect(recencyLevel(1_000, 1_000 + FRESH_MS - 1)).toBe("fresh")
    expect(recencyLevel(1_000, 1_000 + FRESH_MS)).toBe("recent")
    expect(recencyLevel(1_000, 1_000 + RECENT_MS - 1)).toBe("recent")
    expect(recencyLevel(1_000, 1_000 + RECENT_MS)).toBe("none")
    expect(recencyLevel(undefined, 1_000)).toBe("none")
  })
})
