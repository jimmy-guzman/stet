import { Result, Schema } from "effect";
import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";

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

const describeParseError = (error: ParseError) =>
  `${printParseErrorCode(error.error)} at offset ${error.offset}`;

/** Pure: config text -> parsed/validated config + issues. No IO. */
export function loadConfigText(text: string): LoadedConfig {
  const errors: ParseError[] = [];
  const parsed = parse(text, errors, { allowTrailingComma: true });

  if (errors.length > 0) {
    return {
      config: emptyConfig,
      issues: [`config is not valid JSONC: ${errors.map(describeParseError).join(", ")}`],
    };
  }

  return Result.match(decode(parsed), {
    onFailure: (error) => ({ config: emptyConfig, issues: [String(error)] }),
    onSuccess: (config) => ({ config, issues: [] }),
  });
}
