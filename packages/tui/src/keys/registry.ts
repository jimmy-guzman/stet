import type { KeyActionId } from "./actions";
import type { Combo } from "./combo";
import { defaultKeybindings } from "./resolve";
import type { KeybindingSet } from "./resolve";

// Process-global like the theme and file-support registries: resolved once from
// Config in main.tsx before the first render, read by the keymap on every key
// And by the help renderers. Defaults apply until (and unless) main registers.
let active: KeybindingSet = defaultKeybindings();

export const registerKeybindings = (set: KeybindingSet) => {
  active = set;
};

export const combosFor = (id: KeyActionId): Combo[] =>
  active.combos.get(id) ?? [];

export const comboTextsFor = (id: KeyActionId): string[] =>
  active.texts.get(id) ?? [];
