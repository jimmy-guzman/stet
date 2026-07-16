import { Context, Data, Effect, Layer, Result } from "effect";

import { loadConfigText } from "./load";
import type { LoadedConfig } from "./load";
import { configPaths } from "./paths";
import { updateSettingsText } from "./write";
import type { SettingsSnapshot } from "./write";

class ConfigReadError extends Data.TaggedError("ConfigReadError")<{
  readonly message: string;
}> {}

class ConfigWriteError extends Data.TaggedError("ConfigWriteError")<{
  readonly message: string;
}> {}

export class Config extends Context.Service<
  Config,
  {
    readonly load: () => Effect.Effect<LoadedConfig>;
    /**
     * Writes the snapshot's divergences back to the user config (the first existing candidate, else
     * a fresh `config.jsonc`), preserving comments.
     *
     * @returns The deduped feature labels that changed; empty means the file already matched and
     *   nothing was written.
     */
    readonly persistSettings: (
      snapshot: SettingsSnapshot,
    ) => Effect.Effect<string[], ConfigWriteError>;
  }
>()("stet/Config") {}

const firstExistingConfig = Effect.gen(function* findConfig() {
  for (const candidate of configPaths()) {
    const exists = yield* Effect.promise(() => Bun.file(candidate).exists());
    if (exists) {
      return candidate;
    }
  }
  return undefined;
});

export const ConfigLive = Layer.effect(
  Config,
  Effect.sync(() => ({
    // No config file is the common case: defaults, no issue. A real read failure
    // (permissions, etc.) is downgraded to defaults plus an issue so the TUI
    // Always boots; only parse/validation issues come from loadConfigText.
    load: () =>
      Effect.gen(function* configLoad() {
        const path = yield* firstExistingConfig;
        if (path === undefined) {
          return { config: {}, issues: [] };
        }

        return yield* Effect.tryPromise({
          catch: (cause) =>
            new ConfigReadError({ message: `could not read config: ${String(cause)}` }),
          try: () => Bun.file(path).text(),
        }).pipe(
          Effect.map(loadConfigText),
          Effect.catch((error) => Effect.succeed({ config: {}, issues: [error.message] })),
        );
      }),
    persistSettings: (snapshot) =>
      Effect.gen(function* persist() {
        const existing = yield* firstExistingConfig;
        // No file yet: seed the primary candidate; Bun.write creates its directory.
        const path = existing ?? configPaths()[0];
        if (path === undefined) {
          return yield* new ConfigWriteError({ message: "no config path available" });
        }
        const text =
          existing === undefined
            ? "{}"
            : yield* Effect.tryPromise({
                catch: (cause) =>
                  new ConfigWriteError({ message: `could not read config: ${String(cause)}` }),
                try: () => Bun.file(existing).text(),
              });
        const updated = yield* updateSettingsText(text, snapshot).pipe(
          Result.match({
            onFailure: (message) => Effect.fail(new ConfigWriteError({ message })),
            onSuccess: (value) => Effect.succeed(value),
          }),
        );
        if (updated.saved.length > 0) {
          yield* Effect.tryPromise({
            catch: (cause) =>
              new ConfigWriteError({ message: `could not write config: ${String(cause)}` }),
            try: () => Bun.write(path, updated.text),
          });
        }
        return updated.saved;
      }),
  })),
);
