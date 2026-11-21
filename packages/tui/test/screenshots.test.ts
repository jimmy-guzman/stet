import { afterEach, describe, expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "../../..");
const scratchDirs: string[] = [];

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

// VHS is the external renderer. Record what it receives and simulate the one
// capture that saves settings, without starting a terminal or taking real shots.
const fakeVhs = `#!${process.execPath}
import path from "node:path";

const tape = await Bun.file(Bun.argv[2]).text();
const launch = tape.split("\\n").find((line) => line.startsWith('Type "cd '));
const shot = /^Screenshot (.+)$/m.exec(tape)[1];
const xdg = /XDG_CONFIG_HOME=([^ ]+)/.exec(launch)?.[1] ?? process.env.XDG_CONFIG_HOME;
const configFile = path.join(xdg, "stet", "config.jsonc");
const config = await Bun.file(configFile).json();
const git = await Bun.file(path.join(xdg, "git", "config")).text();

if (process.env.SCREENSHOT_TEST_FAIL === "1") {
  console.error("Capture theme:", config.theme);
  process.exit(17);
}

await Bun.write(shot, JSON.stringify({
  config,
  git,
  forceColor: process.env.FORCE_COLOR ?? null,
  noColor: process.env.NO_COLOR ?? null,
}));

if (shot === "save-settings.png") {
  await Bun.write(configFile, JSON.stringify({ ...config, viewer: { wrap: true } }));
}
`;

const captureFixture = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "stet-screenshot-test-"));
  scratchDirs.push(dir);

  const captureRepo = path.join(dir, "capture");
  const source = path.join(dir, "packages/tui/script");
  const output = path.join(dir, "docs/public/screenshots");
  const bin = path.join(dir, "bin");
  const userConfig = path.join(dir, "user-config");
  const gitConfig = "[core]\n\texcludesFile = ~/.gitignore\n";
  const personalConfig = { theme: "mono-light" };
  const gitConfigPath = path.join(userConfig, "git/config");
  const personalConfigPath = path.join(userConfig, "stet/config.jsonc");

  for (const folder of [
    source,
    output,
    bin,
    path.join(userConfig, "stet"),
    path.join(userConfig, "git"),
  ]) {
    mkdirSync(folder, { recursive: true });
  }

  writeFileSync(personalConfigPath, JSON.stringify(personalConfig));
  writeFileSync(gitConfigPath, gitConfig);
  writeFileSync(path.join(bin, "vhs"), fakeVhs, { mode: 0o755 });

  // Keep outputs in the scratch directory, and keep any linked Git worktree
  // and branch off the real repository.
  const script = path.join(source, "screenshots.ts");
  copyFileSync(
    path.join(repoRoot, "packages/tui/script/screenshots.ts"),
    script
  );

  const env = {
    FORCE_COLOR: "0",
    HOME: dir,
    NO_COLOR: "1",
    STET_SCREENSHOT_REPO: captureRepo,
    TMPDIR: dir,
    XDG_CONFIG_HOME: userConfig,
  };

  return {
    captureRepo,
    capture: (screens: string[], fail = false) =>
      Bun.spawnSync([process.execPath, script, ...screens], {
        env: { ...env, PATH: bin, SCREENSHOT_TEST_FAIL: fail ? "1" : "0" },
        timeout: 10_000,
      }),
    configDir: path.join(dir, "stet-screenshots-config"),
    gitConfig,
    gitConfigPath,
    personalConfig,
    personalConfigPath,
    captureFile: (name: string) => Bun.file(path.join(output, `${name}.png`)),
    readTape: async (name: string) =>
      await Bun.file(path.join(dir, "stet-screenshots", `${name}.tape`)).text(),
    useGit: () => {
      const git = Bun.which("git");

      if (git === null) {
        throw new Error("Git is required to test linked worktree captures");
      }

      const clone = Bun.spawnSync(
        [git, "clone", "--shared", "--no-checkout", repoRoot, captureRepo],
        { env: { ...env, PATH: process.env.PATH }, timeout: 10_000 }
      );

      if (clone.exitCode !== 0) {
        throw new Error(clone.stderr.toString());
      }

      symlinkSync(git, path.join(bin, "git"));
    },
  };
};

describe("screenshot generator", () => {
  test("pins the theme for regular captures and resets settings after a save", async () => {
    const fixture = captureFixture();
    const result = fixture.capture(["save-settings", "find", "context-menu"]);

    expect(result.exitCode).toBe(0);

    await Promise.all(
      ["save-settings", "find", "context-menu"].map(async (name) => {
        expect(await fixture.captureFile(name).json()).toEqual({
          config: {
            theme: "stet-dark",
            keybindings: { "context-menu": "ctrl+n" },
          },
          forceColor: null,
          git: fixture.gitConfig,
          noColor: null,
        });
        expect(await fixture.readTape(name)).toContain(
          `cd ${fixture.captureRepo}/packages/tui &&`
        );
      })
    );

    expect(await Bun.file(fixture.personalConfigPath).json()).toEqual(
      fixture.personalConfig
    );
    expect(existsSync(fixture.configDir)).toBe(false);
  });

  test("keeps the preview, fold, and unchanged file tapes on their intended targets", async () => {
    const fixture = captureFixture();
    fixture.useGit();

    const result = fixture.capture(["theme-switcher", "folding", "read-only"]);

    expect(result.exitCode).toBe(0);

    const [theme, folding, readOnlyTape] = await Promise.all([
      fixture.readTape("theme-switcher"),
      fixture.readTape("folding"),
      fixture.readTape("read-only"),
    ]);

    expect(theme).toContain('Type "catppuccin-mocha"');
    expect(folding).toContain('Type "layout/regions"');
    expect(folding).toContain('Type "computeLayout = ("');
    expect(folding).toContain('Type "z"');
    expect(readOnlyTape).toContain('Type "relative-time.test"');
    expect(readOnlyTape).toContain(
      `cd ${fixture.captureRepo}/.claude/worktrees/tidy-layout/packages/tui &&`
    );
    expect(await fixture.captureFile("read-only").json()).toMatchObject({
      config: { theme: "stet-dark" },
    });
  });

  test("cleans up the capture config when a regular shot fails", async () => {
    const fixture = captureFixture();
    const result = fixture.capture(["find"], true);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Capture theme: stet-dark");
    expect(result.stderr.toString()).toContain("vhs exited 17");
    expect(existsSync(fixture.configDir)).toBe(false);
    expect(await Bun.file(fixture.personalConfigPath).json()).toEqual(
      fixture.personalConfig
    );
    expect(await Bun.file(fixture.gitConfigPath).text()).toBe(
      fixture.gitConfig
    );
  });
});
