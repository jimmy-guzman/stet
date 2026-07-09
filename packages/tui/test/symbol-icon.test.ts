import { expect, test } from "bun:test";

import { SymbolKind } from "@/intel/protocol";
import { symbolKindIcon, symbolKindTag } from "@/utils/symbol-icon";

test("symbolKindIcon returns the codicon glyph for a known kind", () => {
  expect(symbolKindIcon(SymbolKind.Class)).toBe("\u{eb5b}");
  expect(symbolKindIcon(SymbolKind.Method)).toBe("\u{ea8c}");
  expect(symbolKindIcon(SymbolKind.Variable)).toBe("\u{ea88}");
});

test("symbolKindIcon falls back to the misc glyph for an unknown kind", () => {
  expect(symbolKindIcon(999)).toBe("\u{eb63}");
});

test("symbolKindTag returns a 3-cell tag for a known kind", () => {
  expect(symbolKindTag(SymbolKind.Class)).toBe("cls");
  expect(symbolKindTag(SymbolKind.Function)).toBe("fn ");
  expect(symbolKindTag(SymbolKind.Variable)).toBe("var");
  expect(symbolKindTag(SymbolKind.Class)).toHaveLength(3);
  expect(symbolKindTag(SymbolKind.Function)).toHaveLength(3);
});

test("symbolKindTag falls back to sym for an unknown kind", () => {
  expect(symbolKindTag(999)).toBe("sym");
});
