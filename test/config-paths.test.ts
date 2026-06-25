import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";

import { configPath } from "../src/config/paths";

describe("configPath", () => {
  test("uses XDG_CONFIG_HOME when set", () => {
    expect(configPath({ XDG_CONFIG_HOME: "/custom/cfg" })).toBe("/custom/cfg/sideye/config.json");
  });

  test("falls back to ~/.config when XDG is unset", () => {
    expect(configPath({})).toBe(join(homedir(), ".config", "sideye", "config.json"));
  });
});
