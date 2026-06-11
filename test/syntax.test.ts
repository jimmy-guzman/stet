import { getTreeSitterClient } from "@opentui/core"
import { describe, expect, test } from "bun:test"
import { diffFiletypeFor, sideyeSyntaxStyle, type SyntaxConfig } from "../src/syntax"

const disabledSyntax: SyntaxConfig = {
  enabled: false,
  status: "syntax disabled",
}

const enabledSyntax: SyntaxConfig = {
  enabled: true,
  status: "syntax highlighting ready",
  style: sideyeSyntaxStyle,
  treeSitterClient: getTreeSitterClient(),
}

describe("diffFiletypeFor", () => {
  test("uses supported parser filetypes when syntax is enabled", () => {
    expect(diffFiletypeFor("src/App.tsx", enabledSyntax)).toBe("typescript")
    expect(diffFiletypeFor("README.md", enabledSyntax)).toBe("markdown")
    expect(diffFiletypeFor("package.json", enabledSyntax)).toBe("json")
    expect(diffFiletypeFor("tsconfig.jsonc", enabledSyntax)).toBe("json")
    expect(diffFiletypeFor(".github/workflows/ci.yml", enabledSyntax)).toBe("yaml")
    expect(diffFiletypeFor("config.yaml", enabledSyntax)).toBe("yaml")
  })

  test("falls back to text for unsupported or disabled syntax", () => {
    expect(diffFiletypeFor("bun.lock", enabledSyntax)).toBe("text")
    expect(diffFiletypeFor("src/App.tsx", disabledSyntax)).toBe("text")
  })
})
