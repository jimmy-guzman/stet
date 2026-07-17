import type { KeyActionId } from "./actions";
import type { Combo } from "./combo";
import { defaultKeybindings } from "./resolve";
import type { KeybindingSet } from "./resolve";

// Process-global like the theme and file-support registries: resolved once from
// Config in main.tsx before the first render, read by the keymap on every key
// And by the help renderers. Defaults apply until (and unless) main registers.
let active: KeybindingSet = defaultKeybindings();

export function registerKeybindings(set: KeybindingSet) {
  active = set;
}

export function combosFor(id: KeyActionId): Combo[] {
  return active.combos.get(id) ?? [];
}

export function comboTextsFor(id: KeyActionId): string[] {
  return active.texts.get(id) ?? [];
}

// Test-only: a test that registers bindings would leak them into later tests.
export function snapshotKeybindings() {
  return active;
}

export function restoreKeybindings(snapshot: KeybindingSet) {
  active = snapshot;
}
