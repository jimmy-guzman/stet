import { createFileTreeIconResolver } from "@pierre/trees";

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
  ["npm", "node"],
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

export const defaultIconForPath = (path: string) => {
  const { token } = resolveIcon("file-tree-icon-file", path);

  return token === undefined ? "file" : (terminalIcons.get(token) ?? token);
};
