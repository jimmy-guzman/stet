import path from "node:path";

import type { CliRenderer } from "@opentui/core";
import { createEffect } from "solid-js";

import { state } from "./state";

/**
 * Keep the terminal title on the current worktree and repository. The title is a terminal control,
 * so `main.tsx` runs this beside the renderer that set the terminal up, not from App: OpenTUI throws
 * on a terminal control while the terminal is not active, which is every test renderer (they skip
 * terminal setup) and the real one while the terminal editor holds the screen. The effect re-runs
 * when the suspension ends, so a title that changed meanwhile still lands. Destroying the renderer
 * resets the title, so exit needs no write, and a refresh that lands while quit waits for the
 * restore must not write one either. Call it inside a reactive root.
 *
 * @param renderer The renderer whose terminal carries the title.
 */
export const syncTerminalTitle = (renderer: CliRenderer) => {
  createEffect(() => {
    if (renderer.isDestroyed || state.terminalSuspended()) {
      return;
    }

    const dir = path.basename(state.gitModel().repoRoot);

    if (dir === "") {
      renderer.setTerminalTitle("stet");

      return;
    }

    const repo = path.basename(state.mainWorktreePath()) || dir;
    const segments = dir === repo ? [repo] : [dir, repo];
    renderer.setTerminalTitle([...segments, "stet"].join(" · "));
  });
};
