import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { contentToContextPatch, loadFileContent, MAX_FILE_LINES, textContent } from "../src/file-view"
import { parsePatch } from "../src/patch"

describe("textContent", () => {
  test("normalizes the trailing newline and counts lines", () => {
    expect(textContent("a\nb\n", true)).toEqual({ kind: "text", content: "a\nb", lineCount: 2, truncated: false })
  })

  test("handles empty files", () => {
    expect(textContent("", true)).toEqual({ kind: "text", content: "", lineCount: 0, truncated: false })
  })

  test("truncates long files unless full is requested", () => {
    const long = Array.from({ length: MAX_FILE_LINES + 10 }, (_, index) => `line ${index}`).join("\n")
    const truncated = textContent(long, false)
    expect(truncated).toMatchObject({ kind: "text", lineCount: MAX_FILE_LINES + 10, truncated: true })
    expect(textContent(long, true)).toMatchObject({ truncated: false })
  })
})

describe("contentToContextPatch", () => {
  test("produces a parseable all-context patch with correct line numbers", () => {
    const patch = contentToContextPatch("src/a.ts", "const a = 1\nconst b = 2")
    const parsed = parsePatch(patch)

    expect(parsed.hunks.length).toBe(1)
    expect(parsed.hunks[0]?.lines.map((line) => line.type)).toEqual(["context", "context"])
    expect(parsed.hunks[0]?.lines.map((line) => line.newLine)).toEqual([1, 2])
    expect(parsed.hunks[0]?.lines[1]?.content).toBe("const b = 2")
  })

  test("renders empty content as a patch with no hunks", () => {
    expect(parsePatch(contentToContextPatch("src/a.ts", "")).hunks).toEqual([])
  })
})

describe("loadFileContent", () => {
  const dir = mkdtempSync(join(tmpdir(), "sideye-file-view-"))

  test("reads text files from disk", () => {
    writeFileSync(join(dir, "a.ts"), "const a = 1\n")
    expect(loadFileContent(dir, "a.ts", { full: false })).toEqual({ kind: "text", content: "const a = 1", lineCount: 1, truncated: false })
  })

  test("detects binary files", () => {
    writeFileSync(join(dir, "blob.bin"), Buffer.from([0x89, 0x50, 0x00, 0x47]))
    expect(loadFileContent(dir, "blob.bin", { full: false })).toEqual({ kind: "binary" })
  })

  test("reports missing files", () => {
    expect(loadFileContent(dir, "nope.ts", { full: false })).toEqual({ kind: "missing" })
  })
})
