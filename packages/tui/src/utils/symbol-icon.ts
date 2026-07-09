/**
 * Nerd Font (v3) codicon glyphs for LSP `SymbolKind`, plus a font-independent text tag fallback.
 * Every code point is the `cod-symbol_*` glyph taken verbatim from the official Nerd Fonts
 * `glyphnames.json` (identical to VS Code's codicon range), never hand-guessed, so each is a real
 * named glyph. They show as icons ONLY under a Nerd Font; without one they tofu, which is why the
 * symbol overlay gates the glyph on `iconsEnabled` and shows `symbolKindTag` instead when off.
 *
 * The glyph name behind each code (for future edits): class cod-symbol_class, method
 * cod-symbol_method, function cod-symbol_method (shared codicon), constructor cod-symbol_method,
 * variable cod-symbol_variable, constant cod-symbol_constant, field cod-symbol_field, property
 * cod-symbol_property, interface cod-symbol_interface, enum cod-symbol_enum, enum_member
 * cod-symbol_enum_member, struct cod-symbol_structure, namespace/module/package/object
 * cod-symbol_namespace, file cod-symbol_file, string cod-symbol_string, number cod-symbol_numeric,
 * boolean/null cod-symbol_boolean, array cod-symbol_array, key cod-symbol_key, event
 * cod-symbol_event, operator cod-symbol_operator, parameter cod-symbol_parameter, misc (fallback)
 * cod-symbol_misc.
 */
import { SymbolKind } from "@/intel/protocol";

const MISC = "\u{eb63}";

// Keyed by the numeric LSP `SymbolKind`. An unknown/unmapped kind falls back to `MISC`.
const GLYPH_BY_KIND = new Map<number, string>([
  [SymbolKind.File, "\u{eb60}"],
  [SymbolKind.Module, "\u{ea8b}"],
  [SymbolKind.Namespace, "\u{ea8b}"],
  [SymbolKind.Package, "\u{ea8b}"],
  [SymbolKind.Class, "\u{eb5b}"],
  [SymbolKind.Method, "\u{ea8c}"],
  [SymbolKind.Property, "\u{eb65}"],
  [SymbolKind.Field, "\u{eb5f}"],
  [SymbolKind.Constructor, "\u{ea8c}"],
  [SymbolKind.Enum, "\u{ea95}"],
  [SymbolKind.Interface, "\u{eb61}"],
  [SymbolKind.Function, "\u{ea8c}"],
  [SymbolKind.Variable, "\u{ea88}"],
  [SymbolKind.Constant, "\u{eb5d}"],
  [SymbolKind.String, "\u{eb8d}"],
  [SymbolKind.Number, "\u{ea90}"],
  [SymbolKind.Boolean, "\u{ea8f}"],
  [SymbolKind.Array, "\u{ea8a}"],
  [SymbolKind.Object, "\u{ea8b}"],
  [SymbolKind.Key, "\u{ea93}"],
  [SymbolKind.Null, "\u{ea8f}"],
  [SymbolKind.EnumMember, "\u{eb5e}"],
  [SymbolKind.Struct, "\u{ea91}"],
  [SymbolKind.Event, "\u{ea86}"],
  [SymbolKind.Operator, "\u{eb64}"],
  [SymbolKind.TypeParameter, "\u{ea92}"],
]);

// A short, fixed-width (3-cell) text tag per kind for the `--no-icons` fallback: always readable,
// No font dependency. Padded to 3 so the following name column starts at the same cell.
const TAG_BY_KIND = new Map<number, string>([
  [SymbolKind.File, "fil"],
  [SymbolKind.Module, "mod"],
  [SymbolKind.Namespace, "ns "],
  [SymbolKind.Package, "pkg"],
  [SymbolKind.Class, "cls"],
  [SymbolKind.Method, "mth"],
  [SymbolKind.Property, "prp"],
  [SymbolKind.Field, "fld"],
  [SymbolKind.Constructor, "ctr"],
  [SymbolKind.Enum, "enm"],
  [SymbolKind.Interface, "ifc"],
  [SymbolKind.Function, "fn "],
  [SymbolKind.Variable, "var"],
  [SymbolKind.Constant, "cst"],
  [SymbolKind.String, "str"],
  [SymbolKind.Number, "num"],
  [SymbolKind.Boolean, "bln"],
  [SymbolKind.Array, "arr"],
  [SymbolKind.Object, "obj"],
  [SymbolKind.Key, "key"],
  [SymbolKind.Null, "nul"],
  [SymbolKind.EnumMember, "mem"],
  [SymbolKind.Struct, "srt"],
  [SymbolKind.Event, "evt"],
  [SymbolKind.Operator, "op "],
  [SymbolKind.TypeParameter, "typ"],
]);

/** The codicon glyph for a `SymbolKind`; an unknown kind gets the generic misc glyph. */
export function symbolKindIcon(kind: number): string {
  return GLYPH_BY_KIND.get(kind) ?? MISC;
}

/** The 3-cell text tag for a `SymbolKind` (the `--no-icons` fallback); unknown kinds get `sym`. */
export function symbolKindTag(kind: number): string {
  return TAG_BY_KIND.get(kind) ?? "sym";
}
