const DOUBLE_CLICK_MS = 400;

// OpenTUI has no double-click event, so callers detect it themselves from
// Successive `onMouseDown`s. Each guard tracks the last click's identity and
// Time; a second click on the same id within the window reads as a double. The
// Id resets on a double so a third rapid click is not counted as another double.
export function createDoubleClickGuard() {
  let last = { at: 0, id: "" };
  return (id: string) => {
    const at = Date.now();
    const isDouble = id === last.id && at - last.at <= DOUBLE_CLICK_MS;
    last = { at, id: isDouble ? "" : id };
    return isDouble;
  };
}
