import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { state } from "@/state";
import { setSelection } from "@/theme/active";

// Every save reports through a notice, which the status bar renders as its message.
function statusMessage() {
  const model = state.statusBarModel();
  return model.kind === "message" ? model.message : "";
}

/**
 * End to end through the runtime and the real Config service: the file the user owns is what
 * changes, so that is what the tests read back.
 */
function withConfigDir(run: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "stet-save-"));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir;
  return run(dir).finally(() => {
    if (previous === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = previous;
    }
    setSelection(undefined);
    rmSync(dir, { force: true, recursive: true });
  });
}

describe("persistSettings", () => {
  test("writes divergent settings beside the user's comments and reports them", async () => {
    await withConfigDir(async (dir) => {
      const file = join(dir, "stet", "config.jsonc");
      mkdirSync(join(dir, "stet"), { recursive: true });
      writeFileSync(file, `{\n  // my settings\n  "viewer": { "wrap": false },\n}\n`);

      setSelection("mono-dark");
      state.setOverflow("wrap");
      await state.persistSettings();

      const text = readFileSync(file, "utf8");
      expect(text).toContain("// my settings");
      expect(text).toContain(`"wrap": true`);
      expect(text).toContain(`"theme": "mono-dark"`);
      expect(statusMessage()).toBe("saved theme, wrap to config");

      await state.persistSettings();
      expect(statusMessage()).toBe("settings already saved");
    });
  });

  test("creates config.jsonc when none exists", async () => {
    await withConfigDir(async (dir) => {
      state.setChangesOnly(true);
      await state.persistSettings();

      const file = join(dir, "stet", "config.jsonc");
      expect(existsSync(file)).toBe(true);
      expect(Bun.JSONC.parse(readFileSync(file, "utf8"))).toEqual({
        sidebar: { changesOnly: true },
      });
    });
  });

  test("a literal --ide flag persists; the resolved template never does", async () => {
    await withConfigDir(async (dir) => {
      // The resolved template is always set (env fallbacks fill it), the flag
      // Only when passed; only the flag may reach the file.
      state.setIdeTemplate("code {repo} --goto {file}:{line}");
      state.setIdeFlag("zed {repo} {file}:{line}");
      await state.persistSettings();

      const file = join(dir, "stet", "config.jsonc");
      expect(Bun.JSONC.parse(readFileSync(file, "utf8"))).toEqual({
        ide: "zed {repo} {file}:{line}",
      });
      expect(statusMessage()).toBe("saved ide to config");
    });
  });

  test("a malformed config fails with a notice and an unchanged file", async () => {
    await withConfigDir(async (dir) => {
      const file = join(dir, "stet", "config.jsonc");
      mkdirSync(join(dir, "stet"), { recursive: true });
      writeFileSync(file, `{ "viewer": `);

      state.setOverflow("wrap");
      await state.persistSettings();

      expect(readFileSync(file, "utf8")).toBe(`{ "viewer": `);
      expect(statusMessage()).toContain("couldn't save config");
      expect(state.statusBarModel()).toMatchObject({ category: "notification", level: "error" });
    });
  });
});
