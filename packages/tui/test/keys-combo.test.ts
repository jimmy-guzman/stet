import { describe, expect, test } from "bun:test";

import { matchesKey, parseCombo } from "@/keys/combo";

describe("parseCombo", () => {
  test("a bare letter, a symbol, and a special key", () => {
    expect(parseCombo("g")).toEqual({ ctrl: false, name: "g", shift: false });
    expect(parseCombo("?")).toEqual({ ctrl: false, name: "?", shift: false });
    expect(parseCombo("f12")).toEqual({ ctrl: false, name: "f12", shift: false });
    expect(parseCombo("tab")).toEqual({ ctrl: false, name: "tab", shift: false });
  });

  test("an uppercase letter is shorthand for shift", () => {
    expect(parseCombo("G")).toEqual({ ctrl: false, name: "g", shift: true });
    expect(parseCombo("shift+g")).toEqual({ ctrl: false, name: "g", shift: true });
  });

  test("modifiers join with + or -, any case", () => {
    expect(parseCombo("ctrl+b")).toEqual({ ctrl: true, name: "b", shift: false });
    expect(parseCombo("ctrl-b")).toEqual({ ctrl: true, name: "b", shift: false });
    expect(parseCombo("Shift+F12")).toEqual({ ctrl: false, name: "f12", shift: true });
    expect(parseCombo("ctrl+shift+f12")).toEqual({ ctrl: true, name: "f12", shift: true });
  });

  test("arrow glyphs and aliases map to key names", () => {
    expect(parseCombo("Shift+↑")).toEqual({ ctrl: false, name: "up", shift: true });
    expect(parseCombo("↓")).toEqual({ ctrl: false, name: "down", shift: false });
    expect(parseCombo("enter")).toEqual({ ctrl: false, name: "return", shift: false });
    expect(parseCombo("esc")).toEqual({ ctrl: false, name: "escape", shift: false });
  });

  test("rejects what the grammar does not accept", () => {
    expect(parseCombo("")).toBeUndefined();
    expect(parseCombo("ctrl+")).toBeUndefined();
    expect(parseCombo("shift+?")).toBeUndefined();
    expect(parseCombo("meta+x")).toBeUndefined();
    expect(parseCombo("not a key")).toBeUndefined();
  });
});

describe("matchesKey", () => {
  const combo = (text: string) => {
    const parsed = parseCombo(text);
    if (parsed === undefined) {
      throw new Error(`combo "${text}" did not parse`);
    }
    return parsed;
  };

  test("both terminal shapes of a shifted letter hit the same combo", () => {
    expect(matchesKey({ ctrl: false, name: "G", shift: false }, combo("G"))).toBe(true);
    expect(matchesKey({ ctrl: false, name: "g", shift: true }, combo("G"))).toBe(true);
    expect(matchesKey({ ctrl: false, name: "g", shift: false }, combo("G"))).toBe(false);
  });

  test("modifiers match exactly, so a bare combo never fires on a chord", () => {
    expect(matchesKey({ ctrl: true, name: "s", shift: false }, combo("s"))).toBe(false);
    expect(matchesKey({ ctrl: false, name: "s", shift: true }, combo("s"))).toBe(false);
    expect(matchesKey({ ctrl: true, name: "s", shift: false }, combo("ctrl+s"))).toBe(true);
  });

  test("a symbol matches whether or not the terminal reports shift", () => {
    expect(matchesKey({ ctrl: false, name: "?", shift: true }, combo("?"))).toBe(true);
    expect(matchesKey({ ctrl: false, name: "?", shift: false }, combo("?"))).toBe(true);
  });

  test("special keys carry their shift flag", () => {
    expect(matchesKey({ ctrl: false, name: "f12", shift: true }, combo("Shift+F12"))).toBe(true);
    expect(matchesKey({ ctrl: false, name: "f12", shift: false }, combo("Shift+F12"))).toBe(false);
    expect(matchesKey({ ctrl: false, name: "f12", shift: true }, combo("F12"))).toBe(false);
  });
});
