import { Result, Schema } from "effect";

import { emptyConfig, UserConfigSchema, type UserConfig } from "./schema";

/**
 * A parsed config plus any issues. Issues never block startup: a malformed or invalid config falls
 * back to defaults and the issues surface as a notice.
 */
export interface LoadedConfig {
  config: UserConfig;
  issues: string[];
}

const decode = Schema.decodeUnknownResult(UserConfigSchema);

/**
 * Pure: config text -> parsed/validated config + issues. No IO (Bun.JSONC.parse is the native JSONC
 * reader).
 */
export function loadConfigText(text: string): LoadedConfig {
  let parsed: unknown;
  try {
    parsed = Bun.JSONC.parse(text);
  } catch (error) {
    return {
      config: emptyConfig,
      issues: [
        `config is not valid JSONC: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }

  return Result.match(decode(parsed), {
    onFailure: (error) => ({ config: emptyConfig, issues: [String(error)] }),
    onSuccess: (config) => ({ config, issues: [] }),
  });
}
