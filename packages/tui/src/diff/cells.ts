import { measureEditText } from "@opentui/core";
import type { WidthMethod } from "@opentui/core";
import { createSignal } from "solid-js";

// How the terminal counts a cluster's cells, which the renderer learns from it, sometimes after the
// First paint. A signal, so every width measured before the answer is measured again, and
// Process-global because the span math and the reveal actions run outside the render tree.
const [widthMethod, registerWidthMethod] =
  createSignal<WidthMethod>("unicode-wide");

export { registerWidthMethod, widthMethod };

// OpenTUI paints every tab as two cells (it has no tab stops) and a control character as none.
const TAB_CELLS = 2;
const UNPAINTED = /(?!\t)\p{Cc}/gu;

// Text of one cell per character, a tab aside, which needs no measuring.
const PLAIN = /^[\t -~]*$/u;

/**
 * The cells OpenTUI paints `text` in, by its own measure. `Bun.stringWidth` differs: it counts a tab
 * as none, skips a whole escape sequence, and disagrees on marks such as a soft hyphen or an Indic
 * vowel sign.
 */
export const cellWidth = (text: string) =>
  PLAIN.test(text)
    ? text.length + (TAB_CELLS - 1) * (text.split("\t").length - 1)
    : measureEditText(text.replaceAll(UNPAINTED, ""), {
        tabWidth: TAB_CELLS,
        widthMethod: widthMethod(),
      });
