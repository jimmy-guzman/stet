import { expect, test } from "bun:test";

import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "solid-js";

import { state } from "@/state";
import { syncTerminalTitle } from "@/terminal-title";

/**
 * A test renderer skips terminal setup, so OpenTUI throws on any title write to it. That throw is
 * what these cases observe: none while the gate holds, one the moment the effect writes.
 */

test("the title waits out a suspension and is written when it ends", async () => {
  const { renderer } = await createTestRenderer({ height: 10, width: 40 });
  state.setTerminalSuspended(true);

  const dispose = createRoot((disposeRoot) => {
    syncTerminalTitle(renderer);

    return disposeRoot;
  });

  try {
    expect(() => {
      state.setTerminalSuspended(false);
    }).toThrow("InvalidPhase");
  } finally {
    dispose();
    renderer.destroy();
  }
});

test("a destroyed renderer gets no title write", async () => {
  const { renderer } = await createTestRenderer({ height: 10, width: 40 });
  state.setTerminalSuspended(true);

  const dispose = createRoot((disposeRoot) => {
    syncTerminalTitle(renderer);

    return disposeRoot;
  });

  try {
    renderer.destroy();

    expect(() => {
      state.setTerminalSuspended(false);
    }).not.toThrow();
  } finally {
    dispose();
  }
});
