/**
 * Answers "does the user want a monochrome palette", deliberately not `Bun.enableANSIColors`: that
 * getter folds in TTY detection plus Bun's own NO_COLOR resolution, which treats
 * `NO_COLOR=0`/`NO_COLOR=false` as unset, contradicting no-color.org (any non-empty value disables
 * color, regardless of value). `FORCE_COLOR`, when present at all, decides outright (only
 * `"0"`/`"false"` mean off, the supports-color convention); otherwise `NO_COLOR` wins whenever it
 * is set to anything but the empty string.
 */
export const prefersMonochrome = (env: Record<string, string | undefined>) => {
  if (env.FORCE_COLOR !== undefined) {
    return env.FORCE_COLOR === "0" || env.FORCE_COLOR === "false";
  }

  return env.NO_COLOR !== undefined && env.NO_COLOR !== "";
};
