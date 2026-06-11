import { describe, expect, test } from "bun:test"
import {
  buildFileTree,
  defaultExpandedDirectories,
  expandAncestorsForPath,
  findRowIndexForPath,
  firstFileInNode,
  flattenTree,
} from "../src/tree"
import type { ChangedFile, RepoFile } from "../src/git"

function changed(path: string, overrides: Partial<ChangedFile> = {}): ChangedFile {
  return { path, kind: "modified", stage: "unstaged", additions: 1, deletions: 0, binary: false, warnings: [], mtimeMs: 0, ...overrides }
}

const repoFiles: RepoFile[] = [
  { path: "README.md", tracked: true },
  { path: "src/App.tsx", tracked: true },
  { path: "src/git.ts", tracked: true },
  { path: "src/components/ui/Button.tsx", tracked: true },
  { path: "notes.md", tracked: false },
]

const changedByPath = new Map([
  ["src/App.tsx", changed("src/App.tsx", { kind: "added", stage: "staged", additions: 10, warnings: ["new"] })],
  ["src/git.ts", changed("src/git.ts", { additions: 3, deletions: 1 })],
])

describe("buildFileTree", () => {
  test("includes unchanged files with a change overlay on changed ones", () => {
    const tree = buildFileTree(repoFiles, changedByPath, { changesOnly: false })
    const rows = flattenTree(tree, new Set(["dir:src"]))
    const appRow = rows.find((row) => row.node.path === "src/App.tsx")
    const readmeRow = rows.find((row) => row.node.path === "README.md")

    expect(appRow?.node.type === "file" && appRow.node.changed?.kind).toBe("added")
    expect(readmeRow?.node.type === "file" && readmeRow.node.changed).toBe(undefined)
  })

  test("sorts directories first, then alphabetically", () => {
    const tree = buildFileTree(repoFiles, changedByPath, { changesOnly: false })
    expect(tree.map((node) => node.name)).toEqual(["src", "notes.md", "README.md"])
  })

  test("aggregates churn and changed counts from changed descendants only", () => {
    const tree = buildFileTree(repoFiles, changedByPath, { changesOnly: false })
    const src = tree.find((node) => node.type === "directory" && node.path === "src")

    expect(src).toMatchObject({ type: "directory", additions: 13, deletions: 1, fileCount: 3, changedCount: 2 })
  })

  test("flattens single-child directory chains", () => {
    const tree = buildFileTree(repoFiles, changedByPath, { changesOnly: false })
    const src = tree.find((node) => node.type === "directory" && node.path === "src")
    const chain = src?.type === "directory" ? src.children.find((node) => node.type === "directory") : undefined

    expect(chain?.name).toBe("components/ui")
    expect(chain?.path).toBe("src/components/ui")
    expect(chain?.id).toBe("dir:src/components/ui")
  })

  test("changes-only filter prunes unchanged files", () => {
    const tree = buildFileTree(repoFiles, changedByPath, { changesOnly: true })
    const rows = flattenTree(tree, new Set(["dir:src"]))

    expect(rows.map((row) => row.node.path)).toEqual(["src", "src/App.tsx", "src/git.ts"])
  })

  test("keeps files that vanished from the index but are in the changed set", () => {
    const deleted = changed("src/gone.ts", { kind: "deleted", stage: "staged", additions: 0, deletions: 12 })
    const tree = buildFileTree(repoFiles, new Map([...changedByPath, ["src/gone.ts", deleted]]), { changesOnly: false })
    const rows = flattenTree(tree, new Set(["dir:src"]))

    expect(rows.map((row) => row.node.path)).toContain("src/gone.ts")
  })

  test("assigns visual depths after flattening", () => {
    const tree = buildFileTree(repoFiles, changedByPath, { changesOnly: false })
    const rows = flattenTree(tree, new Set(["dir:src", "dir:src/components/ui"]))
    const button = rows.find((row) => row.node.path === "src/components/ui/Button.tsx")

    expect(button?.node.depth).toBe(2)
  })
})

describe("expansion", () => {
  test("default expansion covers ancestors of changed paths only", () => {
    const expanded = defaultExpandedDirectories(["src/App.tsx", "src/components/ui/Button.tsx"])
    expect(Array.from(expanded).toSorted()).toEqual(["dir:src", "dir:src/components", "dir:src/components/ui"])
  })

  test("expands ancestors for a selected path", () => {
    expect(Array.from(expandAncestorsForPath(new Set(), "src/ui/App.tsx"))).toEqual(["dir:src", "dir:src/ui"])
  })
})

describe("navigation helpers", () => {
  test("finds the row index for a path", () => {
    const tree = buildFileTree(repoFiles, changedByPath, { changesOnly: false })
    const rows = flattenTree(tree, new Set(["dir:src"]))
    expect(findRowIndexForPath(rows, "src/git.ts")).toBeGreaterThan(0)
  })

  test("finds the first file in a directory", () => {
    const tree = buildFileTree(repoFiles, changedByPath, { changesOnly: false })
    const src = tree.find((node) => node.type === "directory" && node.path === "src")

    expect(src === undefined ? undefined : firstFileInNode(src)?.path).toBe("src/components/ui/Button.tsx")
  })
})
