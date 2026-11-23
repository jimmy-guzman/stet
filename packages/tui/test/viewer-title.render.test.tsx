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
});
