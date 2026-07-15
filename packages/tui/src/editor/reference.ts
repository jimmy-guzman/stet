import { basename } from "node:path";

/**
 * Templates for editors whose line-number argument format is known, keyed by the editor binary
 * basename. GUI IDEs carry `{repo}` (the repo root) so the o key opens the file as a workspace
 * rather than a bare single-file window; terminal editors have no workspace and carry only
 * `{file}`/`{line}`.
 */
const KNOWN_EDITOR_TEMPLATES: Record<string, string> = {
  code: "code {repo} --goto {file}:{line}",
  cursor: "cursor {repo} --goto {file}:{line}",
  emacs: "emacs +{line} {file}",
  helix: "helix {file}:{line}",
  hx: "hx {file}:{line}",
  idea: "idea {repo} --line {line} {file}",
  kak: "kak +{line} {file}",
  micro: "micro {file}:{line}",
  nano: "nano +{line} {file}",
  nvim: "nvim +{line} {file}",
  subl: "subl {file}:{line}",
  vi: "vi +{line} {file}",
  vim: "vim +{line} {file}",
  zed: "zed {repo} {file}:{line}",
};

/**
 * Expands a value into a full command template. If the value already contains `{file}` it is
 * returned unchanged (full template, pass through). Otherwise the binary basename is looked up in
 * KNOWN_EDITOR_TEMPLATES; an unrecognised name gets `defaultSuffix` appended so `{file}` is always
 * present in the result.
 */
function normalizeTemplate(value: string, defaultSuffix: string): string {
  if (value.includes("{file}")) {
    return value;
  }
  const bin = basename(value.split(/\s+/)[0] ?? value);
  return KNOWN_EDITOR_TEMPLATES[bin] ?? `${value} ${defaultSuffix}`;
}

/**
 * Resolves the editor command template from (in priority order):
 *
 * 1. An explicit `--editor` value or `editor` config key
 * 2. The `STET_EDITOR` environment variable
 * 3. `$EDITOR` / `$VISUAL`, with a known-editor heuristic for the line arg format
 * 4. `vim` as the hard fallback
 *
 * A bare editor name (no `{file}` placeholder) is expanded through KNOWN_EDITOR_TEMPLATES before
 * being returned, so `--editor code` works the same as `--editor "code --goto {file}:{line}"`.
 */
export function resolveEditorTemplate(explicit: string | undefined): string {
  if (explicit !== undefined) {
    return normalizeTemplate(explicit, "+{line} {file}");
  }

  const stet = process.env.STET_EDITOR;
  if (stet !== undefined && stet !== "") {
    return normalizeTemplate(stet, "+{line} {file}");
  }

  const editor = process.env.EDITOR;
  if (editor !== undefined && editor !== "") {
    return normalizeTemplate(editor, "+{line} {file}");
  }
  const visual = process.env.VISUAL;
  if (visual !== undefined && visual !== "") {
    return normalizeTemplate(visual, "+{line} {file}");
  }

  return "vim +{line} {file}";
}

/**
 * Resolves the IDE command template from (in priority order):
 *
 * 1. An explicit `--ide` value or `ide` config key
 * 2. The `STET_IDE` environment variable
 * 3. `$VISUAL` when it differs from `$EDITOR` (Unix convention: $VISUAL is often a GUI editor while
 *    $EDITOR is a terminal one)
 * 4. `undefined` — if nothing is configured the o key does nothing
 *
 * A bare editor name is expanded the same way as in `resolveEditorTemplate`.
 */
export function resolveIdeTemplate(explicit: string | undefined): string | undefined {
  if (explicit !== undefined) {
    return normalizeTemplate(explicit, "{file}:{line}");
  }

  const stet = process.env.STET_IDE;
  if (stet !== undefined && stet !== "") {
    return normalizeTemplate(stet, "{file}:{line}");
  }

  const visual = process.env.VISUAL;
  const editor = process.env.EDITOR;
  if (visual !== undefined && visual !== "" && visual !== editor) {
    return normalizeTemplate(visual, "{file}:{line}");
  }

  return undefined;
}

/**
 * The OS "open with the default application" command for a path: `open` on macOS, `xdg-open` on
 * Linux (the same platform split as the clipboard tool). `undefined` on any other platform, where
 * the caller surfaces a notice instead. `platform` is a parameter so every branch is
 * unit-testable.
 */
export function openExternalCommand(path: string, platform: string = process.platform) {
  if (platform === "darwin") {
    return ["open", path];
  }
  if (platform === "linux") {
    return ["xdg-open", path];
  }
  return undefined;
}

/**
 * Expands a template string into an argv array ready to pass to `Bun.spawn`. `{file}` becomes the
 * absolute file path, `{repo}` the repo root, and `{line}` the line number, substituted in a single
 * pass so a value that itself contains a placeholder (a path with `{line}` in it) is never
 * re-substituted.
 *
 * When `line` is undefined the line argument disappears in whatever surface form it took: a
 * combined token like `{file}:{line}` keeps the file (the `:{line}` is stripped), a lone `{line}`
 * token (e.g. `+{line}`) is dropped, and a bare option flag whose only value is that lone token
 * (JetBrains' `--line {line}`) is dropped along with it.
 */
export function buildEditorCommand(
  template: string,
  file: string,
  line: number | undefined,
  repo: string,
): string[] {
  const tokens = template.split(/\s+/).filter((token) => token !== "");
  const noLine = line === undefined;
  const isLoneLine = (token: string | undefined) =>
    token !== undefined && token.includes("{line}") && !token.includes("{file}");
  return tokens
    .filter((token, index) => {
      if (!noLine) {
        return true;
      }
      if (isLoneLine(token)) {
        return false;
      }
      return !(
        token.startsWith("-") &&
        !/\{(?:file|line|repo)\}/.test(token) &&
        isLoneLine(tokens[index + 1])
      );
    })
    .map((token) =>
      (noLine ? token.replace(/:\{line\}|\{line\}/g, "") : token).replace(
        /\{(?<key>file|line|repo)\}/g,
        (_, key) => (key === "file" ? file : key === "repo" ? repo : String(line)),
      ),
    );
}
