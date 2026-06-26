import { afterEach, describe, expect, test } from "bun:test";

import { KeyEvent } from "@opentui/core";
import { batch } from "solid-js";

import { createKeyHandler } from "../src/keymap";
import { state } from "../src/state";

const keyEvent = (overrides: { ctrl?: boolean; name: string }) =>
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
    state.setSelectedPath(undefined);
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
    batch(() => state.setSelectedPath("src/foo.ts"));
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
    batch(() => state.setSelectedPath("src/bar.ts"));
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
});
