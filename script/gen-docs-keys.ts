import { KEY_HELP } from "@/help/keys";

/**
 * Single-sources the docs keybindings from `src/help/keys.ts`. Default: writes the markdown tables
 * into the docs page between the markers. With `--check`: parses the committed page back and exits
 * non-zero if it has drifted from KEY_HELP (wired into `docs:check`). The page's intro and Mouse
 * prose stay hand-written outside the markers.
 */
const MDX_PATH = "docs/content/docs/reference/keybindings.mdx";
const START_MARKER = "{/* GENERATED-KEYS: edit src/help/keys.ts then run bun run gen:keys */}";
const END_MARKER = "{/* /GENERATED-KEYS */}";
const HEADING = /^##\s+(?<heading>.+?)\s*$/;

function renderKeyTables() {
  return KEY_HELP.map((group) => {
    const heading = group.heading.charAt(0).toUpperCase() + group.heading.slice(1);
    const rows = group.entries.map(([combo, action]) => `| \`${combo}\` | ${action} |`).join("\n");
    return `## ${heading}\n\n| Key | Action |\n| --- | --- |\n${rows}`;
  }).join("\n\n");
}

// Parses the rendered tables back into the KEY_HELP shape, so the drift check compares
// Data rather than exact markdown (immune to oxfmt's table alignment).
function parseKeyTables(region: string) {
  const groups: { entries: [string, string][]; heading: string }[] = [];
  for (const line of region.split("\n")) {
    const heading = HEADING.exec(line);
    if (heading?.groups) {
      groups.push({ entries: [], heading: heading.groups.heading.toLowerCase() });
      continue;
    }
    const group = groups.at(-1);
    if (!group || !line.trimStart().startsWith("|")) {
      continue;
    }
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 2 || cells[0] === "Key" || /^:?-+:?$/.test(cells[0])) {
      continue;
    }
    group.entries.push([cells[0].replaceAll("`", "").trim(), cells[1]]);
  }
  return groups;
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
  const expected = KEY_HELP.map((group) => ({ entries: group.entries, heading: group.heading }));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`${MDX_PATH} is out of date with src/help/keys.ts; run \`bun run gen:keys\``);
    process.exit(1);
  }
  console.log("gen-docs-keys: docs keybindings match src/help/keys.ts");
} else {
  const next = `${text.slice(0, afterStartLine)}\n${renderKeyTables()}\n\n${text.slice(end)}`;
  await Bun.write(MDX_PATH, next);
  console.log(`gen-docs-keys: wrote ${KEY_HELP.length} key groups to ${MDX_PATH}`);
}
