import { expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";

import { themes } from "@pierre/highlights/themes/loader";

import { resolveFileSupportConfig } from "@/file-support/config";
import {
  fileSupportForPath,
  registerFileSupport,
} from "@/file-support/registry";
import { comboTextsFor, registerKeybindings } from "@/keys/registry";
import { resolveKeybindings } from "@/keys/resolve";
import { state } from "@/state";
import {
  activeTheme,
  activeThemeName,
  appearance,
  setAppearance,
  setSelection,
} from "@/theme/active";
import { ansiFromSlots, paletteTheme } from "@/theme/palette";
import {
  hasTheme,
  loadTheme,
  registerSystemTheme,
  registerThemes,
  themeForName,
  themeNames,
} from "@/theme/registry";

import { createFixtureRepo, loadModel, runGit, seedState } from "./helpers";

const probeTheme = (name: string, background: string) =>
  new Map([
    [
      name,
      paletteTheme(name, "dark", {
        ansi: ansiFromSlots([]),
        background,
        foreground: "#eeeeee",
      }),
    ],
  ]);

/**
 * Bun runs every test file in one process, so `state` outlives each of them. A test that dies on a
 * timeout or a failed assertion never reaches its own cleanup, so whatever it set has to be undone
 * for it. These two tests are ordered on purpose: the first leaves the state as a dead test would,
 * the second asserts none of it survived. If the preload's reset ever goes away, the second fails,
 * which is the whole point (that leak once turned one dead render test into fifteen CI failures).
 */
test("a dying test leaves the state dirty", () => {
  state.setIconsEnabled(false);
  state.setFindOpen(true);
  state.setQuitConfirmOpen(true);
  state.setTerminalWidth(200);

  expect(state.iconsEnabled()).toBe(false);
});

test("the next test still starts from the defaults", () => {
  expect(state.iconsEnabled()).toBe(true);
  expect(state.findOpen()).toBe(false);
  expect(state.quitConfirmOpen()).toBe(false);
  expect(state.terminalWidth()).toBe(80);
});

/**
 * The theme registry and the active theme live outside `state`, so `resetState` alone would leave a
 * dead test's registered theme and selection in place for every file after it.
 */
test("a dying test leaves a theme registered and selected", () => {
  registerThemes(probeTheme("isolation-probe", "#654321"));
  registerSystemTheme(
    paletteTheme("system", "dark", {
      ansi: ansiFromSlots([]),
      background: "#111111",
      foreground: "#eeeeee",
    })
  );
  setSelection("isolation-probe");
  setAppearance("light");

  expect(activeThemeName()).toBe("isolation-probe");
});

test("the next test still starts from the default theme", () => {
  expect(themeNames()).not.toContain("isolation-probe");
  expect(themeNames()).not.toContain("system");
  expect(activeThemeName()).toBe("stet-dark");
  expect(appearance()).toBe("dark");
});

test("a dying test leaves the active built-in theme overridden", () => {
  registerThemes(probeTheme("stet-dark", "#123456"));

  expect(activeTheme().colors.surface.base).toBe("#123456");
});

test("the next test still resolves the built-in theme under that name", () => {
  expect(activeTheme().colors.surface.base).toBe("#191b1d");
  expect(themeForName("stet-dark").surface.base).toBe("#191b1d");
});

test("a dying test leaves a bundled theme loader swapped", () => {
  themes.dracula = async () => await Promise.reject(new Error("probe"));
});

test("the next test still imports that bundled theme", async () => {
  await loadTheme("dracula");

  expect(hasTheme("dracula")).toBe(true);
  expect(themeNames()).toContain("dracula");
});

test("a dying test leaves a rebind and a file association registered", () => {
  registerKeybindings(resolveKeybindings({ "toggle-sidebar": "ctrl+e" }).set);
  registerFileSupport(
    resolveFileSupportConfig({
      files: { probe: { extensions: ["probe"], syntax: "json" } },
    }).registry
  );

  expect(comboTextsFor("toggle-sidebar")).toEqual(["ctrl+e"]);
  expect(fileSupportForPath("a.probe").syntax).toBe("json");
});

test("the next test still starts from the default keybindings and file support", () => {
  expect(comboTextsFor("toggle-sidebar")).not.toContain("ctrl+e");
  expect(fileSupportForPath("a.probe").syntax).not.toBe("json");
});

let leftFixture = "";

test("a dying test leaves a fixture repository on disk", () => {
  leftFixture = createFixtureRepo("stet-sweep-probe-", { "a.txt": "a\n" });

  expect(existsSync(leftFixture)).toBe(true);
});

test("the next test finds the fixture swept", () => {
  expect(existsSync(leftFixture)).toBe(false);
});

/**
 * A signal is not the only thing that survives a test. `notify` arms a timer that clears the notice
 * 1.5s later, which lands inside whichever test is running by then, so the reset has to disarm it.
 */
test("a dying test leaves a notice timer armed", () => {
  state.notify("stale notice");

  expect(state.statusBarModel()).toMatchObject({ message: "stale notice" });
});

/**
 * This notice is set directly, so it carries no timer of its own to expire it. If it is gone by the
 * time the sleep ends, the only thing that could have cleared it is the previous test's timer.
 */
test("the armed timer never fires into this test's notice", async () => {
  state.setNotice({ level: "info", text: "fresh notice" });
  await Bun.sleep(1700);

  expect(state.statusBarModel()).toMatchObject({ message: "fresh notice" });
});

/**
 * The picker loads its worktrees, then writes its rows and kicks a summaries refresh, all after an
 * await. A reset landing in that window has to stop the whole chain: guarding only the refresh is
 * not enough, because it would merely start late, capture the new epoch, and pass its own check.
 */
test("a worktree load in flight when a reset lands never writes into the next test", async () => {
  /**
   * The preload sweeps the fixture repo; the `finally` is for the peer worktree beside it, which the
   * sweep does not track, so a failure after adding it still removes it.
   */
  const repoRoot = createFixtureRepo("stet-isolation-", {
    "README.md": "# Fixture\n",
  });

  try {
    runGit(repoRoot, ["worktree", "add", "-b", "peer", `${repoRoot}-peer`]);
    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });

    state.openWorktreePicker();
    state.resetState();
    await Bun.sleep(1500);

    expect(state.worktreeSummaries().size).toBe(0);
    expect(state.worktrees()).toBeUndefined();
  } finally {
    rmSync(`${repoRoot}-peer`, { force: true, recursive: true });
  }
}, 20_000);
