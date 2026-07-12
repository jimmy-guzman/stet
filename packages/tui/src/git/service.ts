import { Context, Effect, Layer, Schedule } from "effect";

import type { DiffScope } from "@/cli";
import { Process } from "@/process";
import type { CommandError } from "@/process";

import { blameArgs, blameContentsArgs, parseBlamePorcelain } from "./blame";
import type { BlameLine } from "./blame";
import { GitError } from "./errors";
import {
  buildFilePatch,
  classifySideBytes,
  fileDiffSides,
  readWorktreeSide,
  sideMeta,
} from "./file-patch";
import type { BinaryDiff, FilePatch, PatchSide, SideContent } from "./file-patch";
import { logArgs, parseLog } from "./log";
import type { Commit } from "./log";
import {
  assembleChanged,
  assembleModel,
  diffArgs,
  EMPTY_TREE_SHA,
  nameStatusArgs,
  numstatArgs,
  parseRepoFiles,
  untrackedDiffArgs,
} from "./model";
import type { ChangedFile, GitModel } from "./model";
import {
  commitsSinceArgs,
  defaultBranchArgs,
  firstCommitArgs,
  mergeBaseArgs,
  parseFirstCommit,
  parseRevList,
} from "./provenance";
import { parseSearchOutput, searchArgs } from "./search";
import type { SearchMatch, SearchOptions } from "./search";
import {
  commitTimeArgs,
  parseCommitTimes,
  parseWorktreeList,
  summarizeWorktree,
  worktreeStatusArgs,
} from "./worktree";
import type { Worktree, WorktreeSummary } from "./worktree";

function toGitError(error: CommandError) {
  return new GitError({ message: error.message });
}

function isTransientGit(error: CommandError) {
  // An index.lock (an agent mid-commit) clears on a quick retry
  return /index\.lock|unable to create/i.test(error.stderr);
}

function retryTransient<A>(effect: Effect.Effect<A, CommandError>) {
  return effect.pipe(
    Effect.retry({ schedule: Schedule.spaced("50 millis"), times: 2, while: isTransientGit }),
  );
}

export class Git extends Context.Service<
  Git,
  {
    /**
     * Both sides' size and image dimensions for a binary changed file, so the viewer can render a
     * metadata placeholder in place of the diff stet cannot draw. Reuses the same side reads as
     * `fileDiff`; a side is absent when it is the empty side of an add or delete.
     */
    readonly binaryMeta: (
      repoRoot: string,
      scope: DiffScope,
      file: ChangedFile,
    ) => Effect.Effect<BinaryDiff, GitError>;
    /**
     * Per-line git blame of the diff's right `side` (a revision, or the index via `--contents`), or
     * the working tree when the side is omitted/worktree; empty for a path git can't blame.
     */
    readonly blame: (
      repoRoot: string,
      path: string,
      side?: PatchSide,
    ) => Effect.Effect<BlameLine[], GitError>;
    /**
     * Merge-base of HEAD with the default branch (where this branch left it); undefined when none
     * resolves.
     */
    readonly branchBase: (repoRoot: string) => Effect.Effect<string | undefined, GitError>;
    readonly changedFiles: (
      repoRoot: string,
      scope: DiffScope,
    ) => Effect.Effect<
      Pick<GitModel, "changed" | "changedByPath" | "scopeKey" | "branch">,
      GitError
    >;
    /** Commit SHAs reachable from HEAD but not `base`, i.e. everything committed this session. */
    readonly commitsSince: (repoRoot: string, base: string) => Effect.Effect<Set<string>, GitError>;
    readonly fileDiff: (
      repoRoot: string,
      scope: DiffScope,
      file: ChangedFile,
    ) => Effect.Effect<string, GitError>;
    /** The commit that introduced the file, or undefined when it can't be resolved. */
    readonly fileFirstCommit: (
      repoRoot: string,
      path: string,
    ) => Effect.Effect<string | undefined, GitError>;
    /**
     * The full text of the side an expanded gap reveals (the new side, or the old side for a
     * deletion). Loaded lazily on the first gap expansion in a file, never on the diff hot path.
     */
    readonly fileSource: (
      repoRoot: string,
      scope: DiffScope,
      file: ChangedFile,
    ) => Effect.Effect<SideContent, GitError>;
    readonly gitDir: (repoRoot: string) => Effect.Effect<string, GitError>;
    /** The SHA HEAD points at, or the empty tree on a commitless repo. */
    readonly headRef: (repoRoot: string) => Effect.Effect<string, GitError>;
    readonly loadModel: (repoRoot: string, scope: DiffScope) => Effect.Effect<GitModel, GitError>;
    /** HEAD's parent SHA, or the empty tree on a root commit. */
    readonly parentRef: (repoRoot: string) => Effect.Effect<string, GitError>;
    /** The most recent commits (newest first), capped at `limit`. */
    readonly recentCommits: (repoRoot: string, limit: number) => Effect.Effect<Commit[], GitError>;
    readonly repoFiles: (
      repoRoot: string,
    ) => Effect.Effect<Pick<GitModel, "repoFiles" | "repoFilesKey">, GitError>;
    readonly search: (
      repoRoot: string,
      query: string,
      paths: readonly string[] | undefined,
      options: SearchOptions,
    ) => Effect.Effect<SearchMatch[], GitError>;
    readonly worktrees: (repoRoot: string) => Effect.Effect<Worktree[], GitError>;
    /**
     * When each of the given worktrees was last touched, by an agent or by git. A worktree that
     * cannot be read (a pruned one whose directory is gone) is omitted rather than failing the
     * batch, so one dead worktree never costs the caller the live ones.
     */
    readonly worktreeSummaries: (
      worktrees: readonly Worktree[],
      repoRoot: string,
    ) => Effect.Effect<WorktreeSummary[]>;
  }
>()("stet/Git") {}

export const GitLive = Layer.effect(
  Git,
  Effect.gen(function* gitLive() {
    const process = yield* Process;

    // No retryTransient on `git show`: a bad spec (submodule gitlink, ref gone
    // Mid-flight) should fail fast into the fallback, not retry.
    const fetchSide = (
      repoRoot: string,
      side: PatchSide,
      worktreePath: string,
    ): Effect.Effect<SideContent, CommandError> => {
      if (side.kind === "git") {
        return process
          .run(["git", "show", side.spec], repoRoot)
          .pipe(Effect.map((result) => classifySideBytes(result.stdoutBytes)));
      }
      if (side.kind === "worktree") {
        return Effect.promise(() => readWorktreeSide(repoRoot, worktreePath));
      }
      return Effect.succeed({ kind: "text", text: "" });
    };

    return {
      binaryMeta: (repoRoot, scope, file) => {
        const { newSide, oldSide } = fileDiffSides(scope, file);
        return Effect.all(
          [fetchSide(repoRoot, oldSide, file.path), fetchSide(repoRoot, newSide, file.path)],
          { concurrency: "unbounded" },
        ).pipe(
          Effect.map(([oldContent, newContent]) => ({
            newSide: sideMeta(newContent),
            oldSide: sideMeta(oldContent),
          })),
          Effect.mapError(toGitError),
        );
      },
      blame: (repoRoot, path, side) => {
        // Exit 128 is an unblameable path (untracked); the model already treats those as wholly
        // Uncommitted, so parse its empty stdout to an empty list rather than fail the load.
        const parsed = (args: readonly string[], stdin?: string) =>
          process
            .run(args, repoRoot, {
              allowedExitCodes: [0, 128],
              ...(stdin === undefined ? {} : { stdin }),
            })
            .pipe(
              retryTransient,
              Effect.map((result) => parseBlamePorcelain(result.stdout)),
              Effect.mapError(toGitError),
            );
        if (side === undefined || side.kind !== "git") {
          return parsed(blameArgs(path));
        }
        // The index side (`:path`) has no rev, so blame its staged content piped from `git show`.
        const rev = side.spec.slice(0, side.spec.indexOf(":"));
        return rev === ""
          ? process.run(["git", "show", side.spec], repoRoot, { allowedExitCodes: [0, 128] }).pipe(
              Effect.mapError(toGitError),
              Effect.flatMap((shown) => parsed(blameContentsArgs(path), shown.stdout)),
            )
          : parsed(blameArgs(path, rev));
      },
      // The default branch's `origin/HEAD` ref, then local `main`/`master`, is tried in turn; the
      // First whose merge-base with HEAD resolves is the branch base. Exit 1/128 (missing ref, no
      // Common ancestor) is a normal miss, not a failure, so the fallback continues.
      branchBase: (repoRoot) => {
        const mergeBase = (ref: string) =>
          process
            .run(mergeBaseArgs(ref), repoRoot, { allowedExitCodes: [0, 1, 128] })
            .pipe(Effect.map((result) => result.stdout.trim() || undefined));
        return process.run(defaultBranchArgs(), repoRoot, { allowedExitCodes: [0, 128] }).pipe(
          Effect.flatMap((result) =>
            [result.stdout.trim(), "main", "master"]
              .filter((ref) => ref !== "")
              .reduce<Effect.Effect<string | undefined, CommandError>>(
                (found, ref) =>
                  found.pipe(
                    Effect.flatMap((base) =>
                      base === undefined ? mergeBase(ref) : Effect.succeed(base),
                    ),
                  ),
                Effect.succeed(undefined),
              ),
          ),
          Effect.mapError(toGitError),
        );
      },
      changedFiles: (repoRoot, scope) =>
        Effect.all(
          [
            process.run(["git", "ls-files", "--others", "--exclude-standard", "-z"], repoRoot),
            process.run(nameStatusArgs(scope), repoRoot),
            process.run(numstatArgs(scope), repoRoot),
            process.run(["git", "status", "--porcelain=v1", "-b", "-z"], repoRoot),
          ],
          { concurrency: "unbounded" },
        ).pipe(
          retryTransient,
          Effect.map(([untracked, nameStatus, numstat, porcelain]) =>
            assembleChanged(
              repoRoot,
              scope,
              untracked.stdout,
              nameStatus.stdout,
              numstat.stdout,
              porcelain.stdout,
            ),
          ),
          Effect.mapError(toGitError),
        ),
      // Exit 128 is an unborn HEAD or an unknown base ref; the empty set then means "nothing
      // Committed this session", so every committed line reads as `earlier`.
      commitsSince: (repoRoot, base) =>
        process.run(commitsSinceArgs(base), repoRoot, { allowedExitCodes: [0, 128] }).pipe(
          retryTransient,
          Effect.map((result) => parseRevList(result.stdout)),
          Effect.mapError(toGitError),
        ),
      // The per-file patch is computed in-process from the scope's two endpoints
      // (blob/worktree reads), never via `git diff <ref> -- <path>`: in very large
      // Repos git's pathspec-limited diff-index walks the whole index (seconds per
      // Invocation, #188), while a blob read stays O(path depth). The pathspec
      // Invocation survives only as the fallback for sides an in-process diff
      // Can't reproduce faithfully (submodules, eol conversion, oversized files).
      fileDiff: (repoRoot, scope, file) => {
        if (file.kind === "untracked") {
          return process
            .run(untrackedDiffArgs(file.path), repoRoot, { allowedExitCodes: [0, 1] })
            .pipe(
              Effect.map((result) => result.stdout),
              Effect.mapError(toGitError),
            );
        }

        // Numstat already flagged it binary; the render is a model-driven
        // Placeholder, so skip both side fetches.
        if (file.binary) {
          return Effect.succeed("");
        }

        const pathspecDiff = process
          .run(
            [
              ...diffArgs(scope),
              "--",
              ...(file.oldPath === undefined ? [file.path] : [file.oldPath, file.path]),
            ],
            repoRoot,
            { allowedExitCodes: [0, 1] },
          )
          .pipe(
            Effect.map((result) => result.stdout),
            Effect.mapError(toGitError),
          );

        const { newSide, oldSide } = fileDiffSides(scope, file);

        return Effect.all(
          [fetchSide(repoRoot, oldSide, file.path), fetchSide(repoRoot, newSide, file.path)],
          { concurrency: "unbounded" },
        ).pipe(
          Effect.map(([oldContent, newContent]) => buildFilePatch(file, oldContent, newContent)),
          // A `git show` failure (submodule gitlink, ref gone mid-flight) falls
          // Back to the pathspec diff; scoped to CommandError so nothing else is
          // Swallowed into a fallback.
          Effect.catchTag("CommandError", () => Effect.succeed<FilePatch>({ kind: "fallback" })),
          Effect.flatMap((built) =>
            built.kind === "patch" ? Effect.succeed(built.patch) : pathspecDiff,
          ),
        );
      },
      // Exit 128 is an unborn HEAD or a path with no history; the empty stdout parses to
      // Undefined, so no line reads `initial` rather than failing the load.
      fileFirstCommit: (repoRoot, path) =>
        process.run(firstCommitArgs(path), repoRoot, { allowedExitCodes: [0, 128] }).pipe(
          retryTransient,
          Effect.map((result) => parseFirstCommit(result.stdout)),
          Effect.mapError(toGitError),
        ),
      fileSource: (repoRoot, scope, file) => {
        const { newSide, oldSide } = fileDiffSides(scope, file);
        return fetchSide(repoRoot, file.kind === "deleted" ? oldSide : newSide, file.path).pipe(
          Effect.mapError(toGitError),
        );
      },
      // The per-worktree git dir, absolute. In a linked worktree this resolves
      // Outside the worktree tree (to <main>/.git/worktrees/<name>), so the watcher
      // Watches it as a second root to catch staging/commit/checkout there.
      gitDir: (repoRoot) =>
        process.run(["git", "rev-parse", "--absolute-git-dir"], repoRoot).pipe(
          retryTransient,
          Effect.map((result) => result.stdout.trim()),
          Effect.mapError(toGitError),
        ),
      // Exit 128 is a commitless repo (no HEAD); fall back to the empty tree so
      // The session base is still a valid diff endpoint.
      headRef: (repoRoot) =>
        process
          .run(["git", "rev-parse", "--verify", "HEAD"], repoRoot, { allowedExitCodes: [0, 128] })
          .pipe(
            retryTransient,
            Effect.map((result) => result.stdout.trim() || EMPTY_TREE_SHA),
            Effect.mapError(toGitError),
          ),
      loadModel: (repoRoot, scope) =>
        Effect.all(
          [
            process.run(["git", "ls-files", "--stage", "-z"], repoRoot),
            process.run(["git", "ls-files", "--others", "--exclude-standard", "-z"], repoRoot),
            process.run(nameStatusArgs(scope), repoRoot),
            process.run(numstatArgs(scope), repoRoot),
            process.run(["git", "status", "--porcelain=v1", "-b", "-z"], repoRoot),
          ],
          { concurrency: "unbounded" },
        ).pipe(
          retryTransient,
          Effect.map(([tracked, untracked, nameStatus, numstat, porcelain]) =>
            assembleModel(
              repoRoot,
              scope,
              tracked.stdout,
              untracked.stdout,
              nameStatus.stdout,
              numstat.stdout,
              porcelain.stdout,
            ),
          ),
          Effect.mapError(toGitError),
        ),
      // Exit 128 is a root commit (no HEAD~1); fall back to the empty tree so the
      // Whole first commit renders as all-added.
      parentRef: (repoRoot) =>
        process
          .run(["git", "rev-parse", "--verify", "HEAD~1"], repoRoot, { allowedExitCodes: [0, 128] })
          .pipe(
            retryTransient,
            Effect.map((result) => result.stdout.trim() || EMPTY_TREE_SHA),
            Effect.mapError(toGitError),
          ),
      // Exit 128 is a commitless repo (unborn HEAD): `git log` has no output, so
      // Allow it and parse the empty stdout to an empty list, letting the picker
      // Show its empty state instead of a failure notice (same as parentRef).
      recentCommits: (repoRoot, limit) =>
        process.run(logArgs(limit), repoRoot, { allowedExitCodes: [0, 128] }).pipe(
          retryTransient,
          Effect.map((result) => parseLog(result.stdout)),
          Effect.mapError(toGitError),
        ),
      repoFiles: (repoRoot) =>
        Effect.all(
          [
            process.run(["git", "ls-files", "--stage", "-z"], repoRoot),
            process.run(["git", "ls-files", "--others", "--exclude-standard", "-z"], repoRoot),
          ],
          { concurrency: "unbounded" },
        ).pipe(
          retryTransient,
          Effect.map(([tracked, untracked]) =>
            parseRepoFiles(repoRoot, tracked.stdout, untracked.stdout),
          ),
          Effect.mapError(toGitError),
        ),
      // Git grep exits 1 when nothing matches, which is a normal empty result.
      search: (repoRoot, query, paths, options) =>
        process.run(searchArgs(query, paths, options), repoRoot, { allowedExitCodes: [0, 1] }).pipe(
          retryTransient,
          // Bytes, not the decoded stdout: the parse converts git's byte columns
          // Against the raw line, immune to replacement-char width drift.
          Effect.map((result) => parseSearchOutput(result.stdoutBytes)),
          Effect.mapError(toGitError),
        ),
      // Every worktree's HEAD resolves against the one shared object database, so their commit times
      // Come back in a single call rather than one per worktree. It is the portable floor under the
      // Reflog mtime (a repository can have reflogs turned off), so a failure here is not fatal.
      worktreeSummaries: (worktrees, repoRoot) => {
        const heads = worktrees.map((worktree) => worktree.head).filter((head) => head !== "");
        const commitTimes =
          heads.length === 0
            ? Effect.succeed(new Map<string, number>())
            : process.run(commitTimeArgs(heads), repoRoot).pipe(
                Effect.map((result) => parseCommitTimes(result.stdout)),
                Effect.orElseSucceed(() => new Map<string, number>()),
              );

        return commitTimes.pipe(
          Effect.flatMap((times) =>
            Effect.all(
              worktrees.map((worktree) =>
                process.run(worktreeStatusArgs, worktree.path).pipe(
                  retryTransient,
                  Effect.map((result) =>
                    summarizeWorktree(worktree.path, result.stdout, times.get(worktree.head)),
                  ),
                  Effect.orElseSucceed(() => undefined),
                ),
              ),
              { concurrency: "unbounded" },
            ),
          ),
          Effect.map((summaries) => summaries.filter((summary) => summary !== undefined)),
        );
      },
      worktrees: (repoRoot) =>
        process.run(["git", "worktree", "list", "--porcelain", "-z"], repoRoot).pipe(
          retryTransient,
          Effect.map((result) => parseWorktreeList(result.stdout)),
          Effect.mapError(toGitError),
        ),
    };
  }),
);
