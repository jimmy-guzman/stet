import { keyActions } from "./actions";
import type { KeyActionId, KeyContext } from "./actions";
import { parseCombo } from "./combo";
import type { Combo } from "./combo";

/**
 * The resolved bindings the keymap and the help read: parsed combos for matching, the original
 * texts for display. Both maps carry every action id.
 */
export interface KeybindingSet {
  combos: Map<KeyActionId, Combo[]>;
  texts: Map<KeyActionId, string[]>;
}

export function defaultKeybindings(): KeybindingSet {
  const combos = new Map<KeyActionId, Combo[]>();
  const texts = new Map<KeyActionId, string[]>();
  for (const action of keyActions) {
    combos.set(
      action.id,
      action.combos.map(parseCombo).filter((combo): combo is Combo => combo !== undefined),
    );
    texts.set(action.id, [...action.combos]);
  }
  return { combos, texts };
}

export interface ResolvedKeybindings {
  issues: string[];
  set: KeybindingSet;
}

const contextById = new Map<string, KeyContext>(
  keyActions.map((action) => [action.id, action.context]),
);

function isKeyActionId(id: string): id is KeyActionId {
  return contextById.has(id);
}

/**
 * Merge `config.keybindings` over the defaults, the registry-resolver way: an unknown action id or
 * an unparseable combo reports an issue and leaves the default in place, and `false` (or an empty
 * list) unbinds the action. A combo bound twice in one context, or in `global` and any pane (the
 * global section dispatches first, so the pane binding would be unreachable), is reported as a
 * conflict but left as merged: the chain's order decides, and the issue says so.
 */
export function resolveKeybindings(raw: Record<string, unknown>): ResolvedKeybindings {
  const issues: string[] = [];
  const set = defaultKeybindings();

  for (const [id, value] of Object.entries(raw)) {
    if (!isKeyActionId(id)) {
      issues.push(`keybinding "${id}": unknown action`);
      continue;
    }
    if (value === false) {
      set.combos.set(id, []);
      set.texts.set(id, []);
      continue;
    }
    const entries = typeof value === "string" ? [value] : value;
    if (!Array.isArray(entries) || entries.some((text) => typeof text !== "string")) {
      issues.push(`keybinding "${id}": must be a combo, a list of combos, or false`);
      continue;
    }
    const texts = entries.filter((text): text is string => typeof text === "string");
    const parsed = texts.map((text) => ({ combo: parseCombo(text), text }));
    const bad = parsed.find((entry) => entry.combo === undefined);
    if (bad !== undefined) {
      issues.push(`keybinding "${id}": invalid combo "${bad.text}"`);
      continue;
    }
    set.combos.set(
      id,
      parsed.map((entry) => entry.combo).filter((combo): combo is Combo => combo !== undefined),
    );
    set.texts.set(id, texts);
  }

  // A global action can fire whatever pane is focused, so it claims a combo in
  // Every scope; a pane action claims only its own. Two claims on one scope are
  // A conflict, reported once per action pair; the merged bindings stand, and
  // The chain's order (globals before pane tails) decides which fires.
  const claims = new Map<string, KeyActionId>();
  const reported = new Set<string>();
  for (const action of keyActions) {
    const scopes: KeyContext[] =
      action.context === "global" ? ["global", "problems", "tree", "viewer"] : [action.context];
    for (const combo of set.combos.get(action.id) ?? []) {
      for (const scope of scopes) {
        const signature = `${scope}:${combo.ctrl}:${combo.shift}:${combo.name}`;
        const holder = claims.get(signature);
        if (holder === undefined) {
          claims.set(signature, action.id);
        } else if (holder !== action.id && !reported.has(`${holder}:${action.id}`)) {
          reported.add(`${holder}:${action.id}`);
          issues.push(
            `keybinding "${action.id}" (${set.texts.get(action.id)?.join(", ") ?? ""}) conflicts with "${holder}"; the earlier binding wins`,
          );
        }
      }
    }
  }

  return { issues, set };
}
