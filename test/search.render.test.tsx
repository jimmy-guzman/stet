import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { testRender } from "@opentui/solid";

import { App } from "@/App";

import { createFixtureRepo, loadModel, makeSettleUntil, seedState } from "./helpers";

describe("project content search", () => {
  test("ctrl-f searches changed files, ctrl-a widens, enter jumps, reopening restores", async () => {
    const repoRoot = createFixtureRepo("sideye-search-", {
      "src/a.ts": "const x = 1\n",
      // Lib.ts stays unchanged (only under whole-repo scope); needle is on line 3.
      "src/lib.ts": "// one\n// two\nexport const needle = 0\n",
    });
    writeFileSync(join(repoRoot, "src", "a.ts"), "const x = 1\nconst needle = 2\n");

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    const { renderer, renderOnce, captureCharFrame, mockInput } = await testRender(() => <App />, {
      height: 34,
      width: 120,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      // The seeded file is a.ts, so selecting lib.ts below is a cross-file jump.
      await settleUntil("app chrome", (frame) => frame.includes("sideye"), 5);

      mockInput.pressKey("f", { ctrl: true });
      await settleUntil("search pane", (frame) => frame.includes("search in changes…"));

      // Changed scope sees only the modified a.ts, not the unchanged lib.ts.
      await mockInput.typeText("needle");
      const changed = await settleUntil("changed-scope results", (frame) =>
        frame.includes("1 match in 1 file"),
      );
      expect(changed).toContain("src/a.ts");
      expect(changed).not.toContain("src/lib.ts");

      // Widening to the whole repo with ctrl-a adds the unchanged lib.ts, with
      // Context lines around each match.
      mockInput.pressKey("a", { ctrl: true });
      const repo = await settleUntil("repo-scope results", (frame) =>
        frame.includes("2 matches in 2 files"),
      );
      expect(repo).toContain("src/lib.ts");
      expect(repo).toContain("// two");

      // Walk the selection into the results (down enters the list on a.ts's
      // Header) and onto lib.ts's match, then jump: the caret must land on the
      // Matched line 3 at the match column, not the top of the file.
      mockInput.pressKey("n", { ctrl: true });
      mockInput.pressKey("j");
      mockInput.pressKey("j");
      mockInput.pressKey("j");
      mockInput.pressEnter();
      const jumped = await settleUntil(
        "jumped to lib.ts line 3",
        (frame) => frame.includes("ln 3:14") && !frame.includes("tab focus"),
      );
      expect(jumped).toContain("ln 3:14");

      // Reopening restores the query and the result set without retyping.
      mockInput.pressKey("f", { ctrl: true });
      const restored = await settleUntil("restored results", (frame) =>
        frame.includes("2 matches in 2 files"),
      );
      expect(restored).toContain("needle");
      expect(restored).toContain("src/lib.ts");

      // The glob field narrows by pathspec: only lib.ts matches src/l*.
      mockInput.pressTab();
      await mockInput.typeText("src/l*");
      const globbed = await settleUntil(
        "glob-narrowed results",
        (frame) => frame.includes("1 match in 1 file"),
        1,
        300,
      );
      expect(globbed).toContain("src/lib.ts");
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);

  test("jumps to a match outside the diff hunk by escalating to full file", async () => {
    // A 60-line zzz.ts with needle on line 50; editing line 1 puts the only diff
    // Hunk far from the match, so the jump must escalate to full-file view.
    const lines = Array.from({ length: 60 }, (_, index) =>
      index === 49 ? "const needle = 1" : `const x${index} = ${index}`,
    );
    const repoRoot = createFixtureRepo("sideye-search-escalate-", {
      "src/aaa.ts": "const a = 1\n",
      "src/zzz.ts": `${lines.join("\n")}\n`,
    });
    writeFileSync(join(repoRoot, "src", "aaa.ts"), "const a = 2\n");
    writeFileSync(
      join(repoRoot, "src", "zzz.ts"),
      `const x0 = 999\n${lines.slice(1).join("\n")}\n`,
    );

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    const { renderer, renderOnce, captureCharFrame, mockInput } = await testRender(() => <App />, {
      height: 34,
      width: 120,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      // Seeded on aaa.ts; the only needle match is line 50 of the changed zzz.ts.
      await settleUntil("app chrome", (frame) => frame.includes("sideye"), 5);
      mockInput.pressKey("f", { ctrl: true });
      await settleUntil("search pane", (frame) => frame.includes("search in changes…"));
      await mockInput.typeText("needle");
      await settleUntil("result", (frame) => frame.includes("1 match in 1 file"));

      // Enter from the query submits the highlighted (first) match directly.
      mockInput.pressEnter();
      const jumped = await settleUntil("jumped to zzz.ts line 50", (frame) =>
        frame.includes("ln 50"),
      );
      expect(jumped).toContain("ln 50");
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);

  test("collapses a file group, reports no matches, and keeps results on a bad regex", async () => {
    const repoRoot = createFixtureRepo("sideye-search-states-", {
      "src/a.ts": "const x = 1\n",
    });
    writeFileSync(join(repoRoot, "src", "a.ts"), "const x = 1\nconst needle = 2\n");

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    const { renderer, renderOnce, captureCharFrame, mockInput } = await testRender(() => <App />, {
      height: 34,
      width: 120,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil("app chrome", (frame) => frame.includes("sideye"), 5);
      mockInput.pressKey("f", { ctrl: true });
      await settleUntil("search pane", (frame) => frame.includes("search in changes…"));
      await mockInput.typeText("needle");
      const results = await settleUntil("results", (frame) => frame.includes("1 match in 1 file"));
      expect(results).toContain("needle = 2");

      // A bad extended regex fails the grep but keeps the prior results on
      // Screen under an error notice.
      mockInput.pressKey("r", { ctrl: true });
      await mockInput.typeText("(");
      const errored = await settleUntil("error keeps results", (frame) =>
        frame.includes("invalid pattern or search failed"),
      );
      expect(errored).toContain("src/a.ts");

      // A valid pattern that matches nothing: a designed empty screen.
      mockInput.pressBackspace();
      await mockInput.typeText("zzz");
      await settleUntil("no matches", (frame) => frame.includes("no matches"), 1, 300);

      // Restore the match, then enter on the file header collapses the group:
      // The match row hides, the header (with its count) stays.
      mockInput.pressBackspace();
      mockInput.pressBackspace();
      mockInput.pressBackspace();
      await settleUntil("results again", (frame) => frame.includes("1 match in 1 file"), 1, 300);
      mockInput.pressKey("n", { ctrl: true });
      mockInput.pressEnter();
      const collapsed = await settleUntil(
        "collapsed group",
        (frame) => frame.includes("▸ src/a.ts") && !frame.includes("needle = 2"),
      );
      expect(collapsed).toContain("1 match in 1 file");
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);
});
