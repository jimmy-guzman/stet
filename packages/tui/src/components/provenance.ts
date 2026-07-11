import type { Provenance } from "@/git/provenance";

// The provenance rail's band glyphs, a fill-weight ramp (thick -> thin) that reads as a
// Scrutiny gradient under NO_COLOR where the band color alone would not. Block Elements, not
// Box-Drawing: the same reason the change bar is a block (rarer box-drawing forms fall back
// To a mis-metriced font and misalign the gutter in some terminals). Shared by the viewer
// Rail (DiffView) and the status bar's provenance lead.
export function provenanceGlyph(band: Provenance) {
  return band === "uncommitted" ? "▋" : band === "session" ? "▍" : "▏";
}
