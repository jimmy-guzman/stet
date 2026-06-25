function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recursively merge `overrides` onto `base`, returning a new value. Nested plain objects merge
 * key-by-key; every other value (hex strings included) replaces. Used to layer a partial theme
 * override onto a resolved base theme; the merged result is validated against `ThemeSchema` by the
 * caller, so extra or wrong keys surface there rather than here.
 */
export function mergeDeep(base: unknown, overrides: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(overrides)) {
    return overrides;
  }

  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    out[key] = key in base ? mergeDeep(base[key], value) : value;
  }
  return out;
}
