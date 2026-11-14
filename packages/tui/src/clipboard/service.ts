import { Context, Effect, Layer } from "effect";

import { Process } from "@/process";

import { ClipboardError } from "./error";
import { clipboardCommand } from "./reference";

export class Clipboard extends Context.Service<
  Clipboard,
  {
    readonly copy: (text: string) => Effect.Effect<void, ClipboardError>;
  }
>()("stet/Clipboard") {}

export const ClipboardLive = Layer.effect(
  Clipboard,
  Effect.gen(function* clipboardLive() {
    const subprocess = yield* Process;

    return {
      copy: (text) => {
        const command = clipboardCommand();

        if (command === undefined) {
          return Effect.fail(
            new ClipboardError({
              message:
                "no clipboard tool found; install wl-copy, xclip, or xsel",
            })
          );
        }

        return subprocess.run(command, process.cwd(), { stdin: text }).pipe(
          Effect.asVoid,
          Effect.mapError(
            (failure) => new ClipboardError({ message: failure.message })
          )
        );
      },
    };
  })
);
