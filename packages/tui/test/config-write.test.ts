import { describe, expect, test } from "bun:test";

import { Result } from "effect";

import { updateSettingsText } from "@/config/write";
import type { SettingsSnapshot } from "@/config/write";

// Defaults mirror the built-ins, so a test overrides only what it exercises.
function snapshot(overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  return {
    appearance: "dark",
    changesOnly: false,
    editor: undefined,
    iconsEnabled: true,
    ide: undefined,
    provenanceEnabled: false,
    searchCaseSensitive: false,
    searchRegex: false,
    searchScope: "changed",
    sidebarOpen: true,
    sidebarWidth: undefined,
    theme: undefined,
    wrap: false,
    ...overrides,
  };
}

function unwrap(result: ReturnType<typeof updateSettingsText>) {
  return result.pipe(
    Result.match({
      onFailure: (message: string) => {
        throw new Error(message);
      },
      onSuccess: (value: { text: string; saved: string[] }) => value,
    }),
  );
}

describe("updateSettingsText", () => {
  test("a snapshot matching the file writes nothing", () => {
    const { saved, text } = unwrap(updateSettingsText("{}", snapshot()));

    expect(saved).toEqual([]);
    expect(text).toBe("{}");
  });

  test("a theme pick lands beside the user's comments, untouched", () => {
    const source = `{\n  // my settings\n  "editor": "vim +{line} {file}",\n}\n`;

    const { saved, text } = unwrap(updateSettingsText(source, snapshot({ theme: "mono-dark" })));

    expect(saved).toEqual(["theme"]);
    expect(text).toContain("// my settings");
    expect(text).toContain(`"editor": "vim +{line} {file}"`);
    expect(text).toContain(`"theme": "mono-dark"`);
  });

  test("a picked name updates only the current appearance's half of a pair", () => {
    const source = `{\n  "theme": { "dark": "a", "light": "b" },\n}\n`;

    const { text } = unwrap(
      updateSettingsText(source, snapshot({ appearance: "dark", theme: "mono-dark" })),
    );

    expect(text).toContain(`"dark": "mono-dark"`);
    expect(text).toContain(`"light": "b"`);
  });

  test("the auto selection removes the theme key", () => {
    const { text } = unwrap(updateSettingsText(`{ "theme": "light" }`, snapshot()));

    expect(text).not.toContain("theme");
  });

  test("removing the only key survives its JSONC trailing comma", () => {
    const { text } = unwrap(updateSettingsText(`{\n  "theme": "light",\n}\n`, snapshot()));

    expect(text).not.toContain("theme");
    expect(() => Bun.JSONC.parse(text)).not.toThrow();
  });

  test("the trailing-comma repair never reaches into a comment", () => {
    // The comment sits after the property (a preceding comment is consumed by
    // Jsonc-parser's removal as attached to it) and carries the `{ ,` text the
    // Old regex repair would have mangled.
    const source = `{\n  "theme": "light",\n  // layout { , glyphs\n}\n`;

    const { text } = unwrap(updateSettingsText(source, snapshot()));

    expect(text).toContain("// layout { , glyphs");
    expect(text).not.toContain(`"theme"`);
    expect(() => Bun.JSONC.parse(text)).not.toThrow();
  });

  test("divergent toggles create their sections; shared labels dedupe", () => {
    const { saved, text } = unwrap(
      updateSettingsText("{}", snapshot({ sidebarOpen: false, sidebarWidth: 44, wrap: true })),
    );

    expect(saved).toEqual(["wrap", "sidebar"]);
    expect(text).toContain(`"viewer"`);
    expect(text).toContain(`"wrap": true`);
    expect(text).toContain(`"open": false`);
    expect(text).toContain(`"width": 44`);
  });

  test("a session value matching the file is not written, and its comment survives", () => {
    const source = `{\n  "viewer": { "wrap": true }, // keep wrapping\n}\n`;

    const { saved, text } = unwrap(
      updateSettingsText(source, snapshot({ theme: "dark", wrap: true })),
    );

    // Only the theme diverged; jsonc-parser may re-lay-out lines adjacent to the
    // Insertion, but the matching value and its comment always survive.
    expect(saved).toEqual(["theme"]);
    expect(text).toContain("// keep wrapping");
    expect(text).toContain(`"wrap": true`);
  });

  test("turning a file's explicit true back off writes an explicit false", () => {
    const source = `{ "viewer": { "wrap": true } }`;

    const { text } = unwrap(updateSettingsText(source, snapshot({ wrap: false })));

    expect(text).toContain(`"wrap": false`);
  });

  test("a responsive session width removes the file's width and keeps its siblings", () => {
    const source = `{ "sidebar": { "open": true, "width": 40 } }`;

    const { saved, text } = unwrap(
      updateSettingsText(source, snapshot({ sidebarWidth: undefined })),
    );

    expect(saved).toEqual(["sidebar"]);
    expect(text).not.toContain("width");
    expect(text).toContain(`"open": true`);
  });

  test("a literal editor or ide flag persists when it differs from the file", () => {
    const source = `{ "editor": "vim +{line} {file}" }`;

    const { saved, text } = unwrap(
      updateSettingsText(
        source,
        snapshot({ editor: "nvim +{line} {file}", ide: "zed {repo} {file}:{line}" }),
      ),
    );

    expect(saved).toEqual(["editor", "ide"]);
    expect(text).toContain(`"editor": "nvim +{line} {file}"`);
    expect(text).toContain(`"ide": "zed {repo} {file}:{line}"`);
  });

  test("no flag leaves the file's editor and ide keys untouched", () => {
    const source = `{ "editor": "hx {file}", "ide": "code {repo}" }`;

    const { saved, text } = unwrap(updateSettingsText(source, snapshot({ theme: "dark" })));

    expect(saved).toEqual(["theme"]);
    expect(text).toContain(`"editor": "hx {file}"`);
    expect(text).toContain(`"ide": "code {repo}"`);
  });

  test("a flag matching the file writes nothing", () => {
    const source = `{ "ide": "code {repo}" }`;

    const { saved } = unwrap(updateSettingsText(source, snapshot({ ide: "code {repo}" })));

    expect(saved).toEqual([]);
  });

  test("empty text seeds a fresh object", () => {
    const { text } = unwrap(updateSettingsText("", snapshot({ theme: "dark" })));

    expect(Bun.JSONC.parse(text)).toEqual({ theme: "dark" });
  });

  test("malformed text fails without producing output", () => {
    expect(Result.isFailure(updateSettingsText(`{ "theme": `, snapshot({ theme: "dark" })))).toBe(
      true,
    );
  });

  test("a non-object document fails without producing output", () => {
    expect(Result.isFailure(updateSettingsText(`[1, 2]`, snapshot({ theme: "dark" })))).toBe(true);
  });
});
