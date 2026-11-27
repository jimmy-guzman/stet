import type { MouseEvent, MousePointerStyle, Renderable } from "@opentui/core";
import { Predicate } from "effect";
import { batch, createRoot, createSelector, createSignal } from "solid-js";

/**
 * A target's pointer: a fixed style, or one read off the event and the registered renderable (the
 * event's `currentTarget` is whoever is tracking, not the target), where `undefined` hands the
 * question to the target's ancestors (a pane whose own cells resize it but whose rows do not).
 */
type PointerStyle =
  | MousePointerStyle
  | ((event: MouseEvent, node: Renderable) => MousePointerStyle | undefined);

const styles = new WeakMap<Renderable, PointerStyle>();

// The last pointer event, so a target whose content moves under a still pointer can ask again.
let lastEvent: MouseEvent | undefined;

// What is under the pointer, answered in one place from every move rather than by per-target
// `over`/`out` pairs: OpenTUI sends no `out` to a renderable it destroyed (a picker row a click just
// Closed), so a pair-driven hover or pointer would stick. Kept in its own root, not `state`, since
// It holds renderables, which are render-tree resources.
const root = createRoot(() => {
  const [hovered, setHovered] = createSignal<Renderable | undefined>(undefined);

  const [pointerStyle, setPointerStyle] =
    createSignal<MousePointerStyle>("default");

  return {
    isHovered: createSelector<Renderable | undefined, Renderable>(hovered),
    pointerStyle,
    setHovered,
    setPointerStyle,
  };
});

const styleAt = (node: Renderable, event: MouseEvent) => {
  const style = styles.get(node);

  return style === undefined || Predicate.isString(style)
    ? style
    : style(event, node);
};

const claimant = (
  node: Renderable | null,
  event: MouseEvent
): { node: Renderable; style: MousePointerStyle } | undefined => {
  if (node === null) {
    return undefined;
  }

  const style = styleAt(node, event);

  return style === undefined ? claimant(node.parent, event) : { node, style };
};

/** The pointer style the terminal should show now. */
export const pointerStyle = () => root.pointerStyle();

/**
 * Record what the pointer is over: the nearest registered ancestor of the hit target, else text
 * OpenTUI lets the user select, else nothing. The app's root reads every move and every `over`, the
 * latter covering content that moved under a still pointer.
 */
export const trackPointer = (event: MouseEvent) => {
  // A held press owns the pointer: the `over` events a drag sends to what it crosses would light
  // Rows and swap the resize or text pointer mid-gesture. OpenTUI marks them with the press's
  // Source.
  if (event.type === "over" && event.source !== undefined) {
    return;
  }

  lastEvent = event;
  const found = claimant(event.target, event);

  batch(() => {
    root.setHovered(found?.node);
    root.setPointerStyle(
      found?.style ?? (event.target?.selectable === true ? "text" : "default")
    );
  });
};

/**
 * Register a renderable as a pointer target. Spread the returned `ref` onto it and read `hovered` for
 * its hover state; an `<Index>` slot keeps its renderable as its row changes, so the hover stays
 * with the slot under the pointer, which is the row shown there.
 */
export const hoverable = (style: PointerStyle) => {
  const [element, setElement] = createSignal<Renderable | undefined>(undefined);

  return {
    hovered: () => {
      const current = element();

      return current !== undefined && root.isHovered(current);
    },
    ref: (el: Renderable) => {
      styles.set(el, style);
      setElement(el);
    },
  };
};

/**
 * Answer again for a pointer that has not moved, for a target that stays the hit while what it
 * shows scrolls under the pointer (the viewer's one interaction layer).
 */
export const retrackPointer = () => {
  if (lastEvent !== undefined) {
    trackPointer(lastEvent);
  }
};

/** Forget the pointer, between tests. Registrations die with their renderables. */
export const resetPointer = () => {
  lastEvent = undefined;
  batch(() => {
    root.setHovered(undefined);
    root.setPointerStyle("default");
  });
};
