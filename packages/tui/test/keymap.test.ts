import { afterEach, describe, expect, test } from "bun:test";

import { KeyEvent } from "@opentui/core";
import { batch } from "solid-js";

import { createKeyHandler } from "@/keymap";
import { state } from "@/state";

const keyEvent = (overrides: { ctrl?: boolean; name: string; shift?: boolean }) =>
  new KeyEvent({
    ctrl: false,
    eventType: "press",
    meta: false,
    number: false,
    option: false,
    raw: "",
    sequence: "",
    shift: false,
    source: "raw",
    ...overrides,
  });

describe("createKeyHandler", () => {
  const noop = async () => {};

  afterEach(() => {
    state.closeCommandMenu();
    state.setQuitConfirmOpen(false);
    state.setFocusedPane("tree");
    state.seedNav(undefined);
  });

  test("ctrl-c quits", () => {
    let quitCount = 0;
    const handle = createKeyHandler({ openInEditor: noop, quit: () => quitCount++ });

    handle(keyEvent({ ctrl: true, name: "c" }));

    expect(quitCount).toBe(1);
  });

  test("a plain c does not quit", () => {
    let quitCount = 0;
    const handle = createKeyHandler({ openInEditor: noop, quit: () => quitCount++ });

    handle(keyEvent({ name: "c" }));

    expect(quitCount).toBe(0);
  });

  test("e opens the selected file in terminal editor", () => {
    batch(() => state.seedNav("src/foo.ts"));
    const calls: [string, number | undefined, string][] = [];
    const handle = createKeyHandler({
      openInEditor: async (path, line, mode) => {
        calls.push([path, line, mode]);
      },
      quit: noop,
    });

    handle(keyEvent({ name: "e" }));

    expect(calls).toEqual([["src/foo.ts", undefined, "terminal"]]);
  });

  test("e does nothing when no file is selected", () => {
    const calls: unknown[] = [];
    const handle = createKeyHandler({
      openInEditor: async (...args) => {
        calls.push(args);
      },
      quit: noop,
    });

    handle(keyEvent({ name: "e" }));

    expect(calls).toEqual([]);
  });

  test("o opens the selected file in IDE", () => {
    batch(() => state.seedNav("src/bar.ts"));
    const calls: [string, number | undefined, string][] = [];
    const handle = createKeyHandler({
      openInEditor: async (path, line, mode) => {
        calls.push([path, line, mode]);
      },
      quit: noop,
    });

    handle(keyEvent({ name: "o" }));

    expect(calls).toEqual([["src/bar.ts", undefined, "ide"]]);
  });

  test("o does nothing when no file is selected", () => {
    const calls: unknown[] = [];
    const handle = createKeyHandler({
      openInEditor: async (...args) => {
        calls.push(args);
      },
      quit: noop,
    });

    handle(keyEvent({ name: "o" }));

    expect(calls).toEqual([]);
  });

  test("< steps back and > steps forward through history", () => {
    state.selectFile("a.ts");
    state.selectFile("b.ts");
    const handle = createKeyHandler({ openInEditor: noop, quit: noop });

    handle(keyEvent({ name: "<" }));
    expect(state.selectedPath()).toBe("a.ts");

    handle(keyEvent({ name: ">" }));
    expect(state.selectedPath()).toBe("b.ts");
  });

  test("] re-opens a collapsed sidebar", () => {
    state.nudgeSidebarWidth(-100); // Shrink past the minimum -> collapsed
    expect(state.sidebarOpen()).toBe(false);
    const handle = createKeyHandler({ openInEditor: noop, quit: noop });

    handle(keyEvent({ name: "]" }));

    expect(state.sidebarOpen()).toBe(true);
  });

  test("ctrl-t pins; a later navigation opens a fresh preview; { } cycle; ctrl-w closes", () => {
    state.selectFile("a.ts");
    const handle = createKeyHandler({ openInEditor: noop, quit: noop });

    handle(keyEvent({ ctrl: true, name: "t" })); // Pin a.ts (no new tab yet)
    expect(state.tabItems().length).toBe(1);
    expect(state.tabItems()[0].preview).toBe(false);

    state.selectFile("b.ts"); // Fresh preview -> two tabs
    expect(state.tabItems().length).toBe(2);

    const activeBefore = state.tabItems().findIndex((tab) => tab.active);
    handle(keyEvent({ name: "{" }));
    expect(state.tabItems().findIndex((tab) => tab.active)).not.toBe(activeBefore);

    handle(keyEvent({ ctrl: true, name: "w" }));
    expect(state.tabItems().length).toBe(1);
  });

  test("ctrl-t does not fall through to the theme picker", () => {
    state.selectFile("a.ts");
    const handle = createKeyHandler({ openInEditor: noop, quit: noop });

    handle(keyEvent({ ctrl: true, name: "t" }));

    expect(state.themeComboboxOpen()).toBe(false);
  });

  test("K requests hover for the symbol under the caret", () => {
    let calls = 0;
    const realShowHover = state.showHover;
    state.showHover = async () => {
      calls += 1;
    };
    const handle = createKeyHandler({ openInEditor: noop, quit: noop });
    try {
      handle(keyEvent({ name: "K" }));
      expect(calls).toBe(1);
    } finally {
      state.showHover = realShowHover;
    }
  });

  test("S lists the open file's symbols", () => {
    let calls = 0;
    const realFindSymbols = state.findSymbols;
    state.findSymbols = async () => {
      calls += 1;
    };
    const handle = createKeyHandler({ openInEditor: noop, quit: noop });
    try {
      handle(keyEvent({ name: "S" }));
      expect(calls).toBe(1);
    } finally {
      state.findSymbols = realFindSymbols;
    }
  });

  test("plain s still opens the scope picker", () => {
    const handle = createKeyHandler({ openInEditor: noop, quit: noop });
    try {
      handle(keyEvent({ name: "s" }));
      expect(state.scopeMenuOpen()).toBe(true);
    } finally {
      state.setScopeMenuOpen(false);
    }
  });

  test("Shift+S outside the file view is a no-op, never the scope picker", () => {
    const handle = createKeyHandler({ openInEditor: noop, quit: noop });
    try {
      // Combos match modifiers exactly: Shift+S is the symbols binding, gated on
      // The file view, and it never falls through to the plain-s scope picker
      // (which the old name-only matching allowed), whichever shape the terminal
      // Reports it in.
      state.openSearch();
      state.setFocusedPane("tree");
      handle(keyEvent({ name: "s", shift: true }));
      expect(state.scopeMenuOpen()).toBe(false);
      handle(keyEvent({ name: "S" }));
      expect(state.scopeMenuOpen()).toBe(false);
    } finally {
      state.setScopeMenuOpen(false);
      state.closeSearch();
    }
  });

  test("Shift+F10 opens the viewer context menu on the first item", () => {
    batch(() => {
      state.seedNav("src/foo.ts");
      state.setFocusedPane("diff");
    });
    const handle = createKeyHandler({ openInEditor: noop, quit: noop });

    handle(keyEvent({ name: "f10", shift: true }));

    expect(state.commandMenuOpen()).toBe(true);
    expect(state.commandMenuContext()).toBe("viewer");
    // With no diff loaded the caret sits on no symbol, so the caret-intel actions are
    // Omitted; "Find symbols" needs no caret, so the highlight opens on it.
    expect(state.commandMenuItems()[state.commandMenuIndex()]?.label).toBe("Find symbols");
  });

  test("the command menu owns the keyboard: j moves the highlight, esc closes, keys don't fall through", () => {
    batch(() => {
      state.seedNav("src/foo.ts");
      state.setFocusedPane("diff");
    });
    let quitCount = 0;
    const handle = createKeyHandler({ openInEditor: noop, quit: () => quitCount++ });
    handle(keyEvent({ name: "f10", shift: true }));

    // A plain q is swallowed while the menu is open (no fall-through to global quit).
    handle(keyEvent({ name: "q" }));
    expect(quitCount).toBe(0);
    expect(state.commandMenuOpen()).toBe(true);

    handle(keyEvent({ name: "j" }));
    expect(state.commandMenuItems()[state.commandMenuIndex()]?.label).toBe("Copy reference");

    handle(keyEvent({ name: "escape" }));
    expect(state.commandMenuOpen()).toBe(false);
  });

  test("return on an editor item routes through the host and closes the menu", () => {
    batch(() => {
      state.seedNav("src/foo.ts");
      state.setFocusedPane("diff");
    });
    const calls: [string, number | undefined, string][] = [];
    const handle = createKeyHandler({
      openInEditor: async (path, line, mode) => {
        calls.push([path, line, mode]);
      },
      quit: noop,
    });
    handle(keyEvent({ name: "f10", shift: true }));

    // Step from "Find symbols" (0) to "Open in editor" (3).
    handle(keyEvent({ name: "j" }));
    handle(keyEvent({ name: "j" }));
    handle(keyEvent({ name: "j" }));
    expect(state.commandMenuItems()[state.commandMenuIndex()]?.label).toBe("Open in editor");

    handle(keyEvent({ name: "return" }));

    expect(calls).toEqual([["src/foo.ts", undefined, "terminal"]]);
    expect(state.commandMenuOpen()).toBe(false);
  });

  test("escape closes an open caret-anchored decoration and is swallowed before quit", () => {
    state.openViewerDecoration({ lines: [{ kind: "prose", text: "const x: 1" }], status: "ready" });
    expect(state.viewerDecoration()).not.toBeUndefined();
    let quitCount = 0;
    const handle = createKeyHandler({ openInEditor: noop, quit: () => quitCount++ });

    handle(keyEvent({ name: "escape" }));

    expect(state.viewerDecoration()).toBeUndefined();
    // The decoration's esc must early-return before the global esc-quits-the-app path.
    expect(quitCount).toBe(0);
  });

  test("q opens the quit confirm instead of quitting immediately", () => {
    let quitCount = 0;
    const handle = createKeyHandler({ openInEditor: noop, quit: () => quitCount++ });

    handle(keyEvent({ name: "q" }));

    expect(state.quitConfirmOpen()).toBe(true);
    expect(quitCount).toBe(0);
  });

  test("escape from a clean state does nothing: never opens the confirm, never quits", () => {
    let quitCount = 0;
    const handle = createKeyHandler({ openInEditor: noop, quit: () => quitCount++ });

    handle(keyEvent({ name: "escape" }));

    expect(state.quitConfirmOpen()).toBe(false);
    expect(quitCount).toBe(0);
  });

  test("the quit confirm owns the keyboard: y and enter quit, esc and n cancel, other keys are swallowed", () => {
    let quitCount = 0;
    const handle = createKeyHandler({ openInEditor: noop, quit: () => quitCount++ });

    state.setQuitConfirmOpen(true);
    handle(keyEvent({ name: "y" }));
    expect(quitCount).toBe(1);

    state.setQuitConfirmOpen(true);
    handle(keyEvent({ name: "return" }));
    expect(quitCount).toBe(2);

    state.setQuitConfirmOpen(true);
    handle(keyEvent({ name: "escape" }));
    expect(state.quitConfirmOpen()).toBe(false);
    expect(quitCount).toBe(2);

    state.setQuitConfirmOpen(true);
    handle(keyEvent({ name: "n" }));
    expect(state.quitConfirmOpen()).toBe(false);
    expect(quitCount).toBe(2);

    // An unrelated key is swallowed: no quit, and the confirm stays open.
    state.setQuitConfirmOpen(true);
    handle(keyEvent({ name: "j" }));
    expect(quitCount).toBe(2);
    expect(state.quitConfirmOpen()).toBe(true);
  });

  test("ctrl-c quits instantly even while the quit confirm is open", () => {
    let quitCount = 0;
    const handle = createKeyHandler({ openInEditor: noop, quit: () => quitCount++ });

    state.setQuitConfirmOpen(true);
    handle(keyEvent({ ctrl: true, name: "c" }));

    expect(quitCount).toBe(1);
  });

  // The copy keys are registered `global`, so before they dispatched on the focused
  // Pane they read the viewer no matter which pane the user was actually in: `y` with
  // A diagnostic selected copied a diff line instead of the diagnostic.
  describe("copy keys with the problems panel focused", () => {
    const focusProblemsWith = (message: string) => {
      batch(() => {
        state.seedNav("src/foo.ts");
        state.setCheckerState({
          diagnostics: new Map([
            [
              "src/a.ts",
              {
                count: 1,
                diagnostics: [
                  {
                    checker: "diagnostics",
                    column: 4,
                    line: 12,
                    message,
                    path: "src/a.ts",
                    severity: "error",
                    source: "oxc",
                  },
                ],
                status: "findings",
              },
            ],
          ]),
        });
        state.setProblemsOpen(true);
        state.setFocusedPane("problems");
        state.setProblemIndex(state.firstNavigableProblemIndex());
      });
    };

    // Count which action each key reached, without the clipboard subprocess
    // (pbcopy/xclip, absent on CI). What each action *copies* is asserted on the pure
    // Formatter in diagnostics-problems.test.ts.
    const countCopyDispatches = (press: (handle: (key: KeyEvent) => void) => void) => {
      const calls: string[] = [];
      const real = {
        copyAllProblems: state.copyAllProblems,
        copyFileContents: state.copyFileContents,
        copyProblem: state.copyProblem,
        copySelection: state.copySelection,
      };
      state.copyProblem = () => calls.push("copyProblem");
      state.copyAllProblems = () => calls.push("copyAllProblems");
      state.copyFileContents = () => calls.push("copyFileContents");
      state.copySelection = () => calls.push("copySelection");
      try {
        press(createKeyHandler({ openInEditor: noop, quit: noop }));
      } finally {
        Object.assign(state, real);
      }
      return calls;
    };

    test("y copies the selected problem and never the viewer's reference", () => {
      focusProblemsWith("bad thing");

      expect(countCopyDispatches((handle) => handle(keyEvent({ name: "y" })))).toEqual([
        "copyProblem",
      ]);
    });

    test("Y copies every problem and never the viewed file's contents", () => {
      focusProblemsWith("bad thing");

      expect(countCopyDispatches((handle) => handle(keyEvent({ name: "Y", shift: true })))).toEqual(
        ["copyAllProblems"],
      );
    });

    test("C is inert: a line selection is a viewer concept the panel has no analogue for", () => {
      focusProblemsWith("bad thing");

      expect(countCopyDispatches((handle) => handle(keyEvent({ name: "C", shift: true })))).toEqual(
        [],
      );
    });

    test("an empty panel says so rather than copying", () => {
      batch(() => {
        state.setCheckerState({ diagnostics: new Map() });
        state.setProblemsOpen(true);
        state.setFocusedPane("problems");
      });
      const handle = createKeyHandler({ openInEditor: noop, quit: noop });

      handle(keyEvent({ name: "y" }));
      expect(state.statusRightMessage()).toBe("no problems to copy");

      handle(keyEvent({ name: "Y", shift: true }));
      expect(state.statusRightMessage()).toBe("no problems to copy");
    });

    test("the viewer keeps its own copy targets once focus leaves the panel", () => {
      focusProblemsWith("bad thing");
      state.setFocusedPane("diff");

      expect(countCopyDispatches((handle) => handle(keyEvent({ name: "Y", shift: true })))).toEqual(
        ["copyFileContents"],
      );
      expect(countCopyDispatches((handle) => handle(keyEvent({ name: "C", shift: true })))).toEqual(
        ["copySelection"],
      );
    });
  });

  test("escape only ever closes: problems panel, then search view, never quits", () => {
    const handle = createKeyHandler({ openInEditor: noop, quit: noop });

    state.setProblemsOpen(true);
    handle(keyEvent({ name: "escape" }));
    expect(state.problemsOpen()).toBe(false);
    expect(state.quitConfirmOpen()).toBe(false);

    state.openSearch();
    state.setFocusedPane("tree");
    handle(keyEvent({ name: "escape" }));
    expect(state.mainView()).toBe("file");
    expect(state.quitConfirmOpen()).toBe(false);
  });
});
