import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";

import { activeServersForPath, resolveServers } from "@/diagnostics/servers";
import { resolveFileSupportConfig } from "@/file-support/config";
import {
  fileIconForPath,
  fileSupportForPath,
  registerFileSupport,
  restoreFileSupport,
  snapshotFileSupport,
} from "@/file-support/registry";

const serverNames = new Set(Object.keys(resolveServers({}).servers));

function withFileSupport(
  raw: Parameters<typeof resolveFileSupportConfig>[0],
  run: (issues: string[]) => void | Promise<void>,
) {
  const snapshot = snapshotFileSupport();
  const resolved = resolveFileSupportConfig(raw, serverNames);
  registerFileSupport(resolved.registry);
  return Promise.resolve(run(resolved.issues)).finally(() => restoreFileSupport(snapshot));
}

test("file matching resolves exact name, glob, extension, and dotfile specificity", async () => {
  await withFileSupport(
    {
      files: Object.fromEntries([
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
    },
  );
});

test("later user associations win a tie and path globs see repo-relative paths", async () => {
  await withFileSupport(
    {
      files: Object.fromEntries([
        ["first", { extensions: ["probe"], syntax: "json" }],
        ["second", { extensions: ["probe"], syntax: "yaml" }],
        ["source", { globs: ["src/**/*.probe"], syntax: "toml" }],
      ]),
    },
    (issues) => {
      expect(issues).toEqual([]);
      expect(fileSupportForPath("other/a.probe").syntax).toBe("yaml");
      expect(fileSupportForPath("src/nested/a.probe").syntax).toBe("toml");
    },
  );
});

test("false facets block lower matches independently", async () => {
  await withFileSupport(
    {
      files: {
        private: {
          filenames: ["private.ts"],
          icon: false,
          language: false,
          syntax: false,
        },
      },
    },
    (issues) => {
      expect(issues).toEqual([]);
      const support = fileSupportForPath("src/private.ts");
      expect(support.icon).toBe("file");
      expect(support.language).toBeUndefined();
      expect(support.syntax).toBe("text");
    },
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
    },
  );
});

test("built-in extension and glob matching ignores case across facets", async () => {
  await withFileSupport({}, (issues) => {
    expect(issues).toEqual([]);
    // An uppercase extension (a Windows-authored or unconventionally cased file) resolves the same as
    // Lowercase: the icon and the LSP language profile agree, instead of the icon matching while the
    // Profile misses and silently drops diagnostics and code intelligence.
    const tsx = fileSupportForPath("src/Component.TSX");
    expect(tsx.icon).toBe("react");
    expect(tsx.language?.languageId).toBe("typescriptreact");
    // A glob built-in is case-insensitive too: `*.gradle` still resolves groovy syntax.
    expect(fileSupportForPath("build.GRADLE").syntax).toBe("groovy");
  });
});

test("invalid overrides retain built-ins while an invalid reference drops only its facet", async () => {
  await withFileSupport(
    {
      files: {
        "language-typescript": { extensions: [".ts"] },
        "probe": { extensions: ["probe"], icon: "missing", syntax: "json" },
      },
      languages: { typescript: { servers: "typescript" } },
    },
    (issues) => {
      expect(issues).toContain('language "typescript": servers must be an array');
      expect(issues).toContain(
        'file "language-typescript": extensions must be bare suffixes without a leading dot',
      );
      expect(issues).toContain('file "probe": unknown icon "missing"; dropping the icon facet');
      expect(fileSupportForPath("src/a.ts").language?.languageId).toBe("typescript");
      expect(fileSupportForPath("src/a.probe").syntax).toBe("json");
      expect(fileSupportForPath("src/a.probe").icon).toBe("file");
    },
  );
});

test("language entries distinguish default gates, unconditional servers, and firstOf", async () => {
  const repo = mkdtempSync(join(tmpdir(), "stet-first-of-"));
  const biomeRepo = mkdtempSync(join(tmpdir(), "stet-first-of-"));
  writeFileSync(join(biomeRepo, "biome.json"), "{}");
  try {
    await withFileSupport(
      {
        files: {
          fallback: { extensions: ["fallback"], language: "fallback" },
          forced: { extensions: ["forced"], language: "forced" },
        },
        languages: {
          fallback: { languageId: "fallback", servers: [{ firstOf: ["biome", "typescript"] }] },
          forced: { languageId: "forced", servers: [{ server: "biome" }] },
        },
      },
      async (issues) => {
        expect(issues).toEqual([]);
        expect(await Effect.runPromise(activeServersForPath("a.fallback", repo))).toEqual([
          "typescript",
        ]);
        expect(await Effect.runPromise(activeServersForPath("a.forced", repo))).toEqual(["biome"]);
        expect(await Effect.runPromise(activeServersForPath("a.fallback", biomeRepo))).toEqual([
          "biome",
        ]);
      },
    );
  } finally {
    rmSync(repo, { force: true, recursive: true });
    rmSync(biomeRepo, { force: true, recursive: true });
  }
});
