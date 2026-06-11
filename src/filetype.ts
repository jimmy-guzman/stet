const supportedFiletypes = new Map([
  [".ts", "typescript"],
  [".tsx", "typescript"],
  [".js", "javascript"],
  [".jsx", "javascript"],
  [".json", "json"],
  [".jsonc", "json"],
  [".yaml", "yaml"],
  [".yml", "yaml"],
  [".md", "markdown"],
  [".mdx", "markdown"],
  [".zig", "zig"],
])

export function supportedFiletypeFor(path: string) {
  const match = path.match(/\.[^.]+$/)
  if (match === null) {
    return undefined
  }

  return supportedFiletypes.get(match[0])
}

export function filetypeFor(path: string) {
  return supportedFiletypeFor(path) ?? "text"
}
