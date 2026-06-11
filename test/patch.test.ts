import { describe, expect, test } from "bun:test"
import { lineReference, parsePatch, renderPatch } from "../src/patch"

const diff = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const a = 1
-const b = 2
+const b = 3
+const c = 4
 const d = 5`

describe("parsePatch", () => {
  test("parses hunks and line anchors", () => {
    const parsed = parsePatch(diff)

    expect(parsed.hunks).toHaveLength(1)
    expect(parsed.hunks[0]?.lines.map((line) => [line.type, line.oldLine, line.newLine])).toEqual([
      ["context", 1, 1],
      ["remove", 2, undefined],
      ["add", undefined, 2],
      ["add", undefined, 3],
      ["context", 3, 4],
    ])
  })

  test("builds a copy reference for a diff line", () => {
    const lines = parsePatch(diff).hunks[0]?.lines ?? []
    const added = lines.find((line) => line.type === "add")
    expect(added === undefined ? undefined : lineReference("src/a.ts", added)).toEqual({
      path: "src/a.ts",
      line: 2,
      snippet: "const b = 3",
    })
    const removed = lines.find((line) => line.type === "remove")
    expect(removed === undefined ? undefined : lineReference("src/a.ts", removed)).toEqual({
      path: "src/a.ts",
      line: 2,
      snippet: "const b = 2",
    })
  })

  test("renders the full patch and flags truncation", () => {
    const full = renderPatch(diff, { full: true, maxLines: 100 })
    expect(full.truncated).toBe(false)
    expect(full.diff).toContain("const c = 4")
    expect(renderPatch(diff, { full: false, maxLines: 1 }).truncated).toBe(true)
  })
})
