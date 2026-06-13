import { Atom } from "effect/unstable/reactivity"

export const changesOnlyAtom = Atom.make(false)
export const selectedPathAtom = Atom.make<string | undefined>(undefined)
export const expandedDirectoriesAtom = Atom.make(new Set<string>())
export const fileViewAtom = Atom.make(false)
// The id of the tree node under the cursor (a file or directory). focusedRowIndex
// Derives from this, so cursor position and selection can never desync.
export const focusedNodeIdAtom = Atom.make("")
