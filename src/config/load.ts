import { Result, Schema } from "effect";

import { emptyConfig, UserConfigSchema, type UserConfig } from "./schema";

// Issues never block startup: a malformed or invalid config falls back to
// Defaults and the issues surface as a notice.
export interface LoadedConfig {
  config: UserConfig;
  issues: string[];
}

const decode = Schema.decodeUnknownResult(UserConfigSchema);

// Bun.JSONC.parse throws; a Result lets the parse and decode failures compose.
function parseJsonc(text: string) {
  try {
    return Result.succeed(Bun.JSONC.parse(text));
  } catch (error) {
    return Result.fail(
      `config is not valid JSONC: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function loadConfigText(text: string): LoadedConfig {
  return parseJsonc(text).pipe(
    Result.flatMap(decode),
    Result.match({
      onFailure: (error) => ({
        config: emptyConfig,
        issues: [typeof error === "string" ? error : String(error)],
      }),
      onSuccess: (config) => ({ config, issues: [] }),
    }),
  );
}
