/**
 * The combo grammar for keybindings: optional `ctrl`/`shift` modifiers joined by `+` or `-`, then a
 * key. A single uppercase letter is shorthand for shift+letter (`"G"` ≡ `"shift+g"`), matching how
 * the help has always written them. Arrow glyphs and common aliases map to OpenTUI's key names so
 * the config can use what the help shows (`"Shift+↑"`, `"enter"`).
 */
export interface Combo {
  ctrl: boolean;
  name: string;
  shift: boolean;
}

const aliases = new Map([
  ["enter", "return"],
  ["esc", "escape"],
  ["←", "left"],
  ["→", "right"],
  ["↑", "up"],
  ["↓", "down"],
]);

const isLetter = (text: string) => /^[a-z]$/i.test(text);

/**
 * @returns The parsed combo, or undefined for text the grammar does not accept (empty, an unknown
 *   dangling modifier, or `shift+` on a character that already encodes its shift, like `?`).
 */
export function parseCombo(text: string): Combo | undefined {
  const read = (rest: string, ctrl: boolean, shift: boolean): Combo | undefined => {
    const modifier = /^(?<name>ctrl|shift)[+-](?<rest>.+)$/i.exec(rest);
    if (modifier?.groups?.name !== undefined && modifier.groups.rest !== undefined) {
      const lower = modifier.groups.name.toLowerCase();
      return read(modifier.groups.rest, ctrl || lower === "ctrl", shift || lower === "shift");
    }
    const name = aliases.get(rest.toLowerCase()) ?? rest;
    if (name.length === 1) {
      if (isLetter(name)) {
        // "G" and "shift+g" are the same combo.
        return { ctrl, name: name.toLowerCase(), shift: shift || name !== name.toLowerCase() };
      }
      // A symbol carries its own shift (typing "?" needs it on most layouts),
      // So a shift modifier on one is meaningless and rejected as a typo.
      return shift ? undefined : { ctrl, name, shift: false };
    }
    return /^[a-z]+\d*$/.test(name.toLowerCase())
      ? { ctrl, name: name.toLowerCase(), shift }
      : undefined;
  };
  return text === "" ? undefined : read(text.trim(), false, false);
}

/**
 * Whether a key event matches a combo, normalizing the terminal shift-letter ambiguity in this one
 * place: some terminals report Shift+G as `{ name: "G" }`, others as `{ name: "g", shift: true }`,
 * and both must hit the same binding. A symbol's shift flag is ignored entirely (terminals disagree
 * about whether `?` carries it). Modifiers otherwise match exactly, which is what keeps `"s"` from
 * firing on `ctrl+s` or `Shift+S` without any per-site exclusion guard.
 */
export function matchesKey(
  key: { ctrl: boolean; name: string; shift: boolean },
  combo: Combo,
): boolean {
  if (key.ctrl !== combo.ctrl) {
    return false;
  }
  if (key.name.length === 1) {
    if (isLetter(key.name)) {
      const shift = key.shift || key.name !== key.name.toLowerCase();
      return key.name.toLowerCase() === combo.name && shift === combo.shift;
    }
    return key.name === combo.name;
  }
  return key.name.toLowerCase() === combo.name && key.shift === combo.shift;
}
