import { createFileTreeIconResolver } from "@pierre/trees";

import { fileNameParts } from "@/utils/file-name";

const { resolveIcon } = createFileTreeIconResolver("complete");

// Trees owns filename matching. These aliases choose terminal glyph and color families.
const terminalIcons = new Map<string, string>([
  ["babel", "javascript"],
  ["bash", "shell"],
  ["biome", "config"],
  ["bootstrap", "css"],
  ["browserslist", "config"],
  ["claude", "document"],
  ["default", "file"],
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

const fallbackIcon = (path: string) => {
  const { basename, extension } = fileNameParts(path);

  const icon =
    extension === undefined
      ? undefined
      : fallbackExtensions.get(extension.toLowerCase());

  if (icon !== undefined) {
    return icon;
  }

  return basename.startsWith(".") ? "config" : "file";
};

export const defaultIconForPath = (path: string) => {
  const { token } = resolveIcon("file-tree-icon-file", path);

  return token === undefined || token === "default"
    ? fallbackIcon(path)
    : (terminalIcons.get(token) ?? token);
};
