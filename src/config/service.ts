import { Context, Data, Effect, Layer } from "effect";

import { loadConfigText, type LoadedConfig } from "./load";
import { configPath } from "./paths";

class ConfigReadError extends Data.TaggedError("ConfigReadError")<{
  readonly message: string;
}> {}

export class Config extends Context.Service<
  Config,
  {
    readonly load: () => Effect.Effect<LoadedConfig>;
  }
>()("sideye/Config") {}

export const ConfigLive = Layer.effect(
  Config,
  Effect.sync(() => ({
    // A missing file is the common case: defaults, no issue. A real read failure
    // (permissions, etc.) is downgraded to defaults plus an issue so the TUI
    // Always boots; only parse/validation issues come from loadConfigText.
    load: () =>
      Effect.gen(function* configLoad() {
        const file = Bun.file(configPath());
        const exists = yield* Effect.promise(() => file.exists());
        if (!exists) {
          return { config: {}, issues: [] };
        }

        return yield* Effect.tryPromise({
          catch: (cause) =>
            new ConfigReadError({ message: `could not read config: ${String(cause)}` }),
          try: () => file.text(),
        }).pipe(
          Effect.map(loadConfigText),
          Effect.catch((error) => Effect.succeed({ config: {}, issues: [error.message] })),
        );
      }),
  })),
);
