import { Context, Effect, Layer } from "effect"
import type { DiffScope } from "../cli"
import {
  listWorktrees,
  loadChangedFiles,
  loadFileDiff,
  loadGitModel,
  loadRepoFiles,
  type ChangedFile,
  type GitModel,
  type Worktree,
} from "../git"
import { GitError } from "./errors"

function toGitError(error: unknown) {
  return new GitError({ message: error instanceof Error ? error.message : String(error) })
}

export class Git extends Context.Service<
  Git,
  {
    readonly changedFiles: (
      repoRoot: string,
      scope: DiffScope,
    ) => Effect.Effect<Pick<GitModel, "changed" | "changedByPath" | "scopeKey">, GitError>
    readonly fileDiff: (repoRoot: string, scope: DiffScope, file: ChangedFile) => Effect.Effect<string, GitError>
    readonly loadModel: (repoRoot: string, scope: DiffScope) => Effect.Effect<GitModel, GitError>
    readonly repoFiles: (repoRoot: string) => Effect.Effect<Pick<GitModel, "repoFiles" | "repoFilesKey">, GitError>
    readonly worktrees: (repoRoot: string) => Effect.Effect<Worktree[], GitError>
  }
>()("sideye/Git") {}

export const GitLive = Layer.succeed(Git)({
  changedFiles: (repoRoot, scope) => Effect.tryPromise({ catch: toGitError, try: () => loadChangedFiles(repoRoot, scope) }),
  fileDiff: (repoRoot, scope, file) => Effect.try({ catch: toGitError, try: () => loadFileDiff(repoRoot, scope, file) }),
  loadModel: (repoRoot, scope) => Effect.tryPromise({ catch: toGitError, try: () => loadGitModel(repoRoot, scope) }),
  repoFiles: (repoRoot) => Effect.tryPromise({ catch: toGitError, try: () => loadRepoFiles(repoRoot) }),
  worktrees: (repoRoot) => Effect.tryPromise({ catch: toGitError, try: () => listWorktrees(repoRoot) }),
})
