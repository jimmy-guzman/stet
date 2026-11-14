import { afterEach, describe, expect, test } from "bun:test";

import { KeyEvent } from "@opentui/core";
import { batch } from "solid-js";

import { createKeyHandler } from "@/keymap";
import { state } from "@/state";

const keyEvent = (overrides: {
  ctrl?: boolean;
  name: string;
  shift?: boolean;
}) =>
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

const noop = () => {};
const noopOpen = async () => {};

/**
 * Count which action each key reached, without the clipboard subprocess
 * (pbcopy/xclip, absent on CI).
 */
const countCopyDispatches = (
  press: (handle: (key: KeyEvent) => void) => void
) => {
  const calls: string[] = [];

  const real = {
    copyFileContents: state.copyFileContents,
    copySelection: state.copySelection,
  };

  state.copyFileContents = () => {
    calls.push("copyFileContents");
  };

  state.copySelection = () => {
    calls.push("copySelection");
  };

  try {
    press(createKeyHandler({ openInEditor: noopOpen, quit: noop }));
  } finally {
    Object.assign(state, real);
  }

  return calls;
};

describe("createKeyHandler", () => {
  afterEach(() => {
    state.closeCommandMenu();
    state.setQuitConfirmOpen(false);
    state.setFocusedPane("tree");
    state.seedNav(undefined);
  });

  test("ctrl-c quits", () => {
    let quitCount = 0;

    const handle = createKeyHandler({
      openInEditor: noopOpen,
      quit: () => {
        quitCount += 1;
      },
    });

    handle(keyEvent({ ctrl: true, name: "c" }));

    expect(quitCount).toBe(1);
  });

  test("a plain c does not quit", () => {
    let quitCount = 0;

    const handle = createKeyHandler({
      openInEditor: noopOpen,
      quit: () => {
        quitCount += 1;
      },
    });

    handle(keyEvent({ name: "c" }));

    expect(quitCount).toBe(0);
  });

  test("e opens the selected file in terminal editor", () => {
    batch(() => {
      state.seedNav("src/foo.ts");
    });
    const calls: [string, number | undefined, string][] = [];

    const handle = createKeyHandler({
      openInEditor: async (path, line, mode) => {
        calls.push([path, line, mode]);
        await Promise.resolve();
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
        await Promise.resolve();
      },
      quit: noop,
    });

    handle(keyEvent({ name: "e" }));

    expect(calls).toEqual([]);
  });

  test("o opens the selected file in IDE", () => {
    batch(() => {
      state.seedNav("src/bar.ts");
    });
    const calls: [string, number | undefined, string][] = [];

    const handle = createKeyHandler({
      openInEditor: async (path, line, mode) => {
        calls.push([path, line, mode]);
        await Promise.resolve();
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
        await Promise.resolve();
      },
      quit: noop,
    });

    handle(keyEvent({ name: "o" }));

    expect(calls).toEqual([]);
  });

  test("< steps back and > steps forward through history", () => {
    state.selectFile("a.ts");
    state.selectFile("b.ts");
    const handle = createKeyHandler({ openInEditor: noopOpen, quit: noop });

    handle(keyEvent({ name: "<" }));
    expect(state.selectedPath()).toBe("a.ts");

    handle(keyEvent({ name: ">" }));
    expect(state.selectedPath()).toBe("b.ts");
  });

  test("] re-opens a collapsed sidebar", () => {
    // Collapsed, the same path a shrink past the minimum takes
    state.toggleSidebar();
    expect(state.sidebarOpen()).toBe(false);
    const handle = createKeyHandler({ openInEditor: noopOpen, quit: noop });

    handle(keyEvent({ name: "]" }));

    expect(state.sidebarOpen()).toBe(true);
  });

  test("ctrl-t pins; a later navigation opens a fresh preview; { } cycle; ctrl-w closes", () => {
    state.selectFile("a.ts");
    const handle = createKeyHandler({ openInEditor: noopOpen, quit: noop });

    // Pin a.ts (no new tab yet)
    handle(keyEvent({ ctrl: true, name: "t" }));
    expect(state.tabItems().length).toBe(1);
    expect(state.tabItems()[0].preview).toBe(false);

    // Fresh preview -> two tabs
    state.selectFile("b.ts");
    expect(state.tabItems().length).toBe(2);

    const activeBefore = state.tabItems().findIndex((tab) => tab.active);
    handle(keyEvent({ name: "{" }));
    expect(state.tabItems().findIndex((tab) => tab.active)).not.toBe(
      activeBefore
    );

    handle(keyEvent({ ctrl: true, name: "w" }));
    expect(state.tabItems().length).toBe(1);
  });

  test("ctrl-t does not fall through to the theme picker", () => {
    state.selectFile("a.ts");
    const handle = createKeyHandler({ openInEditor: noopOpen, quit: noop });

    handle(keyEvent({ ctrl: true, name: "t" }));

    expect(state.themeComboboxOpen()).toBe(false);
  });

  test("plain s still opens the scope picker", () => {
    const handle = createKeyHandler({ openInEditor: noopOpen, quit: noop });

    try {
      handle(keyEvent({ name: "s" }));
      expect(state.scopeMenuOpen()).toBe(true);
    } finally {
      state.setScopeMenuOpen(false);
    }
  });

  test("Shift+S outside the file view is a no-op, never the scope picker", () => {
    const handle = createKeyHandler({ openInEditor: noopOpen, quit: noop });

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
    const handle = createKeyHandler({ openInEditor: noopOpen, quit: noop });

    handle(keyEvent({ name: "f10", shift: true }));

    expect(state.commandMenuOpen()).toBe(true);
    expect(state.commandMenuContext()).toBe("viewer");
    expect(state.commandMenuItems()[state.commandMenuIndex()]?.label).toBe(
      "Copy reference"
    );
  });

  test("the command menu owns the keyboard: j moves the highlight, esc closes, keys don't fall through", () => {
    batch(() => {
      state.seedNav("src/foo.ts");
      state.setFocusedPane("diff");
    });
    let quitCount = 0;

    const handle = createKeyHandler({
      openInEditor: noopOpen,
      quit: () => {
        quitCount += 1;
      },
    });

    handle(keyEvent({ name: "f10", shift: true }));

    // A plain q is swallowed while the menu is open (no fall-through to global quit).
    handle(keyEvent({ name: "q" }));
    expect(quitCount).toBe(0);
    expect(state.commandMenuOpen()).toBe(true);

    handle(keyEvent({ name: "j" }));
    expect(state.commandMenuItems()[state.commandMenuIndex()]?.label).toBe(
      "Copy file contents"
    );

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
        await Promise.resolve();
      },
      quit: noop,
    });

    handle(keyEvent({ name: "f10", shift: true }));

    // Step from "Copy reference" (0) to "Open in editor" (2).
    handle(keyEvent({ name: "j" }));
    handle(keyEvent({ name: "j" }));
    expect(state.commandMenuItems()[state.commandMenuIndex()]?.label).toBe(
      "Open in editor"
    );

    handle(keyEvent({ name: "return" }));

    expect(calls).toEqual([["src/foo.ts", undefined, "terminal"]]);
    expect(state.commandMenuOpen()).toBe(false);
  });

  test("q opens the quit confirm instead of quitting immediately", () => {
    let quitCount = 0;

    const handle = createKeyHandler({
      openInEditor: noopOpen,
      quit: () => {
        quitCount += 1;
      },
    });

    handle(keyEvent({ name: "q" }));

    expect(state.quitConfirmOpen()).toBe(true);
    expect(quitCount).toBe(0);
  });

  test("escape from a clean state does nothing: never opens the confirm, never quits", () => {
    let quitCount = 0;

    const handle = createKeyHandler({
      openInEditor: noopOpen,
      quit: () => {
        quitCount += 1;
      },
    });

    handle(keyEvent({ name: "escape" }));

    expect(state.quitConfirmOpen()).toBe(false);
    expect(quitCount).toBe(0);
  });

  test("the quit confirm owns the keyboard: y and enter quit, esc and n cancel, other keys are swallowed", () => {
    let quitCount = 0;

    const handle = createKeyHandler({
      openInEditor: noopOpen,
      quit: () => {
        quitCount += 1;
      },
    });

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

    const handle = createKeyHandler({
      openInEditor: noopOpen,
      quit: () => {
        quitCount += 1;
      },
    });

    state.setQuitConfirmOpen(true);
    handle(keyEvent({ ctrl: true, name: "c" }));

    expect(quitCount).toBe(1);
  });

  describe("copy keys in the viewer", () => {
    test("Y copies the file and C the selection", () => {
      batch(() => {
        state.seedNav("src/foo.ts");
        state.setFocusedPane("diff");
      });

      expect(
        countCopyDispatches((handle) => {
          handle(keyEvent({ name: "Y", shift: true }));
        })
      ).toEqual(["copyFileContents"]);
      expect(
        countCopyDispatches((handle) => {
          handle(keyEvent({ name: "C", shift: true }));
        })
      ).toEqual(["copySelection"]);
    });
  });

  test("escape only ever closes the search view, never quits", () => {
    const handle = createKeyHandler({ openInEditor: noopOpen, quit: noop });

    handle(keyEvent({ name: "escape" }));
    expect(state.quitConfirmOpen()).toBe(false);

    state.openSearch();
    state.setFocusedPane("tree");
    handle(keyEvent({ name: "escape" }));
    expect(state.mainView()).toBe("file");
    expect(state.quitConfirmOpen()).toBe(false);
  });
});
