import { SyntaxStyle, getTreeSitterClient, type TreeSitterClient } from "@opentui/core"
import { supportedFiletypeFor } from "./filetype"

export type SyntaxConfig =
  | {
      enabled: true
      style: SyntaxStyle
      treeSitterClient: TreeSitterClient
      status: string
    }
  | {
      enabled: false
      status: string
    }

export const sideyeSyntaxStyle = SyntaxStyle.fromStyles({
  default: { fg: "#e4e4e7" },
  comment: { fg: "#71717a", dim: true },
  punctuation: { fg: "#a1a1aa" },
  keyword: { fg: "#ff4fb8", bold: true },
  type: { fg: "#f0abfc" },
  "type.builtin": { fg: "#f0abfc", bold: true },
  string: { fg: "#86efac" },
  number: { fg: "#fbbf24" },
  boolean: { fg: "#fbbf24", bold: true },
  constant: { fg: "#fbbf24" },
  function: { fg: "#67e8f9" },
  method: { fg: "#67e8f9" },
  property: { fg: "#93c5fd" },
  variable: { fg: "#e4e4e7" },
  "variable.builtin": { fg: "#f0abfc" },
  operator: { fg: "#f5a3d7" },
  tag: { fg: "#ff4fb8" },
  label: { fg: "#93c5fd" },
  markup: { fg: "#e4e4e7" },
  "markup.heading": { fg: "#ff4fb8", bold: true },
  "markup.link": { fg: "#67e8f9", underline: true },
  "markup.raw": { fg: "#86efac" },
})

export async function createSyntaxConfig(): Promise<SyntaxConfig> {
  try {
    const treeSitterClient = getTreeSitterClient()
    await treeSitterClient.initialize()
    return {
      enabled: true,
      style: sideyeSyntaxStyle,
      treeSitterClient,
      status: "syntax highlighting ready",
    }
  } catch (error) {
    return {
      enabled: false,
      status: error instanceof Error ? `syntax disabled: ${error.message}` : "syntax disabled",
    }
  }
}

export function diffFiletypeFor(path: string, syntax: SyntaxConfig) {
  if (!syntax.enabled) {
    return "text"
  }

  return supportedFiletypeFor(path) ?? "text"
}
