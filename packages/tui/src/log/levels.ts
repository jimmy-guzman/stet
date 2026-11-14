import type { Theme } from "@/theme/tokens";

export type LogLevel = "error" | "warning" | "success" | "info";

// Notable states (error/warning/success) take their severity token; info is the
// Neutral baseline (a routine ack), so it takes a text role. text.secondary here is
// Intended, not an oversight.
export function levelColor(colors: Theme, level: LogLevel) {
  return level === "error"
    ? colors.severity.error
    : level === "warning"
      ? colors.severity.warning
      : level === "success"
        ? colors.success
        : colors.text.secondary;
}

// Bare text-presentation codepoints, never the U+FE0F variation-selector form: a
// VS16 emoji renders two rows tall and strands the status row.
export function levelGlyph(level: LogLevel) {
  return level === "error" ? "✖" : level === "warning" ? "⚠" : level === "success" ? "✓" : "ℹ";
}
