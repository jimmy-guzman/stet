export type CopyReferencePayload = {
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

export function copyToClipboard(text: string) {
  const process = Bun.spawnSync({
    cmd: ["/usr/bin/pbcopy"],
    stdin: new Blob([text]),
    stdout: "pipe",
    stderr: "pipe",
  })

  if (process.exitCode !== 0) {
    const stderr = new TextDecoder().decode(process.stderr)
    throw new Error(stderr.trim() === "" ? "pbcopy failed" : stderr.trim())
  }
}
