import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { testRender } from "@opentui/solid";

import { App } from "@/app";
import { state } from "@/state";

import {
  createFixtureRepo,
  loadModel,
  makeSettleUntil,
  runGit,
  seedState,
} from "./helpers";

const titleRow = (frame: string) =>
  (frame.split("\n")[state.layout().viewer.y] ?? "").slice(
    state.layout().viewer.x
  );

describe("viewer title row", () => {
  test("a long path keeps its filename and the stats stay whole in a narrow viewer", async () => {
    const repoRoot = createFixtureRepo("stet-title-", {
      "README.md": "# Fixture\n",
    });

    const dir = path.join(repoRoot, "src", "deeply", "nested", "directory");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "with-a-long-file-name.test.ts"),
      "const a = 1\nconst b = 2\nconst c = 3\n"
    );
    runGit(repoRoot, ["add", "."]);

    const scope = { kind: "staged", ref: "HEAD" } as const;
    const model = await loadModel(repoRoot, scope);
    seedState(model, scope);

    const { renderer, renderOnce, captureCharFrame } = await testRender(
      () => <App />,
      { height: 20, width: 70 }
    );

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      const frame = await settleUntil("title row painted", (current) =>
        titleRow(current).includes("+3")
      );

      const title = titleRow(frame);

      // The path is shortened from the left, so the filename end survives.
      expect(title).toContain("…");
      expect(title).toContain("with-a-long-file-name.test.ts");
      // Only the stats sit on the right: no scope (the header owns it), no caret position.
      expect(title).toMatch(/\+3\s*$/u);
      expect(title).not.toContain("staged");
      expect(title).not.toMatch(/\bln \d/u);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("a long active tab with a neighbour keeps a gap before the stats", async () => {
    const repoRoot = createFixtureRepo("stet-title-tabs-", {
      "README.md": "# Fixture\n",
    });

    const dir = path.join(repoRoot, "src", "deeply", "nested", "directory");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "with-a-long-file-name.test.ts"),
      "const a = 1\nconst b = 2\nconst c = 3\n"
    );
    writeFileSync(path.join(repoRoot, "src", "b.ts"), "const b = 1\n");
    runGit(repoRoot, ["add", "."]);

    const scope = { kind: "staged", ref: "HEAD" } as const;
    const model = await loadModel(repoRoot, scope);
    seedState(model, scope);

    const { renderer, renderOnce, captureCharFrame } = await testRender(
      () => <App />,
      { height: 20, width: 70 }
    );

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      // Pin the long file, open b.ts beside it, then cycle back: the long tab is
      // Active with a clipped neighbour on its right, so the strip shows a ›.
      state.selectFile(
        "src/deeply/nested/directory/with-a-long-file-name.test.ts"
      );
      state.togglePinActiveTab();
      state.selectFile("src/b.ts");
      state.cycleTab(-1);

      const frame = await settleUntil(
        "long tab active",
        (current) =>
          titleRow(current).includes("+3") && titleRow(current).includes("›")
      );

      const title = titleRow(frame);

      // The path is cut from the left, so its filename end survives.
      expect(title).toContain("long-file-name.test.ts");
      // The › marker is counted in the budget, so it never touches the stats.
      expect(title).toMatch(/› \+3\s*$/u);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("a long active tab between two others keeps both markers off the stats", async () => {
    const repoRoot = createFixtureRepo("stet-title-middle-", {
      "README.md": "# Fixture\n",
    });

    const dir = path.join(repoRoot, "src", "deeply", "nested", "directory");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "with-a-long-file-name.test.ts"),
      "const a = 1\nconst b = 2\nconst c = 3\n"
    );
    writeFileSync(path.join(repoRoot, "src", "b.ts"), "const b = 1\n");
    writeFileSync(path.join(repoRoot, "src", "c.ts"), "const c = 1\n");
    runGit(repoRoot, ["add", "."]);

    const scope = { kind: "staged", ref: "HEAD" } as const;
    const model = await loadModel(repoRoot, scope);
    seedState(model, scope);

    const { renderer, renderOnce, captureCharFrame } = await testRender(
      () => <App />,
      { height: 20, width: 70 }
    );

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      // Pinned b.ts, pinned long file, preview c.ts, then back to the long file:
      // It is active in the middle, so the strip shows both ‹ and ›.
      state.selectFile("src/b.ts");
      state.togglePinActiveTab();
      state.selectFile(
        "src/deeply/nested/directory/with-a-long-file-name.test.ts"
      );
      state.togglePinActiveTab();
      state.selectFile("src/c.ts");
      state.cycleTab(-1);

      const frame = await settleUntil(
        "long tab active in the middle",
        (current) =>
          titleRow(current).includes("+3") &&
          titleRow(current).includes("‹") &&
          titleRow(current).includes("›")
      );

      const title = titleRow(frame);

      expect(title).toContain("long-file-name.test.ts");
      expect(title).toMatch(/› \+3\s*$/u);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("a wide viewer shows a long active tab's full path beside its neighbour", async () => {
    const repoRoot = createFixtureRepo("stet-title-wide-", {
      "README.md": "# Fixture\n",
    });

    const dir = path.join(repoRoot, "src", "deeply", "nested", "directory");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "with-a-long-file-name.test.ts"),
      "const a = 1\nconst b = 2\nconst c = 3\n"
    );
    writeFileSync(path.join(repoRoot, "src", "b.ts"), "const b = 1\n");
    runGit(repoRoot, ["add", "."]);

    const scope = { kind: "staged", ref: "HEAD" } as const;
    const model = await loadModel(repoRoot, scope);
    seedState(model, scope);

    const { renderer, renderOnce, captureCharFrame } = await testRender(
      () => <App />,
      { height: 20, width: 160 }
    );

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      state.selectFile(
        "src/deeply/nested/directory/with-a-long-file-name.test.ts"
      );
      state.togglePinActiveTab();
      state.selectFile("src/b.ts");
      state.cycleTab(-1);

      const frame = await settleUntil(
        "both tabs shown",
        (current) =>
          titleRow(current).includes("+3") && titleRow(current).includes("b.ts")
      );

      // No fixed cap: with room to spare, the active path is never cut.
      expect(titleRow(frame)).toContain(
        " src/deeply/nested/directory/with-a-long-file-name.test.ts "
      );
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("a pinned tab keeps its label when the strip has room for one cell or two", async () => {
    const repoRoot = createFixtureRepo("stet-title-tiny-", {
      "README.md": "# Fixture\n",
    });

    writeFileSync(
      path.join(repoRoot, "abc.ts"),
      "const a = 1\nconst b = 2\nconst c = 3\n"
    );
    runGit(repoRoot, ["add", "."]);

    const scope = { kind: "staged", ref: "HEAD" } as const;
    const model = await loadModel(repoRoot, scope);
    seedState(model, scope);

    // Width 7 with the tree collapsed leaves the title 2 cells beside `+3`.
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      () => <App />,
      { height: 20, width: 7 }
    );

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      state.collapseSidebar();
      state.selectFile("abc.ts");
      await settleUntil("lone title", (current) =>
        titleRow(current).includes("+3")
      );
      state.togglePinActiveTab();

      const frame = await settleUntil("pinned tab shown", () =>
        state.tabItems().some((tab) => !tab.preview)
      );

      // The pads give way, so the pinned tab still reads `…s` like the lone title.
      expect(titleRow(frame)).toContain("…s +3");
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("a middle tab keeps its label when the strip cannot also fit its markers", async () => {
    const repoRoot = createFixtureRepo("stet-title-tiny-middle-", {
      "README.md": "# Fixture\n",
    });

    writeFileSync(path.join(repoRoot, "a.ts"), "const a = 1\n");
    writeFileSync(path.join(repoRoot, "b.ts"), "const b = 1\n");
    writeFileSync(path.join(repoRoot, "c.ts"), "const c = 1\n");
    runGit(repoRoot, ["add", "."]);

    const scope = { kind: "staged", ref: "HEAD" } as const;
    const model = await loadModel(repoRoot, scope);
    seedState(model, scope);

    // Width 7 with the tree collapsed leaves the strip 2 cells beside `+1`.
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      () => <App />,
      { height: 20, width: 7 }
    );

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      state.collapseSidebar();
      state.selectFile("a.ts");
      state.togglePinActiveTab();
      state.selectFile("b.ts");
      state.togglePinActiveTab();
      state.selectFile("c.ts");
      state.togglePinActiveTab();
      state.cycleTab(-1);

      const frame = await settleUntil(
        "b.ts active between two pinned tabs",
        (current) =>
          state.tabItems().length === 3 &&
          state.tabItems()[1]?.active &&
          titleRow(current).includes("+1")
      );

      // The label takes its cell before the markers, so b.ts still reads `…s`.
      expect(titleRow(frame)).toContain("…s +1");
    } finally {
      renderer.destroy();
    }
  }, 20_000);
});
