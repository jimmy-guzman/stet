export interface CopyReferencePayload {
  path: string;
  line?: number;
  column?: number;
}

export function formatCopyReference(payload: CopyReferencePayload) {
  if (payload.line === undefined) {
    return payload.path;
  }
  if (payload.column === undefined) {
    return `${payload.path}:${payload.line}`;
  }

  return `${payload.path}:${payload.line}:${payload.column}`;
}

const LINUX_CLIPBOARD_COMMANDS = [
  ["wl-copy"],
  ["xclip", "-selection", "clipboard"],
  ["xsel", "--clipboard", "--input"],
];

export function clipboardCommand() {
  if (process.platform === "darwin") {
    return ["pbcopy"];
  }

  return LINUX_CLIPBOARD_COMMANDS.find((command) => Bun.which(command[0] ?? "") !== null);
}
