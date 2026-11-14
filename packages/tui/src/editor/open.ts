import path from "node:path";

import type { CliRenderer } from "@opentui/core";
import { Effect } from "effect";

import { runtime } from "@/runtime";
import { state } from "@/state";

import { buildEditorCommand } from "./reference";
import { Editor } from "./service";

/**
 * Open a repo file in the configured terminal editor or GUI IDE. Shared by two callers that each
 * hold the `renderer` a different way: the keymap's injected `HostEffects.openInEditor` (App wraps
 * this with its own renderer) and the command menu's row click (via `useRenderer()`). Terminal mode
 * suspends/resumes the renderer around the child so the editor owns the screen; IDE mode forks and
 * only reports a non-zero exit. The renderer is passed in rather than reached from `state`, which
 * must stay free of render-tree resources.
 */
export const openInEditor = async (
  renderer: CliRenderer,
  filePath: string,
  line: number | undefined,
  mode: "terminal" | "ide"
) => {
  const template =
    mode === "ide" ? state.ideTemplate() : state.editorTemplate();
  if (template === undefined) {
    state.notify(
      mode === "ide"
        ? "no IDE configured; set 'ide' or --ide"
        : "no editor configured; set 'editor' or --editor"
    );
    return;
  }
  const cwd = state.gitModel().repoRoot;
  const argv = buildEditorCommand(
    template,
    path.join(cwd, filePath),
    line,
    cwd
  );
  if (argv.length === 0) {
    return;
  }
  if (mode === "terminal") {
    renderer.suspend();
    try {
      await runtime.runPromise(
        Editor.use((editor) => editor.openTerminal(argv, cwd))
      );
    } catch (error) {
      state.notify(
        `couldn't open the editor: ${error instanceof Error ? error.message : String(error)}`,
        "error"
      );
    } finally {
      renderer.resume();
    }
    return;
  }
  runtime.runFork(
    Editor.use((editor) => editor.openIde(argv, cwd)).pipe(
      Effect.tap((code) =>
        code === 0
          ? Effect.void
          : Effect.sync(() => {
              state.notify("IDE exited with an error", "warning");
            })
      ),
      Effect.catchTag("EditorError", (failure) =>
        Effect.sync(() => {
          state.notify(`couldn't open the IDE: ${failure.message}`, "error");
        })
      )
    )
  );
};
