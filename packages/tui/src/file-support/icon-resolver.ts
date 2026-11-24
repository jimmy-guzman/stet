import { createFileTreeIconResolver } from "@pierre/trees";

import { fileNameParts } from "@/utils/file-name";

const { resolveIcon } = createFileTreeIconResolver("complete");

// These aliases choose terminal glyph and color families for Trees' tokens.
const terminalIcons = new Map<string, string>([
  ["babel", "javascript"],
  ["bash", "shell"],
  ["biome", "config"],
  ["bootstrap", "css"],
  ["browserslist", "config"],
  ["claude", "document"],
  ["eslint", "config"],
  ["mcp", "config"],
  ["nextjs", "react"],
  ["oxc", "config"],
  ["postcss", "css"],
  ["prettier", "config"],
  ["stylelint", "css"],
  ["svg", "image"],
  ["svgo", "image"],
  ["table", "spreadsheet"],
  ["tailwind", "css"],
  ["terraform", "config"],
  ["text", "document"],
  ["vite", "javascript"],
  ["vscode", "config"],
  ["webpack", "javascript"],
  ["yml", "yaml"],
  ["zip", "archive"],
]);

// Consulted only when Trees has no token, so `bun.lock` and `bunfig.toml` keep Trees' `bun`.
const fallbackExtensions = new Map<string, string>([
  ["avi", "video"],
  ["class", "java"],
  ["cpuprofile", "profile"],
  ["gradle", "gradle"],
  ["groovy", "groovy"],
  ["gvy", "groovy"],
  ["http", "http"],
  ["java", "java"],
  ["kt", "kotlin"],
  ["kts", "kotlin"],
  ["lock", "lock"],
  ["mako", "template"],
  ["mkv", "video"],
  ["mov", "video"],
  ["mp4", "video"],
  ["pdf", "pdf"],
  ["sc", "scala"],
  ["scala", "scala"],
  ["toml", "toml"],
  ["webm", "video"],
]);

// Readme and license names are documents only when Trees reads them as one. No filename glob
// told `LICENSE-2.0` from `license-2.ts` or `README.zh-CN.md` from `Readme.tsx` without missing
// a shape, while Trees already gives code a language token and a document one of these two, or
// none. With no token, a fallback extension wins first, so `License.java` stays Java.
const documentTokens = new Set(["markdown", "text"]);

const documentPrefixes = new Map([
  ["cc-by", "license"],
  ["cc0", "license"],
  ["copying", "license"],
  ["licence", "license"],
  ["license", "license"],
  ["readme", "readme"],
]);

// A prefix is a whole word, optionally numbered: `LICENSE-MIT`, `COPYING.LESSER`, and GCC's
// `COPYING3` match, `readmeta.txt` does not.
const afterPrefix = /^(?:[-._\d]|$)/u;

const licenseNames = new Set([
  "agpl-3.0",
  "apache-2.0",
  "bsd-2-clause",
  "bsd-3-clause",
  "gpl-2.0",
  "gpl-3.0",
  "isc",
  "lgpl-3.0",
  "mit",
  "mpl-2.0",
  "notice",
  "unlicense",
]);

const documentIcon = (path: string) => {
  const name = fileNameParts(path).basename.toLowerCase();

  // `NOTICE.txt` and `gpl-3.0.txt` are the same documents as `NOTICE` and `gpl-3.0`.
  if (
    licenseNames.has(name) ||
    licenseNames.has(name.replace(/\.[^.]+$/u, ""))
  ) {
    return "license";
  }

  return documentPrefixes
    .entries()
    .find(
      ([prefix]) =>
        name.startsWith(prefix) && afterPrefix.test(name.slice(prefix.length))
    )?.[1];
};

const fallbackExtension = (path: string) => {
  const { extension } = fileNameParts(path);

  return extension === undefined
    ? undefined
    : fallbackExtensions.get(extension.toLowerCase());
};

const unknownIcon = (path: string) =>
  fileNameParts(path).basename.startsWith(".") ? "config" : "file";

export const defaultIconForPath = (path: string) => {
  const { token } = resolveIcon("file-tree-icon-file", path);

  if (token === undefined || token === "default") {
    return fallbackExtension(path) ?? documentIcon(path) ?? unknownIcon(path);
  }

  return (
    (documentTokens.has(token) ? documentIcon(path) : undefined) ??
    terminalIcons.get(token) ??
    token
  );
};
