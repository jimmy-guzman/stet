import { describe, expect, test } from "bun:test";

import type { ClipboardWriteResult } from "@opentui/core";
import { Effect } from "effect";

import { registerClipboard } from "@/clipboard/registry";
import { Clipboard, writeDestination } from "@/clipboard/service";
import { runtime } from "@/runtime";
import { state } from "@/state";

import { makeSettleUntil, recordClipboard } from "./helpers";

const notAttempted = {
  capability: "unsupported",
  status: "not-attempted",
} as const;

const answering = (result: ClipboardWriteResult) => {
  registerClipboard({ writeText: async () => await Promise.resolve(result) });
};

const copy = async (text: string) =>
  await runtime.runPromise(Clipboard.use((clipboard) => clipboard.copy(text)));

const failure = async (text: string) => {
  const error = await runtime.runPromise(
    Clipboard.use((clipboard) => clipboard.copy(text)).pipe(Effect.flip)
  );

  return error.message;
};

// There is nothing to render here, so a settle is only its wait.
const settleUntil = makeSettleUntil({
  captureCharFrame: () => "",
  renderOnce: async () => {
    await Promise.resolve();
  },
});

const noticeAfter = async (action: () => void) => {
  action();
  await settleUntil(
    "a notice",
    () => state.statusBarModel().kind === "message"
  );

  const model = state.statusBarModel();

  return model.kind === "message"
    ? { level: model.level, text: model.message }
    : undefined;
};

describe("clipboard", () => {
  test("a confirmed system write is copied", async () => {
    answering({ host: { status: "written" }, terminal: notAttempted });

    expect(await copy("text")).toBe("clipboard");
  });

  test("a system write is copied even when the terminal was written too", async () => {
    answering({
      host: { status: "written" },
      terminal: { capability: "unknown", status: "attempted" },
    });

    expect(await copy("text")).toBe("clipboard");
  });

  test("a terminal write alone is sent, never reported as copied", async () => {
    answering({
      host: { status: "not-attempted" },
      terminal: { capability: "unknown", status: "attempted" },
    });

    expect(await copy("text")).toBe("terminal");
    expect(
      await noticeAfter(() => {
        state.copy("text", "4 characters");
      })
    ).toEqual({ level: "info", text: "sent 4 characters to the terminal" });
  });

  test("a system failure says what to do, not the platform's own error", async () => {
    answering({
      host: {
        error: new Error("Native clipboard operation failed to start"),
        status: "failed",
      },
      terminal: notAttempted,
    });

    expect(await failure("text")).toBe(
      "the system clipboard refused the text; try again"
    );
  });

  test("no usable path says what to do", async () => {
    answering({ host: { status: "unsupported" }, terminal: notAttempted });

    expect(await failure("text")).toContain("supports OSC 52");
  });

  test("a system that does not answer says to try again", async () => {
    answering({ host: { status: "timed-out" }, terminal: notAttempted });

    expect(await failure("text")).toContain("did not respond");
  });

  test("a copy with nothing to write through fails", async () => {
    expect(await failure("text")).toBe("no clipboard available");
  });

  test("a write also goes to the terminal where the system will not keep it", () => {
    expect(writeDestination("linux")).toBe("all-available");
    expect(writeDestination("darwin")).toBe("best-available");
  });

  test("a write names its destination", async () => {
    const destinations: string[] = [];

    registerClipboard({
      writeText: async (_text, options) => {
        destinations.push(options.destination);

        return await Promise.resolve({
          host: { status: "written" },
          terminal: notAttempted,
        });
      },
    });
    await copy("text");

    expect(destinations).toEqual([writeDestination()]);
  });

  test.each([
    [
      new RangeError("writeText exceeds 8388608"),
      "too large for the clipboard",
    ],
    [new TypeError("writeText does not support NUL"), "cannot hold"],
    [new Error("boom"), "boom"],
  ])("a refused write explains itself", async (refusal, message) => {
    registerClipboard({
      writeText: async () => await Promise.reject(refusal),
    });

    const notice = await noticeAfter(() => {
      state.copy("text");
    });

    expect(notice?.level).toBe("error");
    expect(notice?.text).toContain(message);
    expect(notice?.text).not.toContain("writeText");
  });

  test("a copy names what was copied", async () => {
    const copied = recordClipboard();

    expect(
      await noticeAfter(() => {
        state.copy("src/a.ts:2");
      })
    ).toEqual({ level: "success", text: "copied src/a.ts:2" });
    expect(copied).toEqual(["src/a.ts:2"]);
  });

  test("empty text never reaches the clipboard", async () => {
    const copied = recordClipboard();

    expect(
      await noticeAfter(() => {
        state.copy("");
      })
    ).toEqual({ level: "info", text: "nothing to copy" });
    expect(copied).toEqual([]);
  });
});
