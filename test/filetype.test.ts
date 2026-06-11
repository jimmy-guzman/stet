import { describe, expect, test } from "bun:test"
import { filetypeFor, supportedFiletypeFor } from "../src/filetype"

describe("supportedFiletypeFor", () => {
  test("returns bundled OpenTUI parser filetypes", () => {
    expect(supportedFiletypeFor("src/a.ts")).toBe("typescript")
    expect(supportedFiletypeFor("src/a.tsx")).toBe("typescript")
    expect(supportedFiletypeFor("src/a.js")).toBe("javascript")
    expect(supportedFiletypeFor("src/a.jsx")).toBe("javascript")
    expect(supportedFiletypeFor("README.md")).toBe("markdown")
    expect(supportedFiletypeFor("docs/page.mdx")).toBe("markdown")
    expect(supportedFiletypeFor("src/main.zig")).toBe("zig")
  })

  test("returns vendored parser filetypes", () => {
    expect(supportedFiletypeFor("package.json")).toBe("json")
    expect(supportedFiletypeFor("tsconfig.jsonc")).toBe("json")
    expect(supportedFiletypeFor(".github/workflows/ci.yml")).toBe("yaml")
    expect(supportedFiletypeFor("config.yaml")).toBe("yaml")
  })

  test("leaves unsupported filetypes undefined", () => {
    expect(supportedFiletypeFor("src/a.css")).toBeUndefined()
    expect(supportedFiletypeFor("src/a.py")).toBeUndefined()
    expect(supportedFiletypeFor("Makefile")).toBeUndefined()
  })
})

describe("filetypeFor", () => {
  test("falls back to text", () => {
    expect(filetypeFor("src/a.css")).toBe("text")
  })
})
