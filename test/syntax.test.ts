import { getTreeSitterClient } from "@opentui/core"
import { describe, expect, test } from "bun:test"
import { diffFiletypeFor, torreSyntaxStyle, type SyntaxConfig } from "../src/syntax"

const disabledSyntax: SyntaxConfig = {
  enabled: false,
  status: "syntax disabled",
}

const enabledSyntax: SyntaxConfig = {
  enabled: true,
  status: "syntax highlighting ready",
  style: torreSyntaxStyle,
  treeSitterClient: getTreeSitterClient(),
}

describe("diffFiletypeFor", () => {
  test("uses supported parser filetypes when syntax is enabled", () => {
    expect(diffFiletypeFor("src/App.tsx", enabledSyntax)).toBe("typescript")
    expect(diffFiletypeFor("README.md", enabledSyntax)).toBe("markdown")
  })

  test("falls back to text for unsupported or disabled syntax", () => {
    expect(diffFiletypeFor("package.json", enabledSyntax)).toBe("text")
    expect(diffFiletypeFor("src/App.tsx", disabledSyntax)).toBe("text")
  })
})
