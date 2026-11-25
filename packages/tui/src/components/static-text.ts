import { TextRenderable } from "@opentui/core";
import { extend } from "@opentui/solid";

/**
 * Every `<text>` in stet. OpenTUI's own scrolls its buffer under the wheel whenever its content
 * overflows its box, on either axis, so a wheel over a clipped or wrapped row left it painting the
 * middle of its text. Nothing in stet scrolls a single text: lists and panes do, and the wheel still
 * bubbles to them.
 */
class StaticTextRenderable extends TextRenderable {
  protected override handleScroll() {
    this.scrollX = 0;
    this.scrollY = 0;
  }
}

extend({ text: StaticTextRenderable });
