import { Atom } from "effect/unstable/reactivity"
import type { GitModel } from "../git"

// Placeholder until App seeds the real initial model (synchronously, before the
// First read), so derived atoms never have to guard an undefined model.
const emptyModel: GitModel = {
  changed: [],
  changedByPath: new Map(),
  repoFiles: [],
  repoFilesKey: "",
  repoRoot: "",
  scopeKey: "",
}

export const gitModelAtom = Atom.make(emptyModel)
