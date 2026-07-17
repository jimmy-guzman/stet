import { resolve } from "node:path";

import { keyHelpGroups } from "../src/help/keys";

/**
 * Single-sources the docs keybindings from `src/help/keys.ts` (rendered with the default combos,
 * since the docs describe a stock install) plus the rebind ids from `src/keys/actions.ts`. Default:
 * writes the markdown tables into the docs page between the markers. With `--check`: parses the
 * committed page back and exits non-zero if it has drifted (wired into `docs:check`). The page's
 * intro and Mouse prose stay hand-written outside the markers. The docs workspace lives at the repo
 * root, so the output path is anchored to this file rather than the cwd.
 */
const MDX_PATH = resolve(
  import.meta.dirname,
  "../../../docs/content/docs/reference/keybindings.mdx",
);
const START_MARKER = "{/* GENERATED-KEYS: edit src/help/keys.ts then run bun run gen:keys */}";
const END_MARKER = "{/* /GENERATED-KEYS */}";
const HEADING = /^##\s+(?<heading>.+?)\s*$/;

const groups = keyHelpGroups();

function renderKeyTables() {
  return groups
    .map((group) => {
      const heading = group.heading.charAt(0).toUpperCase() + group.heading.slice(1);
      const rows = group.entries
        .map(
          (entry) =>
            `| \`${entry.combo}\` | ${entry.description} | ${entry.ids.map((id) => `\`${id}\``).join(", ")} |`,
        )
        .join("\n");
      return `## ${heading}\n\n| Key | Action | Rebind id |\n| --- | --- | --- |\n${rows}`;
    })
    .join("\n\n");
}

// Parses the rendered tables back into the groups shape, so the drift check compares
// Data rather than exact markdown (immune to oxfmt's table alignment).
function parseKeyTables(region: string) {
  const parsed: { entries: [string, string, string][]; heading: string }[] = [];
  for (const line of region.split("\n")) {
    const heading = HEADING.exec(line);
    if (heading?.groups) {
      parsed.push({ entries: [], heading: heading.groups.heading.toLowerCase() });
      continue;
    }
    const group = parsed.at(-1);
    if (!group || !line.trimStart().startsWith("|")) {
      continue;
    }
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 3 || cells[0] === "Key" || /^:?-+:?$/.test(cells[0])) {
      continue;
    }
    group.entries.push([
      cells[0].replaceAll("`", "").trim(),
      cells[1],
      cells[2].replaceAll("`", "").trim(),
    ]);
  }
  return parsed;
}

const text = await Bun.file(MDX_PATH).text();
const start = text.indexOf(START_MARKER);
const end = text.indexOf(END_MARKER);
if (start === -1 || end === -1) {
  throw new Error(`markers not found in ${MDX_PATH}; add ${START_MARKER} and ${END_MARKER}`);
}
const afterStartLine = text.indexOf("\n", start) + 1;

if (process.argv.includes("--check")) {
  const actual = parseKeyTables(text.slice(afterStartLine, end));
  // ParseKeyTables lowercases headings (renderKeyTables capitalizes them for display), so
  // Normalize the same way here: the check compares data, not the display casing.
  const expected = groups.map((group) => ({
    entries: group.entries.map(
      (entry) => [entry.combo, entry.description, entry.ids.join(", ")] as [string, string, string],
    ),
    heading: group.heading.toLowerCase(),
  }));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`${MDX_PATH} is out of date with src/help/keys.ts; run \`bun run gen:keys\``);
    process.exit(1);
  }
  console.log("gen-docs-keys: docs keybindings match src/help/keys.ts");
} else {
  const next = `${text.slice(0, afterStartLine)}\n${renderKeyTables()}\n\n${text.slice(end)}`;
  await Bun.write(MDX_PATH, next);
  console.log(`gen-docs-keys: wrote ${groups.length} key groups to ${MDX_PATH}`);
}
