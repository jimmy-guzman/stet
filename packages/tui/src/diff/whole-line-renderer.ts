import { DiffHunksRenderer } from "@pierre/diffs";

/**
 * A `DiffHunksRenderer` that never cuts a long line. Since `@pierre/diffs` 1.7.0 the renderer cuts
 * any line past `tokenizeMaxLineLength` and ends it with a DOM "show full line" button, which a
 * terminal row has no use for, so the viewer and `C` copy silently lost the rest of the line.
 * Setting the option to `0` lifts the cut, but lifts the highlight limit with it: a 5MB minified
 * line then tokenizes into ~3M spans (~0.5s measured) where an unhighlighted line is one. So the
 * `0` reaches only the cut, through the library's own reading of it.
 */
export class WholeLineRenderer extends DiffHunksRenderer {
  override getLineCutLength(options = this.options) {
    return super.getLineCutLength({
      ...options,
      tokenizeMaxLineLength: 0,
    });
  }
}
