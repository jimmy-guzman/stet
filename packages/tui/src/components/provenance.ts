import type { Provenance } from "@/git/provenance";

// The provenance rail's band glyphs, a fill-weight ramp (thick -> thin) across the five-tier
// Timeline that reads as a scrutiny gradient under NO_COLOR where the band color alone would
// Not. Block Elements, not Box-Drawing: the same reason the change bar is a block (rarer
// Box-drawing forms fall back to a mis-metriced font and misalign the gutter in some
// Terminals). The `changed` glyph shares the change bar's `▎` but never collides: it lands
// Only on committed context lines, where the change bar is blank. Shared by the viewer rail
// (DiffView) and the status bar's provenance lead.
export function provenanceGlyph(band: Provenance) {
  return band === "uncommitted"
    ? "▋"
    : band === "session"
      ? "▌"
      : band === "branch"
        ? "▍"
        : band === "changed"
          ? "▎"
          : "▏";
}
