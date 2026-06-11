import type { CopyReferencePayload } from "./copy-reference"

export type ParsedDiffLine = {
  type: "context" | "add" | "remove"
  oldLine?: number
  newLine?: number
  content: string
  raw: string
}

export type ParsedHunk = {
  index: number
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: ParsedDiffLine[]
}

export type ParsedPatch = {
  header: string[]
  hunks: ParsedHunk[]
}

const hunkPattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

export function parsePatch(diff: string): ParsedPatch {
  const header: string[] = []
  const hunks: ParsedHunk[] = []
  let current: ParsedHunk | undefined
  let oldLine = 0
  let newLine = 0
  // the @@ header's line counts say exactly how much body follows; while they
  // are unspent, every -/+/space line is content — even raw "---…"/"+++…",
  // which only mark file headers between hunks (e.g. a removed "-- comment")
  let remainingOld = 0
  let remainingNew = 0

  for (const raw of diff.split("\n")) {
    if (current !== undefined && (remainingOld > 0 || remainingNew > 0)) {
      if (raw.startsWith("+")) {
        current.lines.push({ type: "add", newLine, content: raw.slice(1), raw })
        newLine += 1
        remainingNew -= 1
        continue
      }

      if (raw.startsWith("-")) {
        current.lines.push({ type: "remove", oldLine, content: raw.slice(1), raw })
        oldLine += 1
        remainingOld -= 1
        continue
      }

      if (raw.startsWith(" ")) {
        current.lines.push({ type: "context", oldLine, newLine, content: raw.slice(1), raw })
        oldLine += 1
        newLine += 1
        remainingOld -= 1
        remainingNew -= 1
        continue
      }

      if (raw.startsWith("\\")) {
        // "\ No newline at end of file" annotates the previous line
        continue
      }

      // anything else means the counts were inconsistent; close the hunk
      remainingOld = 0
      remainingNew = 0
    }

    const hunkMatch = raw.match(hunkPattern)
    if (hunkMatch !== null) {
      current = {
        index: hunks.length,
        header: raw,
        oldStart: Number.parseInt(hunkMatch[1], 10),
        oldLines: Number.parseInt(hunkMatch[2] ?? "1", 10),
        newStart: Number.parseInt(hunkMatch[3], 10),
        newLines: Number.parseInt(hunkMatch[4] ?? "1", 10),
        lines: [],
      }
      oldLine = current.oldStart
      newLine = current.newStart
      remainingOld = current.oldLines
      remainingNew = current.newLines
      hunks.push(current)
      continue
    }

    if (hunks.length === 0 && raw !== "") {
      header.push(raw)
    }
  }

  return { header, hunks }
}

export function lineReference(path: string, line: ParsedDiffLine): CopyReferencePayload {
  return { path, line: line.newLine ?? line.oldLine, snippet: line.content }
}

export function renderPatch(diff: string, options: { full: boolean; maxLines: number }) {
  const parsed = parsePatch(diff)
  if (parsed.hunks.length === 0) {
    return { diff, truncated: false, parsed, bodyLineCount: 0 }
  }

  const lines: string[] = [...parsed.header]
  let emittedBodyLines = 0
  let truncated = false

  for (const hunk of parsed.hunks) {
    if (!options.full && emittedBodyLines >= options.maxLines) {
      truncated = true
      break
    }

    lines.push(hunk.header)

    for (const line of hunk.lines) {
      if (!options.full && emittedBodyLines >= options.maxLines) {
        truncated = true
        break
      }

      lines.push(line.raw)
      emittedBodyLines += 1
    }

    if (truncated) {
      break
    }
  }

  return { diff: lines.join("\n"), truncated, parsed, bodyLineCount: emittedBodyLines }
}
