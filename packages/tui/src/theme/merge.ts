function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-merge: nested plain objects merge key-by-key, every other value (hex strings included)
 * replaces. Returns a new value, never mutates `base`. The caller validates the merged theme
 * against `ThemeSchema`, so wrong or extra keys surface there, not here.
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
