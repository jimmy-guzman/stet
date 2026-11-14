import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import path from "node:path";

import { configPaths } from "@/config/paths";

describe("configPaths", () => {
  test("prefers config.jsonc, then config.json, under XDG_CONFIG_HOME", () => {
    expect(configPaths({ XDG_CONFIG_HOME: "/custom/cfg" })).toEqual([
      "/custom/cfg/stet/config.jsonc",
      "/custom/cfg/stet/config.json",
    ]);
  });

  test("falls back to ~/.config when XDG is unset", () => {
    expect(configPaths({})).toEqual([
      path.join(homedir(), ".config", "stet", "config.jsonc"),
      path.join(homedir(), ".config", "stet", "config.json"),
    ]);
  });
});
