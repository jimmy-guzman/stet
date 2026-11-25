import type { ClipboardWriteResult } from "@opentui/core";
import { Context, Effect, Layer } from "effect";

import { ClipboardError } from "./error";
import { clipboardWriter } from "./registry";

/**
 * Where a copy landed. Only the system clipboard confirms a write. A terminal (OSC 52) gives no
 * answer, and a multiplexer may drop the sequence, so that path is sent, never known to be copied.
 */
export type CopyDestination = "clipboard" | "terminal";

/**
 * On Linux the process that wrote the clipboard serves it, so a copy is lost when stet exits unless
 * something else takes it over. Writing to the terminal too makes a terminal with OSC 52 the owner.
 * Elsewhere the system keeps the text, so the terminal is only the fallback.
 * `platform` is a parameter so both branches are unit-testable.
 */
export const writeDestination = (
  platform: NodeJS.Platform = process.platform
) => (platform === "linux" ? "all-available" : "best-available");

const failureMessage = ({ host }: ClipboardWriteResult) => {
  if (host.status === "failed") {
    return "the system clipboard refused the text; try again";
  }

  return host.status === "timed-out"
    ? "the system clipboard did not respond; try again"
    : "no clipboard here; use a terminal that supports OSC 52";
};

// OpenTUI refuses text over its size limit, or text a clipboard cannot hold (a NUL), before it tries
// To write it, in its own API's terms.
const rejection = (cause: unknown) => {
  if (cause instanceof RangeError) {
    return "too large for the clipboard; select a part of it";
  }

  if (cause instanceof TypeError) {
    return "this text has characters the clipboard cannot hold; select a part of it";
  }

  return cause instanceof Error ? cause.message : String(cause);
};

export class Clipboard extends Context.Service<
  Clipboard,
  {
    readonly copy: (
      text: string
    ) => Effect.Effect<CopyDestination, ClipboardError>;
  }
>()("stet/Clipboard") {}

export const ClipboardLive = Layer.succeed(Clipboard)({
  copy: Effect.fnUntraced(function* copy(text: string) {
    const writer = clipboardWriter();

    if (writer === undefined) {
      return yield* new ClipboardError({ message: "no clipboard available" });
    }

    const result = yield* Effect.tryPromise({
      catch: (cause) => new ClipboardError({ message: rejection(cause) }),
      try: async (signal) =>
        await writer.writeText(text, {
          destination: writeDestination(),
          signal,
        }),
    });

    if (result.host.status === "written") {
      return "clipboard";
    }

    if (result.terminal.status === "attempted") {
      return "terminal";
    }

    return yield* new ClipboardError({ message: failureMessage(result) });
  }),
});
