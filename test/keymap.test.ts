import { describe, expect, mock, test } from "bun:test";

import { KeyEvent } from "@opentui/core";

import { createKeyHandler } from "../src/keymap";

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
  test("ctrl-c quits", () => {
    const quit = mock(() => {});
    const handle = createKeyHandler({ quit, switchWorktree: () => {} });

    handle(keyEvent({ ctrl: true, name: "c" }));

    expect(quit).toHaveBeenCalledTimes(1);
  });

  test("a plain c does not quit", () => {
    const quit = mock(() => {});
    const handle = createKeyHandler({ quit, switchWorktree: () => {} });

    handle(keyEvent({ name: "c" }));

    expect(quit).not.toHaveBeenCalled();
  });
});
