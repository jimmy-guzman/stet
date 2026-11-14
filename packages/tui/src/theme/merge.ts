import { Predicate } from "effect";
import type { Schema } from "effect";

/** Within a JSON value, the only non-null, non-array object is a JSON object. */
export const isJsonObject = (value: Schema.Json): value is Schema.JsonObject =>
  Predicate.isObject(value);

/**
 * Deep-merge: nested plain objects merge key-by-key, every other value (hex strings included)
 * replaces. Returns a new value, never mutates `base`. The caller validates the merged theme
 * against `ThemeSchema`, so wrong or extra keys surface there, not here.
 */
export const mergeDeep = (
  base: Schema.Json,
  overrides: Schema.Json
): Schema.Json => {
  if (!isJsonObject(base) || !isJsonObject(overrides)) {
    return overrides;
  }

  const merged = Object.entries(overrides).map(
    ([key, value]): [string, Schema.Json] => [
      key,
      key in base ? mergeDeep(base[key], value) : value,
    ]
  );

  return Object.fromEntries([...Object.entries(base), ...merged]);
};
