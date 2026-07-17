import { describe, expect, test } from "bun:test";

import { keyActions } from "@/keys/actions";
import { parseCombo } from "@/keys/combo";
import { defaultKeybindings, resolveKeybindings } from "@/keys/resolve";

describe("the action registry", () => {
  test("every default combo parses", () => {
    for (const action of keyActions) {
      for (const text of action.combos) {
        expect(parseCombo(text), `${action.id}: "${text}"`).toBeDefined();
      }
    }
  });

  test("action ids are unique", () => {
    const ids = keyActions.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("the defaults are conflict-free", () => {
    expect(resolveKeybindings({}).issues).toEqual([]);
  });
});

describe("resolveKeybindings", () => {
  test("an override replaces the default; other actions keep theirs", () => {
    const { issues, set } = resolveKeybindings({ "toggle-sidebar": "ctrl+e" });

    expect(issues).toEqual([]);
    expect(set.combos.get("toggle-sidebar")).toEqual([{ ctrl: true, name: "e", shift: false }]);
    expect(set.texts.get("toggle-sidebar")).toEqual(["ctrl+e"]);
    expect(set.texts.get("help")).toEqual(["?"]);
  });

  test("a list binds several combos to one action", () => {
    const { issues, set } = resolveKeybindings({ "cursor-down": ["j", "m"] });

    expect(issues).toEqual([]);
    expect(set.combos.get("cursor-down")).toHaveLength(2);
  });

  test("false unbinds an action", () => {
    const { issues, set } = resolveKeybindings({ provenance: false });

    expect(issues).toEqual([]);
    expect(set.combos.get("provenance")).toEqual([]);
    expect(set.texts.get("provenance")).toEqual([]);
  });

  test("an unknown action id is reported and skipped", () => {
    const { issues, set } = resolveKeybindings({ "toggle-sidbar": "ctrl+e" });

    expect(issues).toEqual(['keybinding "toggle-sidbar": unknown action']);
    expect(set.texts.get("toggle-sidebar")).toEqual(["ctrl-b"]);
  });

  test("an invalid combo is reported and the default retained", () => {
    const { issues, set } = resolveKeybindings({ "toggle-sidebar": "meta+e" });

    expect(issues).toEqual(['keybinding "toggle-sidebar": invalid combo "meta+e"']);
    expect(set.texts.get("toggle-sidebar")).toEqual(["ctrl-b"]);
  });

  test("a wrong-typed value is reported and the default retained", () => {
    const { issues, set } = resolveKeybindings({ "toggle-sidebar": 3 });

    expect(issues).toEqual([
      'keybinding "toggle-sidebar": must be a combo, a list of combos, or false',
    ]);
    expect(set.texts.get("toggle-sidebar")).toEqual(["ctrl-b"]);
  });

  test("rebinding onto a taken combo reports the conflict and names the winner", () => {
    const { issues } = resolveKeybindings({ "toggle-sidebar": "t" });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('"toggle-sidebar"');
    expect(issues[0]).toContain('"theme"');
    expect(issues[0]).toContain("the earlier binding wins");
  });

  test("a global rebind that shadows a pane binding is a conflict", () => {
    const { issues } = resolveKeybindings({ "changes-only": "z" });

    // The global section dispatches before the viewer tail, so the viewer's
    // Fold binding on z becomes unreachable.
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('"fold"');
  });

  test("the same combo in two different panes is not a conflict", () => {
    // The j key moves in the viewer, the tree, and the problems panel by
    // Default; sharing it across disjoint panes is the norm, not a clash.
    expect(resolveKeybindings({}).issues).toEqual([]);
  });

  test("defaultKeybindings carries every action", () => {
    const defaults = defaultKeybindings();

    for (const action of keyActions) {
      expect(defaults.combos.get(action.id)?.length).toBeGreaterThan(0);
    }
  });
});
