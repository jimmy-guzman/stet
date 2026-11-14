import { expect, test } from "bun:test";

import type { Schema } from "effect";

import { resolveFileSupportConfig } from "@/file-support/config";
import {
  fileIconForPath,
  fileSupportForPath,
  registerFileSupport,
} from "@/file-support/registry";

const withFileSupport = async (
  raw: Parameters<typeof resolveFileSupportConfig>[0],
  run: (issues: string[]) => void | Promise<void>
) => {
  const resolved = resolveFileSupportConfig(raw);
  registerFileSupport(resolved.registry);
  await run(resolved.issues);
};

test("file matching resolves exact name, glob, extension, and dotfile specificity", async () => {
  await withFileSupport(
    {
      files: Object.fromEntries<Schema.Json>([
        ["extension", { extensions: ["probe"], syntax: "json" }],
        ["glob", { globs: ["special.*"], syntax: "yaml" }],
        ["exact", { filenames: ["special.probe"], syntax: "toml" }],
        ["dotfile", { dotfiles: true, syntax: "ini" }],
      ]),
    },
    (issues) => {
      expect(issues).toEqual([]);
      expect(fileSupportForPath("nested/special.probe").syntax).toBe("toml");
      expect(fileSupportForPath("nested/other.probe").syntax).toBe("json");
      expect(fileSupportForPath("nested/.unknown").syntax).toBe("ini");
    }
  );
});

test("later user associations win a tie and path globs see repo-relative paths", async () => {
  await withFileSupport(
    {
      files: Object.fromEntries<Schema.Json>([
        ["first", { extensions: ["probe"], syntax: "json" }],
        ["second", { extensions: ["probe"], syntax: "yaml" }],
        ["source", { globs: ["src/**/*.probe"], syntax: "toml" }],
      ]),
    },
    (issues) => {
      expect(issues).toEqual([]);
      expect(fileSupportForPath("other/a.probe").syntax).toBe("yaml");
      expect(fileSupportForPath("src/nested/a.probe").syntax).toBe("toml");
    }
  );
});

test("false facets block lower matches independently", async () => {
  await withFileSupport(
    {
      files: {
        private: {
          filenames: ["private.ts"],
          icon: false,
          syntax: false,
        },
      },
    },
    (issues) => {
      expect(issues).toEqual([]);
      const support = fileSupportForPath("src/private.ts");
      expect(support.icon).toBe("file");
      expect(support.syntax).toBe("text");
    }
  );
});

test("disabling a named icon falls back to the generic icon model", async () => {
  await withFileSupport({ icons: { typescript: false } }, (issues) => {
    expect(issues).toEqual([]);
    expect(fileIconForPath("src/a.ts").name).toBe("file");
  });
});

test("matching is case-insensitive by default and may opt into case sensitivity", async () => {
  await withFileSupport(
    {
      files: {
        insensitive: { extensions: ["low"], syntax: "json" },
        sensitive: { caseSensitive: true, extensions: ["UP"], syntax: "yaml" },
      },
    },
    (issues) => {
      expect(issues).toEqual([]);
      expect(fileSupportForPath("a.UP").syntax).toBe("yaml");
      expect(fileSupportForPath("a.up").syntax).not.toBe("yaml");
      expect(fileSupportForPath("a.LOW").syntax).toBe("json");
      expect(fileSupportForPath("a.low").syntax).toBe("json");
    }
  );
});

test("built-in extension and glob matching ignores case across facets", async () => {
  await withFileSupport({}, (issues) => {
    expect(issues).toEqual([]);
    // An uppercase extension (a Windows-authored or unconventionally cased file) resolves the same as
    // Lowercase.
    expect(fileSupportForPath("src/Component.TSX").icon).toBe("react");
    // A Vue single-file component resolves both facets: the vue icon, and the vue grammar through
    // Filename inference (no syntax association is needed for it).
    const vue = fileSupportForPath("src/App.vue");
    expect(vue.icon).toBe("vue");
    expect(vue.syntax).toBe("vue");
    // A glob built-in is case-insensitive too: `*.gradle` still resolves groovy syntax.
    expect(fileSupportForPath("build.GRADLE").syntax).toBe("groovy");
  });
});

test("invalid overrides retain built-ins while an invalid reference drops only its facet", async () => {
  await withFileSupport(
    {
      files: {
        "icon-typescript": { extensions: [".ts"] },
        probe: { extensions: ["probe"], icon: "missing", syntax: "json" },
      },
    },
    (issues) => {
      expect(issues).toContain(
        'file "icon-typescript": extensions must be bare suffixes without a leading dot'
      );
      expect(issues).toContain(
        'file "probe": unknown icon "missing"; dropping the icon facet'
      );
      expect(fileSupportForPath("src/a.ts").icon).toBe("typescript");
      expect(fileSupportForPath("src/a.probe").syntax).toBe("json");
      expect(fileSupportForPath("src/a.probe").icon).toBe("file");
    }
  );
});

test("an unknown field drops the whole entry", async () => {
  await withFileSupport(
    {
      files: {
        probe: {
          colour: "red",
          extensions: ["probe"],
          icon: "json",
          syntax: "yaml",
        },
      },
    },
    (issues) => {
      expect(issues).toEqual(['file "probe": unknown field "colour"']);
      expect(fileSupportForPath("a.probe").syntax).toBe("text");
      expect(fileSupportForPath("a.probe").icon).toBe("file");
    }
  );
});
