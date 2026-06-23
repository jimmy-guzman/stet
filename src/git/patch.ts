import type { CopyReferencePayload } from "../clipboard/reference";

export function lineReference(
  path: string,
  line: { newLine?: number; oldLine?: number; content: string },
): CopyReferencePayload {
  return { line: line.newLine ?? line.oldLine, path, snippet: line.content };
}
