import { describe, expect, test } from "bun:test";

import { fileNameParts } from "@/utils/file-name";

describe("fileNameParts", () => {
  test("splits the basename from a Git path without reading dots in directories", () => {
    expect(fileNameParts("src/v1.2/main.ts")).toEqual({
      basename: "main.ts",
      extension: "ts",
    });
  });

  test("treats a bare leading-dot basename as extensionless", () => {
    expect(fileNameParts("config/.npmrc")).toEqual({
      basename: ".npmrc",
      extension: undefined,
    });
  });

  test("keeps a later dot as the extension boundary", () => {
    expect(fileNameParts(".prettierrc.json")).toEqual({
      basename: ".prettierrc.json",
      extension: "json",
    });
    expect(fileNameParts("name.")).toEqual({
      basename: "name.",
      extension: "",
    });
  });

  test("uses POSIX separators and preserves case", () => {
    expect(fileNameParts(String.raw`Dir\Literal.TS`)).toEqual({
      basename: String.raw`Dir\Literal.TS`,
      extension: "TS",
    });
  });
});
