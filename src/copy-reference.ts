import { runCommand } from "./process"

export interface CopyReferencePayload {
  path: string
  line?: number
  snippet?: string
}

export function formatCopyReference(payload: CopyReferencePayload) {
  if (payload.line === undefined) {
    return payload.path
  }

  const reference = `${payload.path}:${payload.line}`
  if (payload.snippet === undefined || payload.snippet === "") {
    return reference
  }

  return `${reference}\n${payload.snippet}`
}

const LINUX_CLIPBOARD_COMMANDS = [["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"]]

function clipboardCommand() {
  if (process.platform === "darwin") {
    return ["pbcopy"]
  }

  return LINUX_CLIPBOARD_COMMANDS.find((command) => Bun.which(command[0] ?? "") !== null)
}

export function copyToClipboard(text: string) {
  const command = clipboardCommand()
  if (command === undefined) {
    throw new Error("no clipboard tool found; install wl-copy, xclip, or xsel")
  }

  runCommand(command, process.cwd(), [0], text)
}
