import { describe, expect, test } from "bun:test";

import { prefersMonochrome } from "@/theme/mono";

describe("prefersMonochrome", () => {
  test("NO_COLOR unset stays in color", () => {
    expect(prefersMonochrome({})).toBe(false);
  });

  test("NO_COLOR set to an empty string counts as unset", () => {
    expect(prefersMonochrome({ NO_COLOR: "" })).toBe(false);
  });

  test("NO_COLOR=1 goes monochrome", () => {
    expect(prefersMonochrome({ NO_COLOR: "1" })).toBe(true);
  });

  test("NO_COLOR=0 goes monochrome, per no-color.org: any non-empty value counts as set", () => {
    expect(prefersMonochrome({ NO_COLOR: "0" })).toBe(true);
  });

  test("NO_COLOR=false goes monochrome for the same reason", () => {
    expect(prefersMonochrome({ NO_COLOR: "false" })).toBe(true);
  });

  test("FORCE_COLOR=1 stays in color even with NO_COLOR set", () => {
    expect(prefersMonochrome({ FORCE_COLOR: "1", NO_COLOR: "1" })).toBe(false);
  });

  test("FORCE_COLOR alone (no value) stays in color", () => {
    expect(prefersMonochrome({ FORCE_COLOR: "" })).toBe(false);
  });

  test("FORCE_COLOR alone (no value) wins over NO_COLOR=1 too", () => {
    expect(prefersMonochrome({ FORCE_COLOR: "", NO_COLOR: "1" })).toBe(false);
  });

  test("FORCE_COLOR=0 forces monochrome even without NO_COLOR", () => {
    expect(prefersMonochrome({ FORCE_COLOR: "0" })).toBe(true);
  });

  test("FORCE_COLOR=false forces monochrome the same way", () => {
    expect(prefersMonochrome({ FORCE_COLOR: "false" })).toBe(true);
  });

  test("FORCE_COLOR=0 wins even when NO_COLOR would otherwise allow color", () => {
    expect(prefersMonochrome({ FORCE_COLOR: "0", NO_COLOR: "" })).toBe(true);
  });

  test("FORCE_COLOR=1 wins over NO_COLOR=0 too", () => {
    expect(prefersMonochrome({ FORCE_COLOR: "1", NO_COLOR: "0" })).toBe(false);
  });
});
