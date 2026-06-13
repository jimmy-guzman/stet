import { Atom } from "effect/unstable/reactivity"
import { contentToContextPatch, loadFileContent } from "../file-view"
import { loadFileDiff } from "../git"
import { renderPatch } from "../patch"
import { gitModelAtom } from "./git"
import { fileViewAtom, fullContentPathsAtom, scopeAtom, selectedPathAtom } from "./ui"

export const selectedFileAtom = Atom.make((get) => {
  const selectedPath = get(selectedPathAtom)
  return selectedPath === undefined ? undefined : get(gitModelAtom).changedByPath.get(selectedPath)
})

export const showFileContentAtom = Atom.make(
  (get) => get(selectedPathAtom) !== undefined && (get(selectedFileAtom) === undefined || get(fileViewAtom)),
)

export const fileContentAtom = Atom.make((get) => {
  const selectedPath = get(selectedPathAtom)
  if (!get(showFileContentAtom) || selectedPath === undefined) {
    return undefined
  }

  const scope = get(scopeAtom)
  const gitSpec =
    get(selectedFileAtom)?.kind === "deleted"
      ? scope.kind === "unstaged"
        ? `:${selectedPath}`
        : `${scope.ref}:${selectedPath}`
      : undefined
  return loadFileContent(get(gitModelAtom).repoRoot, selectedPath, { full: get(fullContentPathsAtom).has(selectedPath), gitSpec })
})

const selectedDiffAtom = Atom.make((get) => {
  const selectedPath = get(selectedPathAtom)
  if (selectedPath === undefined) {
    return ""
  }

  if (get(showFileContentAtom)) {
    const fileContent = get(fileContentAtom)
    return fileContent?.kind === "text" ? contentToContextPatch(selectedPath, fileContent.content) : ""
  }

  const selectedFile = get(selectedFileAtom)
  return selectedFile === undefined ? "" : loadFileDiff(get(gitModelAtom).repoRoot, get(scopeAtom), selectedFile)
})

export const renderedPatchAtom = Atom.make((get) => {
  const selectedPath = get(selectedPathAtom)
  return renderPatch(get(selectedDiffAtom), {
    full: get(showFileContentAtom) || (selectedPath !== undefined && get(fullContentPathsAtom).has(selectedPath)),
    maxLines: 1600,
  })
})

export const navigableLinesAtom = Atom.make((get) => {
  const renderedPatch = get(renderedPatchAtom)
  return renderedPatch.parsed.hunks.flatMap((hunk) => hunk.lines).slice(0, renderedPatch.bodyLineCount)
})

export const truncatedAtom = Atom.make((get) => {
  const fileContent = get(fileContentAtom)
  return get(renderedPatchAtom).truncated || (fileContent?.kind === "text" && fileContent.truncated)
})
