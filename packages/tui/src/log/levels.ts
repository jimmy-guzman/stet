import type { Theme } from "@/theme/tokens";

export type LogLevel = "error" | "warning" | "success" | "info";

// Notable states (error/warning/success) take their severity token; info is the
// Neutral baseline (a routine ack), so it takes a text role. text.secondary here is
// Intended, not an oversight.
export const levelColor = (colors: Theme, level: LogLevel) =>
  ({
    error: colors.severity.error,
    info: colors.text.secondary,
    success: colors.success,
    warning: colors.severity.warning,
  })[level];

// Bare text-presentation codepoints, never the U+FE0F variation-selector form: a
// VS16 emoji renders two rows tall and strands the status row.
const LEVEL_GLYPH: Record<LogLevel, string> = {
  error: "✖",
  info: "ℹ",
  success: "✓",
  warning: "⚠",
};

export const levelGlyph = (level: LogLevel) => LEVEL_GLYPH[level];
