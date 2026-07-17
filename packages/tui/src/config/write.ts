import { Result } from "effect";
import { applyEdits, createScanner, modify, SyntaxKind } from "jsonc-parser";

import { loadConfigText } from "./load";

/**
 * The session values `ctrl-s` can persist: exactly the signals whose keys the config schema owns,
 * never transient view state (folds, tabs, open overlays). `theme` may hold a `{ dark, light }`
 * pair only when it came from the config untouched, so a pair never diverges and is never written
 * back wholesale.
 */
export interface SettingsSnapshot {
  appearance: "dark" | "light";
  changesOnly: boolean;
  iconsEnabled: boolean;
  provenanceEnabled: boolean;
  searchCaseSensitive: boolean;
  searchRegex: boolean;
  searchScope: "changed" | "repo";
  sidebarOpen: boolean;
  /** The manual width override; undefined is the responsive default (key absent). */
  sidebarWidth: number | undefined;
  theme: string | { dark: string; light: string } | undefined;
  wrap: boolean;
}

interface SettingEdit {
  /** Feature-level label for the notice; edits sharing one dedupe to it. */
  label: string;
  path: (string | number)[];
  /** Undefined removes the key. */
  value: string | number | boolean | undefined;
}

const formattingOptions = { insertSpaces: true, tabSize: 2 };

function themeEquals(a: SettingsSnapshot["theme"], b: SettingsSnapshot["theme"]) {
  if (typeof a === "string" || typeof b === "string" || a === undefined || b === undefined) {
    return a === b;
  }
  return a.dark === b.dark && a.light === b.light;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The theme edit carries #113's pair rule: a picked name lands on the current
// Appearance's half when the file holds a `{ dark, light }` pair (the other half
// Survives), and the `auto` selection removes the key entirely.
function themeEdit(snapshot: SettingsSnapshot, fileTheme: SettingsSnapshot["theme"]): SettingEdit {
  if (typeof snapshot.theme === "string" && isRecord(fileTheme)) {
    return { label: "theme", path: ["theme", snapshot.appearance], value: snapshot.theme };
  }
  return {
    label: "theme",
    path: ["theme"],
    value: typeof snapshot.theme === "string" ? snapshot.theme : undefined,
  };
}

function diff(
  label: string,
  path: (string | number)[],
  session: string | number | boolean | undefined,
  file: string | number | boolean | undefined,
): SettingEdit[] {
  return session === file ? [] : [{ label, path, value: session }];
}

// A targeted edit on an unreadable document risks the file, so both fail.
function parseIssue(text: string) {
  try {
    return isRecord(Bun.JSONC.parse(text))
      ? undefined
      : "config is not a JSONC object; nothing saved";
  } catch {
    return "config is not valid JSONC; nothing saved";
  }
}

function parses(text: string) {
  try {
    Bun.JSONC.parse(text);
    return true;
  } catch {
    return false;
  }
}

// Token-based (never a regex over raw text, which could reach a comma inside a
// String or comment): a comma whose previous non-trivia token opens an object or
// Array is the structural dangling separator the removal left behind.
function stripDanglingCommas(text: string) {
  const trivia = new Set([
    SyntaxKind.Trivia,
    SyntaxKind.LineBreakTrivia,
    SyntaxKind.LineCommentTrivia,
    SyntaxKind.BlockCommentTrivia,
  ]);
  const scanner = createScanner(text, false);
  const dangling: { length: number; offset: number }[] = [];
  let previous: SyntaxKind | undefined;
  for (let kind = scanner.scan(); kind !== SyntaxKind.EOF; kind = scanner.scan()) {
    if (trivia.has(kind)) {
      continue;
    }
    if (
      kind === SyntaxKind.CommaToken &&
      (previous === SyntaxKind.OpenBraceToken || previous === SyntaxKind.OpenBracketToken)
    ) {
      dangling.push({ length: scanner.getTokenLength(), offset: scanner.getTokenOffset() });
    }
    previous = kind;
  }
  return dangling.reduceRight(
    (current, comma) => current.slice(0, comma.offset) + current.slice(comma.offset + comma.length),
    text,
  );
}

/**
 * Rewrites `text` so the config's settings match the snapshot, as minimal jsonc-parser edits that
 * keep the user's comments and values. Only keys whose effective file value differs from the
 * snapshot are edited (jsonc-parser may re-lay-out lines adjacent to an insertion, but their values
 * and comments survive). Fails (writing nothing) when the document cannot be parsed.
 *
 * @returns The updated text plus the deduped feature labels that changed; an empty `saved` means
 *   the file already matches and needs no write.
 */
export function updateSettingsText(
  text: string,
  snapshot: SettingsSnapshot,
): Result.Result<{ text: string; saved: string[] }, string> {
  const source = text.trim() === "" ? "{}" : text;
  const issue = parseIssue(source);
  if (issue !== undefined) {
    return Result.fail(issue);
  }
  const { config } = loadConfigText(source);

  const edits: SettingEdit[] = [
    ...(themeEquals(snapshot.theme, config.theme) ? [] : [themeEdit(snapshot, config.theme)]),
    ...diff("icons", ["icons", "enabled"], snapshot.iconsEnabled, config.icons?.enabled ?? true),
    ...diff("wrap", ["viewer", "wrap"], snapshot.wrap, config.viewer?.wrap ?? false),
    ...diff("sidebar", ["sidebar", "open"], snapshot.sidebarOpen, config.sidebar?.open ?? true),
    ...diff("sidebar", ["sidebar", "width"], snapshot.sidebarWidth, config.sidebar?.width),
    ...diff(
      "changes only",
      ["sidebar", "changesOnly"],
      snapshot.changesOnly,
      config.sidebar?.changesOnly ?? false,
    ),
    ...diff(
      "provenance",
      ["provenance", "enabled"],
      snapshot.provenanceEnabled,
      config.provenance?.enabled ?? false,
    ),
    ...diff("search", ["search", "regex"], snapshot.searchRegex, config.search?.regex ?? false),
    ...diff(
      "search",
      ["search", "caseSensitive"],
      snapshot.searchCaseSensitive,
      config.search?.caseSensitive ?? false,
    ),
    ...diff("search", ["search", "scope"], snapshot.searchScope, config.search?.scope ?? "changed"),
  ];

  if (edits.length === 0) {
    return Result.succeed({ saved: [], text });
  }

  const updated = edits.reduce(
    (current, edit) =>
      applyEdits(current, modify(current, edit.path, edit.value, { formattingOptions })),
    source,
  );
  // Removing the only property leaves jsonc-parser's edit dangling the property's
  // JSONC trailing comma (`{ , }`, measured against jsonc-parser 3.3.1), so a
  // Result that no longer parses gets that one comma stripped and is checked
  // Again; anything still broken fails without writing.
  const repaired = parses(updated) ? updated : stripDanglingCommas(updated);
  if (!parses(repaired)) {
    return Result.fail("could not edit config; nothing saved");
  }
  return Result.succeed({
    saved: [...new Set(edits.map((edit) => edit.label))],
    text: repaired,
  });
}
