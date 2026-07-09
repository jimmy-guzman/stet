import util from "node:util";

import { KEY_HELP } from "@/help/keys";

export type ScopeKind = "unstaged" | "staged" | "all" | "session" | "last-commit" | "commit";

// Picker order, also the single source of truth for the scope list. Grouped for the
// Menu: the "changes" scopes (all/staged/unstaged) then the "history" scopes
// (session/last-commit); the menu draws its section headers off this split. `commit`
// Is absent: it is entered through the picker's commit drill-down, never applied as a
// Top-level row (so `indexOf` a `commit` scope is a benign -1).
export const scopeKinds: readonly ScopeKind[] = [
  "all",
  "staged",
  "unstaged",
  "session",
  "last-commit",
];

export interface DiffScope {
  kind: ScopeKind;
  ref: string;
  /** The right-hand ref, set for the range scopes (`last-commit` and `commit`). */
  headRef?: string;
}

export interface CliOptions {
  editor: string | undefined;
  help: boolean;
  icons: boolean;
  ide: string | undefined;
  lspDownload: boolean;
  /** Long line handling: `scroll` (default) or `wrap`. */
  overflow: "scroll" | "wrap";
  scope: DiffScope;
  version: boolean;
}

export type Command = { kind: "run"; options: CliOptions } | { kind: "upgrade" };

/**
 * Splits the reserved `upgrade` subcommand from the default TUI invocation before `parseArgs` runs,
 * so the "single positional = git ref" grammar never has to disambiguate it. `upgrade` takes no
 * further arguments.
 */
export function parseCommand(args: string[]): Command {
  if (args[0] !== "upgrade") {
    return { kind: "run", options: parseArgs(args) };
  }

  const extra = args[1];
  if (extra !== undefined) {
    throw new Error(
      extra.startsWith("-") ? `Unknown option: ${extra}` : `Unexpected argument: ${extra}`,
    );
  }

  return { kind: "upgrade" };
}

export function parseArgs(args: string[]): CliOptions {
  const { values, positionals } = util.parseArgs({
    allowPositionals: true,
    args,
    options: {
      "editor": { type: "string" },
      "help": { short: "h", type: "boolean" },
      "ide": { type: "string" },
      "no-icons": { type: "boolean" },
      "no-lsp-download": { type: "boolean" },
      "staged": { type: "boolean" },
      "unstaged": { type: "boolean" },
      "version": { short: "v", type: "boolean" },
      "wrap": { type: "boolean" },
    },
    strict: true,
  });

  if (positionals.length > 1) {
    throw new Error(`Unexpected argument: ${positionals[1]}`);
  }

  if (values.staged && values.unstaged) {
    throw new Error("--staged and --unstaged are mutually exclusive");
  }

  const kind: ScopeKind = values.staged ? "staged" : values.unstaged ? "unstaged" : "all";

  return {
    editor: requireNonEmptyValue("--editor", values.editor),
    help: values.help ?? false,
    icons: !values["no-icons"],
    ide: requireNonEmptyValue("--ide", values.ide),
    lspDownload: !values["no-lsp-download"],
    overflow: values.wrap ? "wrap" : "scroll",
    scope: { kind, ref: positionals[0] ?? "HEAD" },
    version: values.version ?? false,
  };
}

// A blank command template (`--editor=`) parses to an empty string.
// Stet rejects that as a usage error even though parseArgs accepts it.
function requireNonEmptyValue(flag: string, value: string | undefined) {
  if (value !== undefined && value.trim() === "") {
    throw new Error(`${flag} requires a non-empty value`);
  }
  return value;
}

export function scopeLabel(scope: DiffScope) {
  if (scope.kind === "staged") {
    return `staged vs ${scope.ref}`;
  }

  if (scope.kind === "unstaged") {
    return "unstaged";
  }

  if (scope.kind === "session") {
    return "since session start";
  }

  if (scope.kind === "last-commit") {
    return "last commit";
  }

  // The header shows the commit's subject via commitScopeLabel; this short
  // Sha form is the fallback for any other caller (e.g. the search pane).
  if (scope.kind === "commit") {
    return `commit ${scope.headRef?.slice(0, 7) ?? ""}`;
  }

  return `uncommitted vs ${scope.ref}`;
}

// Ref-agnostic row labels for the scope picker (the active scope's full,
// Ref-bearing label still shows in the header via scopeLabel).
export function scopeMenuLabel(kind: ScopeKind) {
  if (kind === "staged") {
    return "staged";
  }

  if (kind === "all") {
    return "uncommitted";
  }

  if (kind === "session") {
    return "since session start";
  }

  if (kind === "last-commit") {
    return "last commit";
  }

  return "unstaged";
}

// Renders the `?` overlay registry (`KEY_HELP`) as the `--help` Keys section, so the
// Two never drift. Combos align to the widest one by display width (wide glyphs like
// The arrows count correctly), grouped under each section heading.
function keyBindingsHelp() {
  const width = Math.max(
    ...KEY_HELP.flatMap((group) => group.entries.map(([combo]) => Bun.stringWidth(combo))),
  );
  return KEY_HELP.map(
    (group) =>
      `  ${group.heading}:\n${group.entries
        .map(
          ([combo, action]) =>
            `    ${combo}${" ".repeat(width - Bun.stringWidth(combo) + 2)}${action}`,
        )
        .join("\n")}`,
  ).join("\n\n");
}

export function helpText() {
  return `stet - read-only companion TUI for inspecting an agent's changes

Usage:
  stet
  stet <ref>
  stet --staged [ref]
  stet --unstaged
  stet --no-icons        (disable Nerd Font file-type icons in the tree)
  stet --no-lsp-download (do not auto-download a missing language server)
  stet --wrap            (wrap long lines in the viewer instead of overflowing)
  stet --editor <template>
  stet --ide <template>
  stet upgrade           (self-update to the latest release)

Commands:
  upgrade
      Update stet to the latest release using the channel it was installed
      through: a standalone install re-runs the install script, an npm install
      runs npm, and a Homebrew install runs brew upgrade. If the install
      channel cannot be determined, it prints the upgrade commands instead.
      Checks the latest GitHub release first and does nothing when already up
      to date.

Options:
  --editor <template>
      Command template for the terminal editor (e key). The renderer
      suspends, hands the TTY to the editor, then resumes when it exits.
      Use {file} for the path and {line} for the line number.
      Examples:
        --editor "vim +{line} {file}"
        --editor "nvim +{line} {file}"
        --editor "nano +{line} {file}"
      Falls back to STET_EDITOR, then $EDITOR / $VISUAL (with known-editor
      heuristics for the line arg format), then vim.

  --ide <template>
      Command template for a GUI / IDE (o key). Spawns the process and
      returns immediately; the renderer stays live in its pane.
      Examples:
        --ide "code --goto {file}:{line}"
        --ide "zed {file}:{line}"
        --ide "subl {file}:{line}"
      Falls back to STET_IDE, then $VISUAL when it differs from $EDITOR.
      If nothing is configured, o does nothing.

Keys:
${keyBindingsHelp()}

The whole repo renders as a tree with changes overlaid; open any file
read-only. The view is live: files, diffs, and recency markers refresh as an
agent edits, and checks re-run after the repo goes quiet.
`;
}
