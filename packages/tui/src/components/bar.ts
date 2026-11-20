// The header and status bars are drawn as rules with their text inset. Both bars and the status
// Model's fit budget read these, so a bar's painted width and its measured width move together.

/** Rule cells left showing at each edge of a bar. */
export const BAR_EDGE = 1;

/** Spaces on each side of an island, the run of text that interrupts the rule. */
export const ISLAND_PAD = 1;

/**
 * Separates fields inside a bar with a cell of the rule itself, which the bars tint as the rule, so
 * a bar reads as one line broken by its fields. The header's budgets measure it like any other field.
 */
export const BAR_SEP = " ─ ";
